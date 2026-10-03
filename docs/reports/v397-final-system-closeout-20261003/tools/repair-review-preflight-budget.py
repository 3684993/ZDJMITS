"""Rebaseline only proven pre-model Position Review failures in a stopped TESTNET runtime.

Dry run by default. --apply creates a consistent SQLite backup before changing
failure counters. Historical verdicts, usage rows, and log evidence are retained.
"""

import argparse
import collections
import datetime
import gzip
import hashlib
import json
import pathlib
import socket
import sqlite3
import uuid

REASON = "PRE_AI_EXECUTION_ENVELOPE_MISSING"
VERSION = "V397_PREMODEL_BUDGET_REBASE_1"


def failure_events(log_dir: pathlib.Path):
    rows = collections.defaultdict(list)
    for path in sorted(log_dir.glob("engine-2026-10-*.jsonl*")):
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rt", encoding="utf-8", errors="replace") as stream:
            for line in stream:
                if '"event":"POSITION_REVIEW_FAILED"' not in line:
                    continue
                event = json.loads(line)
                payload = event.get("payload") or {}
                cycle = payload.get("cycleId")
                if cycle:
                    rows[cycle].append((int(event["timestamp"]), payload.get("reason"), payload.get("rowEventId")))
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, type=pathlib.Path)
    parser.add_argument("--logs", required=True, type=pathlib.Path)
    parser.add_argument("--backup", type=pathlib.Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply and not args.backup:
        parser.error("--apply requires --backup")
    if args.apply:
        with socket.socket() as probe:
            probe.settimeout(1)
            if probe.connect_ex(("127.0.0.1", 8080)) == 0:
                raise SystemExit("REFUSED: Engine port 8080 is listening")

    db = sqlite3.connect(f"file:{args.db.as_posix()}?mode=ro", uri=True)
    settings = json.loads(db.execute("SELECT payload FROM settings WHERE id=1").fetchone()[0])
    if settings["connections"]["exchange"]["environment"] != "TESTNET":
        raise SystemExit("REFUSED: database is not TESTNET")
    original = db.execute("SELECT payload FROM runtime_state WHERE id=1").fetchone()[0]
    state = json.loads(original)
    events = failure_events(args.logs)
    position_runs = db.execute("SELECT COUNT(*) FROM ai_runs_archive WHERE json_extract(payload,'$.runKind')='POSITION_REVIEW_RUN'").fetchone()[0]
    if position_runs:
        raise SystemExit(f"REFUSED: {position_runs} Position Review model runs require separate adjudication")
    repairs = []
    for key, budget in state.get("reviewBudgets", []):
        failures = int(budget.get("failures", 0))
        if not failures:
            continue
        if budget.get("preModelFailureRebaseline"):
            raise SystemExit(f"REFUSED: budget already rebaselined: {key}")
        cycle = budget["cycleId"]
        found = events.get(cycle, [])
        if len(found) != failures or any(row[1] != REASON for row in found):
            raise SystemExit(f"REFUSED: incomplete or mixed failure proof for {cycle}: budget={failures} logs={found}")
        proof_hash = hashlib.sha256(json.dumps(found, separators=(",", ":")).encode()).hexdigest()
        repairs.append((key, budget, failures, proof_hash))
    if not repairs:
        raise SystemExit("NO_REPAIR_NEEDED")
    if sum(len(rows) for rows in events.values()) != sum(item[2] for item in repairs):
        raise SystemExit("REFUSED: unmatched Position Review failure events")
    print(json.dumps({"mode": "APPLY" if args.apply else "DRY_RUN", "budgets": len(repairs),
                      "provenPreModelFailures": sum(item[2] for item in repairs),
                      "positionModelRuns": position_runs}, sort_keys=True))
    if not args.apply:
        return

    args.backup.parent.mkdir(parents=True, exist_ok=True)
    if args.backup.exists():
        raise SystemExit("REFUSED: backup target already exists")
    backup = sqlite3.connect(args.backup)
    db.backup(backup)
    if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("REFUSED: backup integrity check failed")
    backup.close()
    db.close()

    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    for _, budget, failures, proof_hash in repairs:
        budget["preModelFailureRebaseline"] = {"version": VERSION, "oldFailures": failures,
                                                 "reason": REASON, "proofSha256": proof_hash, "at": now}
        budget["failures"] = 0
        budget["lastSkippedReason"] = None
    updated = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    writer = sqlite3.connect(args.db)
    try:
        writer.execute("BEGIN IMMEDIATE")
        changed = writer.execute("UPDATE runtime_state SET payload=?,updated_at=? WHERE id=1 AND payload=?",
                                 (updated, now, original)).rowcount
        if changed != 1:
            raise RuntimeError("runtime_state changed after backup; transaction rolled back")
        for key, budget, failures, proof_hash in repairs:
            writer.execute("INSERT INTO runtime_events(id,type,ts,symbol,payload) VALUES(?,?,?,?,?)",
                           (f"evt_{uuid.uuid4().hex}", "POSITION_REVIEW_PREMODEL_BUDGET_REBASELINED", now, None,
                            json.dumps({"budgetKey": key, "cycleId": budget["cycleId"], "planRef": budget["planRef"],
                                        "oldFailures": failures, "newFailures": 0, "reason": REASON,
                                        "proofSha256": proof_hash, "version": VERSION}, separators=(",", ":"))))
        writer.commit()
    except Exception:
        writer.rollback()
        raise
    finally:
        writer.close()
    print(json.dumps({"backup": str(args.backup), "repairedBudgets": len(repairs), "status": "COMMITTED"}))


if __name__ == "__main__":
    main()
