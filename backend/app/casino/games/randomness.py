import secrets


class RandomSource:
    def below(self, limit):
        return secrets.randbelow(limit)

    def shuffle(self, values):
        result = list(values)
        for index in range(len(result) - 1, 0, -1):
            other = self.below(index + 1)
            result[index], result[other] = result[other], result[index]
        return result

    def weighted(self, weights):
        choice = self.below(sum(weights))
        for index, weight in enumerate(weights):
            choice -= weight
            if choice < 0:
                return index
        raise ValueError("Empty distribution")


RNG = RandomSource()
