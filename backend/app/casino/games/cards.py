from collections import Counter
from itertools import combinations


def deck(rng, count=1, short=False):
    return rng.shuffle(
        [
            {"rank": rank, "suit": suit}
            for _ in range(count)
            for suit in range(4)
            for rank in range(6 if short else 2, 15)
        ]
    )


def blackjack_total(cards):
    total = sum(min(card["rank"], 10) if card["rank"] != 14 else 1 for card in cards)
    if any(card["rank"] == 14 for card in cards) and total + 10 <= 21:
        total += 10
    return total


def five_rank(cards):
    ranks = sorted((card["rank"] for card in cards), reverse=True)
    counts = Counter(ranks)
    groups = sorted(((count, rank) for rank, count in counts.items()), reverse=True)
    flush = len({card["suit"] for card in cards}) == 1
    straight = (
        ranks[0]
        if len(counts) == 5 and ranks[0] - ranks[-1] == 4
        else 5
        if set(ranks) == {14, 2, 3, 4, 5}
        else 0
    )
    if flush and straight:
        return (8, straight)
    if groups[0][0] == 4:
        return (7, groups[0][1], groups[1][1])
    if [item[0] for item in groups] == [3, 2]:
        return (6, groups[0][1], groups[1][1])
    if flush:
        return (5, *ranks)
    if straight:
        return (4, straight)
    if groups[0][0] == 3:
        return (
            3,
            groups[0][1],
            *sorted((rank for rank in ranks if rank != groups[0][1]), reverse=True),
        )
    if [item[0] for item in groups[:2]] == [2, 2]:
        pairs = sorted((rank for count, rank in groups if count == 2), reverse=True)
        return (2, *pairs, next(rank for count, rank in groups if count == 1))
    if groups[0][0] == 2:
        return (
            1,
            groups[0][1],
            *sorted((rank for count, rank in groups if count == 1), reverse=True),
        )
    return (0, *ranks)


def holdem_rank(cards):
    return max(five_rank(hand) for hand in combinations(cards, 5))


def video_payout(cards):
    rank = five_rank(cards)
    if rank[0] == 8:
        return 800 if rank[1] == 14 else 50
    if rank[0] == 1:
        return 1 if rank[1] >= 11 else 0
    return {7: 25, 6: 9, 5: 6, 4: 4, 3: 3, 2: 2, 0: 0}[rank[0]]
