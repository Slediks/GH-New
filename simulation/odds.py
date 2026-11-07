"""1X2 Monte Carlo uses the SAME frozen personnel and regulation time as broadcast."""

import copy
import hashlib
import json

from simulation.engine import Engine


def estimate_1x2(teams, duration, samples=32):
    snapshot = copy.deepcopy(teams)
    snapshot[0]["match_format"] = {
        **snapshot[0].get("match_format", {}),
        "decisive": False,
        "aggregate": [0, 0],
    }
    key = hashlib.sha256(
        json.dumps(
            {"teams": snapshot, "duration": duration, "samples": samples, "version": "3.0"},
            sort_keys=True,
        ).encode()
    ).hexdigest()
    counts = [1, 1, 1]  # Published Dirichlet(1,1,1) smoothing; no zero-priced outcome.
    for index in range(samples):
        mirrored = index % 2 == 1
        run_teams = copy.deepcopy(list(reversed(snapshot)) if mirrored else snapshot)
        run_teams[0]["match_format"] = snapshot[0]["match_format"]
        result = Engine(run_teams, f"odds3:{key}:{index // 2}", duration).run()
        counts[1 - result if mirrored and result != 2 else result] += 1
    probabilities = [n * 10000 // sum(counts) for n in counts]
    probabilities[max(range(3), key=lambda i: counts[i])] += 10000 - sum(probabilities)
    return key, probabilities
