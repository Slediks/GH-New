"""Archived pre-migration geometry, only for conversion and parity checks."""
from .depot import MAP as DEPOT
from .foundry import MAP as FOUNDRY
from .outpost import MAP as OUTPOST

MAPS = {m["id"]: m for m in (DEPOT, FOUNDRY, OUTPOST)}
