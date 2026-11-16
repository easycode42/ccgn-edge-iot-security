"""Reproducible synthetic baseline. No test or attack data used for fitting."""
import math
import random

from sklearn.ensemble import IsolationForest


def normal_values(seed, count):
    rng = random.Random(seed)
    return [rng.gauss(23, 0.65) for _ in range(count)]


class SensorModel:
    def __init__(self, seed=42):
        self.model = IsolationForest(n_estimators=100, contamination=0.02, random_state=seed,
                                     n_jobs=1)
        self.model.fit([[x] for x in normal_values(seed, 1000)])

    def inspect(self, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("temperature must be a finite number")
        score = float(self.model.decision_function([[value]])[0])
        return {"rule": value < 15 or value > 40, "ai": score < 0, "score": score}
