#!/usr/bin/env python3
"""Fixed-window, offline native Entry audit. No HTTP, models, engine or exchange calls."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sqlite3
import sys

TERMINAL = {"COMPLETED", "FAILED", "CANCELED"}
EXCHANGE_SOURCES = {"EXCHANGE_AUDIT", "USER_DATA_WS", "BINANCE_USER_DATA", "BINANCE_USER_TRADES"}
REJECTION_EVENTS = {"CANDIDATE_REJECTED", "ENTRY_DECISION_BLOCKED", "ENTRY_ORDER_BLOCKED"}
WAIT_EVENTS = {"ENTRY_WAIT_SAVED", "ENTRY_EXECUTION_WAIT_STARTED", "ENTRY_EXECUTION_WAITING"}


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def timestamp(value):
    numeric = number(value)
    if numeric is not None:
        return int(numeric)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError("timestamps require an explicit timezone")
            return int(parsed.timestamp() * 1000)
        except ValueError:
            pass
    raise ValueError(f"invalid timestamp: {value!r}")


def object_json(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            pass
    return {}


def identity(value):
    return str(value).strip() if value is not None and str(value).strip() else None


def records(value):
    if isinstance(value, dict):
        return list(value.values())
    return [row[1] if isinstance(row, list) and len(row) == 2 else row for row in (value or [])]


def load_sqlite(path, start, end, max_rows):
    """Read only named evidence tables, consistently. Never read credentials/current Settings."""
    if not path.is_file():
        raise ValueError("SQLite evidence file does not exist")
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "ai_runs_archive" not in tables:
            raise ValueError("ai_runs_archive table required")

        def query(sql, args=()):
            rows = db.execute(sql + " LIMIT ?", (*args, max_rows + 1)).fetchall()
            if len(rows) > max_rows:
                raise ValueError("evidence row bound exceeded; narrow the explicit window")
            return rows

        result = {"runs": [], "events": [], "intents": [], "orders": [], "fills": [],
                  "settingsChanges": [], "coverage": {"runs": "ARCHIVE_START_COHORT"}}
        for row in query("SELECT * FROM ai_runs_archive WHERE started_at>=? AND started_at<=? ORDER BY started_at", (start, end)):
            raw = dict(row)
            run = object_json(raw.get("payload"))
            aliases = {"run_id": "id", "started_at": "startedAt", "completed_at": "completedAt",
                       "latency_ms": "latencyMs", "role": "role", "symbol": "symbol", "status": "status", "decision": "decision"}
            for key, target in aliases.items():
                if run.get(target) is None and raw.get(key) is not None:
                    run[target] = raw[key]
            result["runs"].append(run)
        if "runtime_events" in tables:
            result["events"] = [dict(row) for row in query("SELECT id,type,ts,symbol,payload FROM runtime_events WHERE ts>=? AND ts<=? ORDER BY ts", (start, end))]
        # Decision chains can retain run-linked events already evicted from the runtime ring.
        if "decision_chains" in tables:
            for run in result["runs"]:
                row = db.execute("SELECT payload FROM decision_chains WHERE chain_id=?", (run.get("id"),)).fetchone()
                if row:
                    result["events"].extend(object_json(row[0]).get("events", []))
                    if len(result["events"]) > max_rows:
                        raise ValueError("combined event row bound exceeded")
        if "runtime_entities" in tables:
            for kind, target in [("entryIntents", "intents"), ("entryOrders", "orders"), ("executionFills", "fills")]:
                result[target] = [object_json(row[0]) for row in query("SELECT payload FROM runtime_entities WHERE kind=?", (kind,))]
        if "settings_audit" in tables:
            result["settingsChanges"] = [dict(row) for row in query("SELECT changed_at AS at,new_version AS settingsVersion FROM settings_audit WHERE changed_at<=? ORDER BY changed_at", (end,))]
        result["source"] = {"format": "SQLITE_READ_ONLY", "path": str(path.resolve()),
                            "snapshotReadAt": datetime.now(timezone.utc).isoformat(),
                            "transaction": "BEGIN; query_only=ON; mode=ro"}
        result["coverage"]["execution"] = "RETAINED_NATIVE_EVENTS_AND_CURRENT_CANONICAL_FILL_FACTS"
        return result
    finally:
        db.close()


def load_json(path):
    raw = json.loads(path.read_text())
    data = {"runs": [], "events": [], "intents": [], "orders": [], "fills": [], "coverage": {}}
    if isinstance(raw, list):
        data["runs"] = raw
    elif "postDeployment" in raw and "placeRuns" in raw:
        # A baseline summary is a partial export, never a substitute for its 163 raw runs.
        data["runs"] = [{"role": "PRIMARY_BRAIN", **row} for row in raw.get("placeRuns", []) + raw.get("recentRunRows", [])]
        data["coverage"]["runs"] = "PARTIAL_BASELINE_SUMMARY"
        data["reportedBaseline"] = raw.get("postDeployment")
    elif "runs" in raw or "items" in raw:
        data.update(raw)
        data["runs"] = raw.get("runs", raw.get("items", []))
    else:
        # Existing primary-details-root.json: dict[runId] = {run, execution, ...}.
        values = [v for v in raw.values() if isinstance(v, dict) and isinstance(v.get("run"), dict)]
        if not values:
            raise ValueError("unsupported JSON export; provide runs or native detail objects")
        data["runs"] = [{**v["run"], "execution": v.get("execution")} for v in values]
        data["coverage"]["runs"] = "DETAIL_EXPORT_COMPLETENESS_UNKNOWN"
    data["source"] = {"format": "JSON_EXPORT", "path": str(path.resolve())}
    return data


def validate_phases(phases, start, end):
    output = []
    for index, phase in enumerate(phases):
        row = dict(phase)
        row["start"], row["end"] = timestamp(row["start"]), timestamp(row["end"])
        if row["start"] >= row["end"]:
            raise ValueError("phase start must precede end")
        if row.get("id") is None:
            row["id"] = f"phase-{index + 1}"
        if any(row.get(key) is not None for key in ["settingsVersion", "contractVersion", "scoutMode"]) and not row.get("evidenceRef"):
            raise ValueError("declared phase configuration requires evidenceRef")
        output.append(row)
    output.sort(key=lambda row: row["start"])
    if len({p["id"] for p in output}) != len(output):
        raise ValueError("phase IDs must be unique")
    if any(a["end"] > b["start"] for a, b in zip(output, output[1:])):
        raise ValueError("overlapping configuration phases")
    return output


def audit(data, start, end, phases=None):
    if start >= end:
        raise ValueError("explicit start must precede end; window is never extended")
    phases = validate_phases(phases if phases is not None else data.get("configurationPhases", []), start, end)
    issues = Counter()
    selected = {}
    for source in records(data.get("runs")):
        raw = source.get("run", source)
        if raw.get("role") != "PRIMARY_BRAIN" or raw.get("requestSource") not in (None, "ENTRY"):
            continue
        at = number(raw.get("startedAt"))
        key = identity(raw.get("id", raw.get("runId")))
        if at is None or key is None:
            issues["runIdentityOrStartMissing"] += 1
            continue
        if not start <= at <= end:
            continue
        old = selected.get(key)
        if old and old.get("symbol") != raw.get("symbol"):
            raise ValueError("one runId has conflicting symbols")
        if not old or (number(raw.get("completedAt")) or 0) > (number(old.get("completedAt")) or 0):
            selected[key] = raw
    events = []
    seen_events = set()
    for raw in records(data.get("events")):
        at = number(raw.get("ts"))
        if at is None or not start <= at <= end:
            continue
        payload = object_json(raw.get("payload"))
        marker = raw.get("id") or json.dumps([at, raw.get("type"), payload], sort_keys=True)
        if marker in seen_events:
            continue
        seen_events.add(marker)
        events.append({**raw, "payload": payload})
    intents = records(data.get("intents", data.get("entryIntents")))
    orders = records(data.get("orders", data.get("entryOrders")))
    for event in events:
        payload = event["payload"]
        if isinstance(payload.get("intent"), dict):
            intents.append(payload["intent"])
        if isinstance(payload.get("order"), dict):
            orders.append({**payload["order"], "_eventAt": event["ts"]})
    intent_runs = defaultdict(set)
    intent_times = {}
    for row in intents:
        at = number(row.get("createdAt"))
        if at is not None and start <= at <= end and identity(row.get("id")):
            refs = {identity(row.get(k)) for k in ["brainRunId", "decisionChainId"] if identity(row.get(k))}
            if any(r in selected and (row.get("symbol") != selected[r].get("symbol") or at < selected[r]["startedAt"]) for r in refs):
                issues["intentSymbolOrTimeMismatch"] += 1
                continue
            intent_runs[str(row["id"])].update(refs)
            intent_times[str(row["id"])] = at
    order_links = defaultdict(set)
    internal = {}
    order_times = {}
    confirmations = defaultdict(set)
    for row in orders:
        key, iid = identity(row.get("id")), identity(row.get("intentId"))
        at = number(row.get("createdAt"))
        if not key or not iid or at is None or not start <= at <= end:
            continue
        refs = intent_runs.get(iid, set())
        direct = {identity(row[k]) for k in ["brainRunId", "decisionChainId"] if identity(row.get(k))}
        if len(refs | direct) != 1 or not refs:
            issues["orderRunIntentLineageMissingOrConflicting"] += 1
            continue
        run_id = next(iter(refs))
        if run_id not in selected or row.get("symbol") != selected[run_id].get("symbol"):
            continue
        if at < intent_times[iid]:
            issues["orderPrecedesIntent"] += 1
            continue
        internal.setdefault(key, set()).add((run_id, iid))
        order_times[key] = at
        exchange_id = identity(row.get("exchangeOrderId"))
        if exchange_id:
            remote = (row["symbol"], exchange_id)
            order_links[remote].add((run_id, iid, key))
            verified_at = number(row.get("_eventAt", row.get("verifiedAt", row.get("updatedAt"))))
            if verified_at is not None and start <= verified_at <= end and row.get("status") in {"WORKING", "PARTIALLY_FILLED", "FILLED", "CANCELED", "EXPIRED"}:
                confirmations[run_id].add(remote)
    # A late conflicting export must revoke earlier apparent proof for the same identity.
    ambiguous = {remote for remote, links in order_links.items()
                 if len(links) != 1 or any(len(internal[link[2]]) != 1 for link in links)}
    if ambiguous:
        issues["ambiguousExchangeOrderIdentities"] += len(ambiguous)
        for remote in ambiguous:
            order_links.pop(remote)
        for remote_orders in confirmations.values():
            remote_orders.difference_update(ambiguous)
    linked_fills = {}
    for fill in records(data.get("fills", data.get("executionFills"))):
        at, qty = number(fill.get("executionTime", fill.get("filledAt"))), number(fill.get("qty", fill.get("quantity")))
        if at is not None and not start <= at <= end:
            continue
        remote = (fill.get("symbol"), identity(fill.get("exchangeOrderId", fill.get("orderId"))))
        links = order_links.get(remote, set())
        if not links:
            continue  # Includes exits and unrelated older entries: never infer by symbol alone.
        fid = identity(fill.get("tradeId", fill.get("fillId")))
        if at is None or not fid or qty is None or qty <= 0 or fill.get("source") not in EXCHANGE_SOURCES:
            issues["linkedFillEvidenceIncomplete"] += 1
            continue
        if len(links) != 1:
            issues["fillLineageAmbiguous"] += 1
            continue
        run_id, iid, oid = next(iter(links))
        if at < order_times[oid]:
            issues["fillPrecedesEntryOrder"] += 1
            continue
        key = (*remote, fid)
        proof = {"runId": run_id, "intentId": iid, "orderId": oid, "symbol": remote[0],
                 "exchangeOrderId": remote[1], "fillId": fid, "executionTime": int(at), "qty": qty,
                 "source": fill["source"], "observedAt": number(fill.get("observedAt", fill.get("receivedAt")))}
        if key in linked_fills and any(linked_fills[key][k] != proof[k] for k in ["runId", "intentId", "qty", "executionTime"]):
            raise ValueError("conflicting duplicate exchange fill identity")
        linked_fills[key] = proof
        confirmations[run_id].add(remote)
    rows = []
    changes = sorted(data.get("settingsChanges", []), key=lambda r: r["at"])
    for key, raw in sorted(selected.items(), key=lambda item: (item[1]["startedAt"], item[0])):
        completed = number(raw.get("completedAt"))
        state = raw.get("status", "UNKNOWN")
        known_terminal = state in TERMINAL and completed is not None and raw["startedAt"] <= completed <= end
        if not known_terminal:
            state = "RUNNING" if state == "RUNNING" or completed is not None and completed > end else "UNKNOWN"
        decision = raw.get("decision") if state == "COMPLETED" else None
        phase = next((p for p in phases if p["start"] <= raw["startedAt"] < p["end"]), None)
        if phase is None and raw["startedAt"] == end:
            phase = next((p for p in phases if p["end"] == end), None)
        prior = [change for change in changes if change["at"] <= raw["startedAt"]]
        actual = {"contractVersion": raw.get("outputContractVersion", raw.get("contractVersion")),
                  "settingsVersion": raw.get("settingsVersion", prior[-1]["settingsVersion"] if prior else None),
                  "scoutMode": raw.get("scoutMode")}
        config = {}
        for name, value in actual.items():
            declared = phase.get(name) if phase else None
            conflict = value is not None and declared is not None and value != declared
            config[name] = "CONFLICT" if conflict else value if value is not None else declared
            if conflict:
                issues["phaseConfigurationConflict"] += 1
        limit = min(completed, end) if completed is not None else end
        crossed = [p["id"] for p in phases if raw["startedAt"] < p["start"] <= limit]
        changed_settings = [r["settingsVersion"] for r in changes if raw["startedAt"] < r["at"] <= limit]
        refusals, waiting = set(), False
        for event in events:
            p = event["payload"]
            refs = {identity(p[k]) for k in ["runId", "brainRunId", "decisionChainId"] if identity(p.get(k))}
            if not refs and identity(p.get("intentId")):
                refs = intent_runs.get(str(p["intentId"]), set())
            if refs != {key}:
                continue
            if event["type"] in REJECTION_EVENTS and p.get("reason"):
                refusals.add(str(p["reason"]))
            waiting = waiting or event["type"] in WAIT_EVENTS
        execution = object_json(raw.get("execution"))
        # Exported execution projection is usable only with its own in-window update timestamp.
        updated = number(execution.get("updatedAt"))
        if updated is not None and start <= updated <= end and execution.get("lineageProven") is True:
            refusals.update(map(str, execution.get("blockReasons") or []))
            waiting = waiting or execution.get("executionState") in {"WAITING_PRICE", "WAIT_EXECUTION_RANGE"}
        fills = [f for f in linked_fills.values() if f["runId"] == key]
        failure = object_json(raw.get("failure"))
        code = (raw.get("failureCode") or failure.get("errorCode") or failure.get("code")) if state == "FAILED" else None
        rows.append({"runId": key, "symbol": raw.get("symbol"), "startedAt": raw["startedAt"],
                     "completedAt": int(completed) if known_terminal else None, "status": state, "decision": decision,
                     "failureCode": code, "latencyMs": completed - raw["startedAt"] if known_terminal else None,
                     "phaseId": phase["id"] if phase else "UNSPECIFIED", "configuration": config,
                     "phaseEvidenceRef": phase.get("evidenceRef") if phase else None,
                     "crossedConfigurationChanges": crossed, "crossedSettingsVersions": changed_settings,
                     "cohort": "CROSS_CONFIGURATION_IN_FLIGHT" if crossed or changed_settings else "WITHIN_CONFIGURATION",
                     "requestSource": raw.get("requestSource"), "refusalReasons": sorted(refusals), "waitingEvidence": waiting,
                     "intentIds": sorted(i for i, refs in intent_runs.items() if refs == {key}),
                     "orderIds": sorted(i for i, refs in internal.items() if len(refs) == 1 and next(iter(refs))[0] == key),
                     "confirmedExchangeOrders": [list(x) for x in sorted(confirmations[key])], "fills": fills,
                     "unverifiedFillProjection": execution.get("executionState") == "FILLED" and not fills})

    def summarize(items):
        fills = [f for r in items for f in r["fills"]]
        terminal = sum(r["status"] in TERMINAL for r in items)
        timeouts = sum(r["failureCode"] == "AI_TIMEOUT" for r in items)
        return {"uniqueRuns": len(items), "terminalRuns": terminal,
                "successfulModelCompletions": sum(r["status"] == "COMPLETED" for r in items),
                "statusCounts": dict(Counter(r["status"] for r in items)),
                "failureCodeCounts": dict(Counter(r["failureCode"] or "UNKNOWN" for r in items if r["status"] == "FAILED")),
                "decisionCounts": dict(Counter(r["decision"] or "UNKNOWN" for r in items if r["status"] == "COMPLETED")),
                "placeDecisions": sum(str(r["decision"]).startswith("PLACE_") for r in items),
                "waitDecisions": sum(r["decision"] == "WAIT_FOR_PRICE" for r in items),
                "executionRefusedRuns": sum(bool(r["refusalReasons"]) for r in items),
                "executionWaitingRuns": sum(r["waitingEvidence"] for r in items),
                "refusalReasonRunCounts": dict(Counter(reason for r in items for reason in r["refusalReasons"])),
                "uniqueIntents": len({i for r in items for i in r["intentIds"]}),
                "uniqueInternalOrders": len({i for r in items for i in r["orderIds"]}),
                "confirmedExchangeOrders": len({tuple(x) for r in items for x in r["confirmedExchangeOrders"]}),
                "uniqueExchangeFills": len(fills), "filledEntryIntents": len({f["intentId"] for f in fills}),
                "filledExchangeOrders": len({(f["symbol"], f["exchangeOrderId"]) for f in fills}),
                "fillObservationTimeUnknown": sum(f["observedAt"] is None for f in fills),
                "fillsObservedAfterCutoff": sum(f["observedAt"] is not None and f["observedAt"] > end for f in fills),
                "unverifiedFilledProjections": sum(r["unverifiedFillProjection"] for r in items),
                "timeoutRateOfTerminalRuns": timeouts / terminal if terminal else None,
                "configurationUnknownRuns": sum(any(v is None or v == "CONFLICT" for v in r["configuration"].values()) for r in items)}
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row["phaseId"], json.dumps(row["configuration"], sort_keys=True), row["cohort"])].append(row)
    coverage = data.get("coverage", {})
    return {"schemaVersion": "ENTRY_QUALITY_PHASE_AUDIT_1", "status": "INCOMPLETE_EVIDENCE" if coverage.get("runs") in {"PARTIAL_BASELINE_SUMMARY", "DETAIL_EXPORT_COMPLETENESS_UNKNOWN"} else "OFFLINE_AUDIT_COMPLETE",
            "source": data.get("source"), "window": {"start": start, "end": end, "bounds": "INCLUSIVE", "cohort": "PRIMARY_ENTRY_RUN_START", "extended": False},
            "coverage": coverage, "configurationPhases": phases,
            "summary": summarize(rows), "phaseSummary": [{"phaseId": p, "configuration": json.loads(c), "cohort": cohort, **summarize(group)} for (p, c, cohort), group in grouped.items()],
            "runs": rows, "evidenceIssues": dict(issues), "reportedBaseline": data.get("reportedBaseline"),
            "limitations": ["Counts describe retained evidence, not proof that absent records/events never occurred.",
                            "Run start determines cohort. Completion, rejection events and execution times are cut at the supplied end; it is never extended.",
                            "Canonical fills are retrospective exchange facts by execution time; missing observation time is UNKNOWN, not proof they were known at cutoff.",
                            "PLACE, ENTRY_FILLED event totals and executionState=FILLED without unique exchange fill facts are not independent filled entries.",
                            "Filled entry intents deduplicate partial fills; they are not statistically independent strategy samples or proof of complete profitable exits.",
                            "No current Settings inference for scoutMode; missing historical configuration stays null. Declared phase values require a separate evidence reference."],
            "actions": {"engineLifecycle": 0, "modelRequests": 0, "exchangeRequests": 0, "configurationChanges": 0}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--db", type=Path)
    source.add_argument("--json", type=Path)
    parser.add_argument("--start", required=True, type=timestamp)
    parser.add_argument("--end", required=True, type=timestamp)
    parser.add_argument("--phases", type=Path, help="JSON list or {configurationPhases:[...]}; historical evidenceRef required")
    parser.add_argument("--output", type=Path, help="optional new report file; never overwrites existing files")
    parser.add_argument("--max-rows", type=int, default=200000)
    args = parser.parse_args()
    if args.start >= args.end or args.max_rows <= 0:
        parser.error("start must precede end and max-rows must be positive")
    data = load_sqlite(args.db, args.start, args.end, args.max_rows) if args.db else load_json(args.json)
    phases = None
    if args.phases:
        phases = json.loads(args.phases.read_text())
        if isinstance(phases, dict):
            phases = phases["configurationPhases"]
    report = audit(data, args.start, args.end, phases)
    output = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(output)
        print(json.dumps({"status": report["status"], "output": str(args.output.resolve()), "summary": report["summary"]}, ensure_ascii=False))
    else:
        print(output, end="")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, sqlite3.Error, OSError, KeyError) as error:
        print(json.dumps({"status": "AUDIT_FAILED", "errorType": type(error).__name__, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
