#!/usr/bin/env python3
"""Recompute the bounded, read-only V3.9.6 current risk replay from committed captures.

Input files are sanitized projections of the three read-only runtime endpoints. The
script deliberately reports the visible position book as a lower bound when the
runtime reconciliation and durable-claim projections disagree.
"""
from __future__ import annotations

import json
import csv
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "docs/reports/v396-entry-frequency-risk-audit-20260927"


def dec(value: object) -> Decimal:
    return Decimal(str(value))


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    snapshot = json.loads((ROOT / "snapshot-phase0.json").read_text(encoding="utf-8-sig"))
    closeout = json.loads((ROOT / "closeout-phase0.json").read_text(encoding="utf-8-sig"))
    p0 = json.loads((ROOT / "p0-phase0.json").read_text(encoding="utf-8-sig"))
    positions = snapshot["positions"]
    profile = closeout["portfolioRiskProfile"]["values"]
    gross = sum((dec(row["notionalUsd"]) for row in positions), Decimal(0))
    sides = {
        side: sum((dec(row["notionalUsd"]) for row in positions if row["side"] == side), Decimal(0))
        for side in ("LONG", "SHORT")
    }
    margin = sum((dec(row["notionalUsd"]) / dec(row["leverage"]) for row in positions), Decimal(0))
    owner_gross = sum((dec(row["notionalUsd"]) for row in positions if row["managementStatus"] in {
        "HUMAN_MANAGED", "HANDOFF_PENDING", "AI_ACTIVE"
    }), Decimal(0))
    # With an empty committed map, every visible position maps to UNMAPPED_CORRELATED.
    mapped_buckets = profile.get("clusters", {})
    bucket_by_underlying = {row["underlying"]: mapped_buckets.get(row["underlying"], "UNMAPPED_CORRELATED") for row in positions}
    visible_bucket_sums: dict[str, Decimal] = {}
    visible_bucket_counts: dict[str, int] = {}
    for row in positions:
        bucket = bucket_by_underlying[row["underlying"]]
        visible_bucket_sums[bucket] = visible_bucket_sums.get(bucket, Decimal(0)) + dec(row["notionalUsd"])
        visible_bucket_counts[bucket] = visible_bucket_counts.get(bucket, 0) + 1

    scenarios = []
    for item in profile["scenarios"]:
        base = sum((abs(dec(item[key])) for key in ("priceShockPct", "spreadWidenPct", "fundingShockPct", "markBasisShockPct", "depthPenaltyPct")), Decimal(0))
        if item["exchangeUnavailable"]:
            base += dec(item["unavailablePenaltyPct"])
        base_loss = gross * base
        penalty = sum((amount * abs(dec(item["priceShockPct"])) * dec(item["clusterConvergencePct"])
                       for bucket, amount in visible_bucket_sums.items() if visible_bucket_counts[bucket] > 1), Decimal(0))
        scenarios.append({"id": item["id"], "baseCoefficient": str(base), "visibleBaseLossUsd": str(base_loss),
                          "visibleCorrelationPenaltyUsd": str(penalty), "visibleStressLossUsd": str(base_loss + penalty)})
    worst = max(scenarios, key=lambda item: dec(item["visibleStressLossUsd"]))

    gross_limit = dec(profile["maxGrossNotionalUsd"])
    direction_limit = dec(profile["maxDirectionNotionalUsd"])
    cluster_limit = dec(profile["maxClusterNotionalUsd"])
    human_limit = dec(profile["maxHumanNotionalUsd"])
    stress_limit = dec(profile["maxStressLossUsd"])
    reconciliation = closeout["reconciliation"]
    active_unknown_claims = p0.get("durableClaims", {}).get("activeUnknownClaims")
    conflict = reconciliation.get("activeRiskUnresolvedCount", 0) > 0 and active_unknown_claims == 0
    gates = [
        {"gate": "MAX_GROSS_NOTIONAL", "unit": "NOTIONAL_USD", "usedVisibleLowerBound": str(gross),
         "limit": str(gross_limit), "headroom": str(max(Decimal(0), gross_limit - gross)),
         "shortfallVisibleBook": str(max(Decimal(0), gross - gross_limit))},
        {"gate": "HUMAN_POTENTIAL_NOTIONAL_LIMIT", "unit": "NOTIONAL_USD", "usedVisiblePositions": str(owner_gross),
         "limit": str(human_limit), "headroom": str(max(Decimal(0), human_limit - owner_gross)),
         "shortfallVisiblePositions": str(max(Decimal(0), owner_gross - human_limit)),
         "pendingRiskDifference": "UNKNOWN: activeRiskUnresolvedCount conflicts with activeUnknownClaims and pendingEntries"},
        {"gate": "MAX_CLUSTER_NOTIONAL", "unit": "NOTIONAL_USD", "usedLargestVisibleBucket": str(max(visible_bucket_sums.values())),
         "visibleBucketCount": len(visible_bucket_sums), "visiblePositionCountInLargestBucket": max(visible_bucket_counts.values()),
         "limit": str(cluster_limit), "headroom": str(max(Decimal(0), cluster_limit - max(visible_bucket_sums.values()))),
         "shortfallVisibleBook": str(max(Decimal(0), max(visible_bucket_sums.values()) - cluster_limit))},
        {"gate": "MAX_DIRECTION_NOTIONAL_LONG", "unit": "NOTIONAL_USD", "used": str(sides["LONG"]), "limit": str(direction_limit),
         "headroom": str(max(Decimal(0), direction_limit - sides["LONG"])), "shortfall": str(max(Decimal(0), sides["LONG"] - direction_limit))},
        {"gate": "MAX_DIRECTION_NOTIONAL_SHORT", "unit": "NOTIONAL_USD", "used": str(sides["SHORT"]), "limit": str(direction_limit),
         "headroom": str(max(Decimal(0), direction_limit - sides["SHORT"])), "shortfall": str(max(Decimal(0), sides["SHORT"] - direction_limit))},
        {"gate": "MAX_CAPITAL_AT_RISK", "unit": "MARGIN_USD", "usedVisiblePositions": str(margin),
         "limit": str(profile["maxCapitalAtRiskUsd"]), "headroom": str(max(Decimal(0), dec(profile["maxCapitalAtRiskUsd"]) - margin)),
         "shortfallVisibleBook": str(max(Decimal(0), margin - dec(profile["maxCapitalAtRiskUsd"])))},
        {"gate": "MAX_STRESS_LOSS", "unit": "LOSS_USD", "usedVisibleLowerBound": worst["visibleStressLossUsd"],
         "worstVisibleScenario": worst["id"], "limit": str(stress_limit),
         "headroom": str(max(Decimal(0), stress_limit - dec(worst["visibleStressLossUsd"]))),
         "shortfallVisibleBook": str(max(Decimal(0), dec(worst["visibleStressLossUsd"]) - stress_limit))},
        {"gate": "HUMAN_POSITION_SLOTS", "unit": "COUNT", "used": len(positions), "limit": profile["maxHumanPositions"],
         "headroom": max(0, int(profile["maxHumanPositions"]) - len(positions))},
    ]
    replay = {
        "status": "INCOMPLETE_RECONCILIATION_CONFLICT" if conflict else "BOUNDED_VISIBLE_BOOK_REPLAY",
        "asOf": snapshot["ts"],
        "sourceFiles": ["snapshot-phase0.json", "closeout-phase0.json", "p0-phase0.json"],
        "runtimeIdentity": closeout["runtime"],
        "account": snapshot["account"],
        "positions": {"count": len(positions), "ownerCounts": snapshot["ownerCounts"], "tpCounts": snapshot["tpCounts"],
                      "visibleGrossNotionalUsd": str(gross), "longNotionalUsd": str(sides["LONG"]),
                      "shortNotionalUsd": str(sides["SHORT"]), "marginNotionalUsd": str(margin),
                      "pendingEntries": snapshot["pendingEntries"], "positionNotionalUsdSumVsPublishedCapacity": closeout["publishedGrossNotionalUsd"]},
        "portfolioRiskProfile": closeout["portfolioRiskProfile"],
        "gates": gates,
        "stressScenarios": scenarios,
        "riskVisibility": closeout["riskVisibility"],
        "reconciliation": reconciliation,
        "p0Integrity": p0,
        "interpretation": {
            "decision": "CURRENT_PUBLISHED_REFUSAL:HUMAN_ACK_OVERDUE; both published side ceilings are zero. The visible-book gross comparison also exceeds the committed profile limit, but the runtime did not publish its gate array, so this is a bounded arithmetic result rather than a complete authoritative gate replay.",
            "pendingRisk": "UNRESOLVED: do not infer zero; exact pending claim set/amount unavailable from mutually inconsistent projections",
            "duplicateGateProof": "VISIBLE POSITION SET ONLY: gross, human position notional and all-unmapped cluster coincide; full pending-risk equivalence is not proven",
            "runtimeProvenance": "Published HTTP instance identity/build/data directory captured; loaded-source provenance and local SQLite linkage are not proven by this replay",
        },
    }
    write_json(ROOT / "authoritative-risk-replay-phase0.json", replay)
    with (ROOT / "authoritative-risk-replay-gates-phase0.csv").open("w", encoding="utf-8", newline="") as handle:
        fieldnames = list(dict.fromkeys(key for gate in gates for key in gate))
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(gates)


if __name__ == "__main__":
    main()
