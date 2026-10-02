"""Offline invariant tests; temporary fixtures only, no engine/provider/exchange calls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("audit_entry", Path(__file__).with_name("audit-entry-quality-phases.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def run(key="r1", **extra):
    return {"id": key, "role": "PRIMARY_BRAIN", "requestSource": "ENTRY", "symbol": "BTCUSDT",
            "startedAt": 110, "completedAt": 140, "status": "COMPLETED", "decision": "PLACE_LONG", **extra}


def fixture():
    return {"runs": [run()], "intents": [{"id": "i1", "brainRunId": "r1", "createdAt": 145, "symbol": "BTCUSDT"}],
            "orders": [{"id": "o1", "intentId": "i1", "symbol": "BTCUSDT", "exchangeOrderId": "42",
                        "createdAt": 150, "updatedAt": 152, "status": "WORKING"}],
            "fills": [{"fillId": "f1", "tradeId": "7", "orderId": "42", "symbol": "BTCUSDT", "qty": .1,
                       "executionTime": 160, "source": "EXCHANGE_AUDIT"}]}


class AuditTests(unittest.TestCase):
    def test_cutoff_censors_later_model_and_exchange_outcomes(self):
        data = fixture()
        data["runs"] += [run("r2", startedAt=195, completedAt=220), run("before", startedAt=99)]
        data["fills"].append({**data["fills"][0], "tradeId": "8", "executionTime": 201})
        data["events"] = [{"id": "late", "ts": 201, "type": "CANDIDATE_REJECTED", "payload": {"brainRunId": "r1", "reason": "LATE"}}]
        report = audit.audit(data, 100, 200)
        self.assertEqual(report["summary"]["uniqueRuns"], 2)
        self.assertEqual(report["summary"]["terminalRuns"], 1)
        self.assertEqual(report["summary"]["uniqueExchangeFills"], 1)
        self.assertEqual(report["runs"][1]["status"], "RUNNING")
        self.assertIsNone(report["runs"][1]["decision"])
        self.assertFalse(report["window"]["extended"])
        self.assertEqual(report["summary"]["executionRefusedRuns"], 0)

    def test_place_and_filled_events_are_not_fill_identities(self):
        data = {"runs": [run(execution={"executionState": "FILLED", "lineageProven": True, "updatedAt": 180})],
                "events": [{"id": "e", "ts": 160, "type": "ENTRY_FILLED", "payload": {"brainRunId": "r1", "fillCount": 20}}]}
        summary = audit.audit(data, 100, 200)["summary"]
        self.assertEqual(summary["placeDecisions"], 1)
        self.assertEqual(summary["uniqueExchangeFills"], 0)
        self.assertEqual(summary["unverifiedFilledProjections"], 1)

    def test_duplicate_partial_fills_are_one_filled_entry(self):
        data = fixture()
        data["fills"] += [dict(data["fills"][0]), {**data["fills"][0], "tradeId": "8", "qty": .2},
                          {**data["fills"][0], "orderId": "exit-42", "tradeId": "9"}]
        summary = audit.audit(data, 100, 200)["summary"]
        self.assertEqual(summary["uniqueExchangeFills"], 2)
        self.assertEqual(summary["filledEntryIntents"], 1)
        self.assertEqual(summary["filledExchangeOrders"], 1)
        self.assertEqual(summary["fillObservationTimeUnknown"], 2)

    def test_missing_lineage_or_exchange_source_never_counts(self):
        data = fixture()
        data["intents"] = []
        self.assertEqual(audit.audit(data, 100, 200)["summary"]["uniqueExchangeFills"], 0)
        data = fixture()
        data["fills"][0]["source"] = "SIMULATION"
        report = audit.audit(data, 100, 200)
        self.assertEqual(report["summary"]["uniqueExchangeFills"], 0)
        self.assertEqual(report["evidenceIssues"]["linkedFillEvidenceIncomplete"], 1)

    def test_conflicting_fill_identity_fails_instead_of_adding(self):
        data = fixture()
        data["fills"].append({**data["fills"][0], "qty": 4})
        with self.assertRaisesRegex(ValueError, "conflicting duplicate"):
            audit.audit(data, 100, 200)

    def test_conflicting_order_links_revoke_confirmation_and_fill(self):
        data = fixture()
        data["runs"].append(run("r2"))
        data["intents"].append({"id": "i2", "brainRunId": "r2", "createdAt": 145, "symbol": "BTCUSDT"})
        data["orders"].append({**data["orders"][0], "intentId": "i2"})
        report = audit.audit(data, 100, 200)
        self.assertEqual(report["summary"]["confirmedExchangeOrders"], 0)
        self.assertEqual(report["summary"]["uniqueExchangeFills"], 0)
        self.assertEqual(report["evidenceIssues"]["ambiguousExchangeOrderIdentities"], 1)

    def test_fill_time_must_follow_entry_creation(self):
        data = fixture()
        data["fills"][0]["executionTime"] = 149
        report = audit.audit(data, 100, 200)
        self.assertEqual(report["summary"]["uniqueExchangeFills"], 0)
        self.assertEqual(report["evidenceIssues"]["fillPrecedesEntryOrder"], 1)

    def test_actual_and_declared_config_crossing_stay_separate(self):
        phases = [{"id": "200s", "start": 100, "end": 150, "settingsVersion": 29, "scoutMode": "SERIAL", "evidenceRef": "receipt-29"},
                  {"id": "300s", "start": 150, "end": 201, "settingsVersion": 30, "scoutMode": "OFF", "evidenceRef": "receipt-30"}]
        data = {"runs": [run(completedAt=180, outputContractVersion="V3.9.7"),
                         run("r2", startedAt=150, completedAt=190, outputContractVersion="V3.9.8")],
                "settingsChanges": [{"at": 100, "settingsVersion": 29}, {"at": 150, "settingsVersion": 30}]}
        report = audit.audit(data, 100, 200, phases)
        first, second = report["runs"]
        self.assertEqual(first["phaseId"], "200s")
        self.assertEqual(first["crossedConfigurationChanges"], ["300s"])
        self.assertEqual(first["cohort"], "CROSS_CONFIGURATION_IN_FLIGHT")
        self.assertEqual(second["phaseId"], "300s")
        self.assertEqual(second["cohort"], "WITHIN_CONFIGURATION")
        self.assertEqual(len(report["phaseSummary"]), 2)

    def test_run_at_cutoff_and_phase_start_uses_new_phase(self):
        phases = [{"id": "old", "start": 100, "end": 200}, {"id": "new", "start": 200, "end": 300}]
        report = audit.audit({"runs": [run(startedAt=200, completedAt=220)]}, 100, 200, phases)
        self.assertEqual(report["runs"][0]["phaseId"], "new")

    def test_unknown_configuration_and_terminal_timestamp_not_invented(self):
        report = audit.audit({"runs": [run(completedAt=None)]}, 100, 200)
        self.assertEqual(report["summary"]["terminalRuns"], 0)
        self.assertEqual(report["summary"]["configurationUnknownRuns"], 1)
        self.assertIsNone(report["runs"][0]["configuration"]["scoutMode"])

    def test_refusals_deduplicate_by_run_and_reason(self):
        events = [{"id": "e1", "type": "ENTRY_DECISION_BLOCKED", "ts": 145, "payload": {"runId": "r1", "reason": "JIT"}},
                  {"id": "e2", "type": "CANDIDATE_REJECTED", "ts": 146, "payload": {"brainRunId": "r1", "reason": "JIT"}}]
        report = audit.audit({"runs": [run(), run("r2", status="FAILED", decision=None, failure={"errorCode": "AI_TIMEOUT"})], "events": events}, 100, 200)
        self.assertEqual(report["summary"]["executionRefusedRuns"], 1)
        self.assertEqual(report["summary"]["refusalReasonRunCounts"], {"JIT": 1})
        self.assertEqual(report["summary"]["timeoutRateOfTerminalRuns"], .5)

    def test_non_entry_and_scout_runs_excluded(self):
        report = audit.audit({"runs": [run(), run("scout", role="SCOUT"), run("exit", requestSource="POSITION_REVIEW")]}, 100, 200)
        self.assertEqual(report["summary"]["uniqueRuns"], 1)

    def test_phase_overlap_and_unreferenced_config_rejected(self):
        with self.assertRaisesRegex(ValueError, "evidenceRef"):
            audit.audit({"runs": []}, 100, 200, [{"start": 100, "end": 200, "scoutMode": "OFF"}])
        with self.assertRaisesRegex(ValueError, "overlapping"):
            audit.audit({"runs": []}, 100, 200, [{"start": 100, "end": 180}, {"start": 150, "end": 200}])

    def test_summary_export_remains_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "summary.json"
            path.write_text(json.dumps({"postDeployment": {"uniqueRuns": 163}, "placeRuns": [run()], "recentRunRows": [run()]}))
            report = audit.audit(audit.load_json(path), 100, 200)
            self.assertEqual(report["status"], "INCOMPLETE_EVIDENCE")
            self.assertEqual(report["summary"]["uniqueRuns"], 1)
            self.assertEqual(report["reportedBaseline"]["uniqueRuns"], 163)

    def test_sqlite_readonly_bounded_snapshot_matches_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "archive.sqlite"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE ai_runs_archive(run_id TEXT,started_at INTEGER,payload TEXT)")
            db.execute("INSERT INTO ai_runs_archive VALUES(?,?,?)", ("r1", 110, json.dumps(run())))
            db.execute("CREATE TABLE runtime_entities(kind TEXT,payload TEXT)")
            for kind, key in [("entryIntents", "intents"), ("entryOrders", "orders"), ("executionFills", "fills")]:
                for row in fixture()[key]:
                    db.execute("INSERT INTO runtime_entities VALUES(?,?)", (kind, json.dumps(row)))
            db.commit()
            db.close()
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            report = audit.audit(audit.load_sqlite(path, 100, 200, 10), 100, 200)
            self.assertEqual(report["summary"], audit.audit(fixture(), 100, 200)["summary"])
            self.assertEqual(before, hashlib.sha256(path.read_bytes()).hexdigest())
            with self.assertRaises(ValueError):
                audit.load_sqlite(Path(tmp) / "absent.sqlite", 100, 200, 10)
            self.assertFalse((Path(tmp) / "absent.sqlite").exists())

    def test_cli_never_overwrites_input_or_existing_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "input.json"
            path.write_text(json.dumps(fixture()))
            before = path.read_bytes()
            result = subprocess.run([sys.executable, str(Path(audit.__file__)), "--json", str(path),
                                     "--start", "100", "--end", "200", "--output", str(path)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(json.loads(result.stderr)["errorType"], "FileExistsError")


if __name__ == "__main__":
    unittest.main()
