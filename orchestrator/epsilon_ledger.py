"""
Epsilon Ledger — cross-study differential-privacy budget accounting.

Every DP release (query, synthetic export) consumes privacy budget from the
dataset it touched. Most platforms track epsilon per query; nobody tracks it
per DATASET across all studies and time. The ledger does, on the audit chain,
so a data controller can be told: "the cumulative, mathematically-composed
privacy spend against your archive is X of the agreed budget Y — and here is
the tamper-evident ledger proving no query was ever left off the books."

Sequential composition (sum of epsilons) is used deliberately: it is the
conservative upper bound, so the guarantee shown to controllers is never
optimistic. When the budget is exhausted the platform refuses further DP
releases against that dataset — enforcement, not reporting.
"""
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header

from orchestrator.state import audit, supabase_admin

logger = logging.getLogger("undosatech.epsilon")
router = APIRouter()

LEDGER_PATH = Path("epsilon_ledger.jsonl")
DEFAULT_BUDGET = float(os.getenv("DATASET_EPSILON_BUDGET", "10.0"))
DELTA = 1e-5

_lock = threading.Lock()
_spent_cache: Optional[dict] = None  # dataset_key -> cumulative epsilon


class BudgetExceeded(Exception):
    def __init__(self, dataset_key: str, spent: float, requested: float, budget: float):
        self.dataset_key, self.spent, self.requested, self.budget = dataset_key, spent, requested, budget
        super().__init__(
            f"Privacy budget exhausted for '{dataset_key}': "
            f"{spent:.3f}ε spent + {requested:.3f}ε requested > {budget:.3f}ε budget. "
            f"Further DP releases against this dataset are refused."
        )


def _load_spent() -> dict:
    spent: dict = {}
    if LEDGER_PATH.exists():
        for line in LEDGER_PATH.read_text().splitlines():
            try:
                e = json.loads(line)
                spent[e["dataset_key"]] = spent.get(e["dataset_key"], 0.0) + float(e["epsilon"])
            except Exception:
                continue
    return spent


def spent(dataset_key: str) -> float:
    global _spent_cache
    with _lock:
        if _spent_cache is None:
            _spent_cache = _load_spent()
        return _spent_cache.get(dataset_key, 0.0)


def charge(dataset_key: str, epsilon: float, actor: str = "", context: Optional[dict] = None) -> dict:
    """Charge epsilon against a dataset's budget. Raises BudgetExceeded if it won't fit."""
    global _spent_cache
    epsilon = float(epsilon)
    with _lock:
        if _spent_cache is None:
            _spent_cache = _load_spent()
        already = _spent_cache.get(dataset_key, 0.0)
        if already + epsilon > DEFAULT_BUDGET:
            raise BudgetExceeded(dataset_key, already, epsilon, DEFAULT_BUDGET)
        row = {
            "dataset_key": dataset_key,
            "epsilon":     epsilon,
            "delta":       DELTA,
            "cumulative":  round(already + epsilon, 6),
            "budget":      DEFAULT_BUDGET,
            "actor":       actor,
            "context":     context or {},
            "charged_at":  datetime.now(timezone.utc).isoformat(),
        }
        with open(LEDGER_PATH, "a") as f:
            f.write(json.dumps(row, default=str) + "\n")
        _spent_cache[dataset_key] = already + epsilon

    audit(dataset_key, "epsilon_charged", {
        "epsilon": epsilon, "cumulative": row["cumulative"],
        "budget": DEFAULT_BUDGET, "actor": actor,
        **{k: v for k, v in (context or {}).items() if k in ("query_type", "field", "purpose")},
    })
    if supabase_admin:
        try:
            supabase_admin.table("epsilon_ledger").insert(row).execute()
        except Exception as e:
            logger.warning("Supabase epsilon insert failed: %s", e)
    return row


def summary() -> list:
    """Per-dataset budget position, most-spent first."""
    global _spent_cache
    with _lock:
        if _spent_cache is None:
            _spent_cache = _load_spent()
        snapshot = dict(_spent_cache)
    return sorted(
        (
            {
                "dataset_key": k,
                "epsilon_spent": round(v, 6),
                "budget": DEFAULT_BUDGET,
                "remaining": round(max(0.0, DEFAULT_BUDGET - v), 6),
                "exhausted": v >= DEFAULT_BUDGET,
            }
            for k, v in snapshot.items()
        ),
        key=lambda r: -r["epsilon_spent"],
    )


def dataset_key_for_cohort(cohort: dict) -> str:
    return str(cohort.get("slug") or cohort.get("name") or cohort.get("disease_area") or "unknown-cohort")


# ── API ───────────────────────────────────────────────────────────────────────
@router.get("/dp/ledger")
def api_ledger(authorization: Optional[str] = Header(None)):
    """Budget position across every dataset ever queried."""
    from orchestrator.auth import _require_user
    _require_user(authorization)
    return {"composition": "sequential (conservative upper bound)", "delta": DELTA,
            "default_budget": DEFAULT_BUDGET, "datasets": summary()}


@router.get("/dp/ledger/{dataset_key}")
def api_ledger_dataset(dataset_key: str, authorization: Optional[str] = Header(None)):
    """Full charge history for one dataset — the receipts behind the total."""
    from orchestrator.auth import _require_user
    _require_user(authorization)
    charges = []
    if LEDGER_PATH.exists():
        for line in LEDGER_PATH.read_text().splitlines():
            try:
                e = json.loads(line)
                if e.get("dataset_key") == dataset_key:
                    charges.append(e)
            except Exception:
                continue
    return {"dataset_key": dataset_key, "epsilon_spent": round(spent(dataset_key), 6),
            "budget": DEFAULT_BUDGET, "charges": charges}
