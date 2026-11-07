"""Frozen matches select their original engine, including already-open bet windows."""

from simulation.configuration import ENGINE_VERSION
from simulation.engine import Engine
from simulation.legacy.v1 import Engine as LegacyEngine
from simulation.legacy.v2.engine import Engine as V2Engine


def engine_for_version(model_version):
    version = model_version.split(":", 1)[0]
    if version == "1.0":
        return LegacyEngine
    if version == "2.0":
        return V2Engine
    if version == ENGINE_VERSION:
        return Engine
    raise ValueError(f"Unsupported frozen simulation version: {version}")
