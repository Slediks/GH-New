"""Distribution smoke checks supplement exact math; they do not certify rare jackpots."""

from collections import Counter
from fractions import Fraction
from math import comb, sqrt

from backend.app.casino.games import horses, plinko, roulette, target, wheel
from backend.app.casino.games.randomness import RandomSource


def within_six_sigma(observed, total, probability):
    p = float(probability)
    assert abs(observed - total * p) <= 6 * sqrt(total * p * (1 - p)) + 1


def test_common_outcomes_match_published_probabilities():
    rng, total = RandomSource(), 20000
    counts = Counter(roulette.outcome(rng)["number"] for _ in range(total))
    assert set(counts) == set(range(37))
    for count in counts.values():
        within_six_sigma(count, total, Fraction(1, 37))
    for risk, sectors in wheel.SECTORS.items():
        counts = Counter(wheel.outcome(rng, risk)["sector"] for _ in range(total))
        for symbol, numerator_denominator in wheel.PAY[risk].items():
            probability = Fraction(sectors.count(symbol), len(sectors))
            assert probability * Fraction(*numerator_denominator) == Fraction(96, 100)
            within_six_sigma(counts[symbol], total, probability)


def test_horse_first_place_probabilities_against_exact_model():
    rng, total = RandomSource(), 20000
    counts = Counter()
    for _ in range(total):
        result = horses.outcome(rng)
        assert all(700 <= time <= 900 for time in result["times"])
        counts.update(result["winners"])
    for index, published in enumerate(horses.math_table()):
        probability = Fraction(*(int(value) for value in published["probability"]))
        within_six_sigma(counts[index], total, probability)


def test_plinko_all_4096_paths_match_binomial_table():
    class Path:
        def __init__(self, number):
            self.bits = iter((number >> bit) & 1 for bit in range(12))

        def below(self, maximum):
            assert maximum == 2
            return next(self.bits)

    bins = Counter(plinko.start(100, {}, Path(number))["bin"] for number in range(4096))
    assert bins == Counter({index: comb(12, index) for index in range(13)})
    for risk in plinko.WEIGHTS:
        expectation = sum(
            Fraction(bins[index], 4096) * value
            for index, value in enumerate(plinko.multipliers(risk))
        )
        assert expectation == Fraction(97, 100)


def test_target_all_outcomes_include_both_boundaries():
    class Outcome:
        def __init__(self, number):
            self.number = number

        def below(self, maximum):
            assert maximum == 10000
            return self.number

    for low, high in [(0, 499), (500, 9999), (2750, 7749)]:
        results = [
            target.start(10000, {"low": low, "high": high}, Outcome(number))["payout"]
            for number in range(10000)
        ]
        assert sum(value > 0 for value in results) == high - low + 1
        assert results[low] > 0 and results[high] > 0
        assert sum(results) <= 9600 * 10000
