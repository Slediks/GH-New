"""100 authenticated websocket clients; run against the explicit development mock.

Never print cookies or CSRF tokens. Produces machine-readable measured results.
"""

import argparse
import json
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
import socketio


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8080")
    parser.add_argument("--clients", type=int, default=100)
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--output", default="docs/load-results.json")
    args = parser.parse_args()
    clients = []
    counters = [0] * args.clients
    latencies = []
    sequences = {}
    errors = []
    measuring = threading.Event()
    live_ready = threading.Event()
    lock = threading.Lock()

    def connect(index):
        session = requests.Session()
        csrf = session.get(args.url + "/api/auth/session", timeout=10).json()["csrf"]
        response = session.post(
            args.url + "/api/auth/login",
            json={"login": f"load-{index:03}"},
            headers={"X-CSRF-Token": csrf},
            timeout=10,
        )
        response.raise_for_status()
        client = socketio.Client(http_session=session, reconnection=False)

        @client.on("snapshot")
        def receive(snapshot):
            if snapshot.get("phase") == "live" and snapshot.get("elapsed", 120) < 80:
                live_ready.set()
            if not measuring.is_set():
                return
            with lock:
                key = (snapshot["match_id"], snapshot["sequence"])
                encoded = json.dumps(snapshot, sort_keys=True)
                if key in sequences and sequences[key] != encoded:
                    errors.append("inconsistent snapshot")
                sequences[key] = encoded
                counters[index] += 1
                latencies.append(max(0, (time.time() - snapshot["server_time"]) * 1000))

        client.connect(args.url, transports=["websocket"], wait_timeout=15)
        return client

    with ThreadPoolExecutor(max_workers=10) as executor:
        for future in [executor.submit(connect, index) for index in range(args.clients)]:
            try:
                clients.append(future.result())
            except Exception as error:
                errors.append(type(error).__name__)
    live_ready.clear()
    if not live_ready.wait(timeout=180):
        errors.append("no live match available for measurement")
    measuring.set()
    time.sleep(args.seconds)
    measuring.clear()
    connected = sum(client.connected for client in clients)
    for client in clients:
        client.disconnect()
    result = {
        "requested_clients": args.clients,
        "connected_clients": connected,
        "duration_seconds": args.seconds,
        "received_snapshots": sum(counters),
        "minimum_per_client": min(counters),
        "median_delivery_ms": round(statistics.median(latencies), 2) if latencies else None,
        "p95_delivery_ms": round(sorted(latencies)[int(len(latencies) * 0.95)], 2)
        if latencies
        else None,
        "identical_shared_snapshots": not errors,
        "errors": errors,
        "environment": "Windows host, Docker Desktop Linux containers, PostgreSQL 16, Redis 7, Gunicorn 1 worker / 120 threads; localhost",
    }
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if connected != args.clients or errors or not latencies:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
