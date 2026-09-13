import { mkdir, readFile, stat, link, unlink } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { SystemSettingsSchema, type SystemSettings } from "@zdj/contracts";
import { WindowsCredentialManagerSecretStore } from "./windowsCredentialManagerSecretStore.js";
import { WindowsDpapiSecretStore } from "./windowsDpapiSecretStore.js";
import { redactAudit } from "../api/projections.js";
import { isTelemetry } from '../services/operationalLogger.js';
import { activeOrderStatus, type ManualExecutionRecord, type EntryExecutionRecord } from '../services/executionLifecycle.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function merge(defaults: unknown, override: unknown): unknown {
  if (!record(defaults) || !record(override)) return override ?? defaults;
  const result = { ...defaults };
  for (const [key, value] of Object.entries(override))
    result[key] = key in defaults ? merge(defaults[key], value) : value;
  return result;
}
function migrate(value: unknown): unknown {
  if (!record(value)) return value;
  const next = structuredClone(value) as Record<string, unknown>;
  if (record(next.connections)) {
    const c = next.connections as Record<string, unknown>;
    c.marketDataMode = "BINANCE";
    c.aiMode = "OPENAI_COMPATIBLE";
    if (c.executionMode === "MOCK" || c.executionMode === "EXTERNAL")
      c.executionMode = "READ_ONLY";
  }
  if (!record(next.appearance))
    next.appearance = {
      theme: "BINANCE_NOIR",
      density: "COMFORTABLE",
      numberFont: "TABULAR",
    };
  else if (
    [
      "EXCHANGE_NOIR",
      "USD_RESERVE",
      "RMB_JADE",
      "SAPPHIRE_QUANT",
      "GRAPHITE_PEARL",
    ].includes(String((next.appearance as any).theme))
  )
    (next.appearance as any).theme = "BINANCE_NOIR";
  if(record(next.selection)){
    const selection=next.selection as Record<string,unknown>;
    const priorTarget=Number(selection.poolTarget??20),priorMax=Number(selection.poolMax??24);
    selection.poolTarget=priorTarget===10&&priorMax===12?20:priorTarget;
    selection.poolMax=priorTarget===10&&priorMax===12?24:Math.max(priorMax,Number(selection.poolTarget));
  }
  // V3.6.1 makes the operational margin floor real and small-capital safe.
  // The former $20 value was displayed but not enforced; the former fixed $5
  // TP profit floor made exchange-minimum positions economically unreachable.
  if (Number(next.settingsVersion ?? 0) <= 15) {
    if (record(next.portfolioIntelligence) && Number((next.portfolioIntelligence as any).minMarginUsd) === 20)
      (next.portfolioIntelligence as any).minMarginUsd = 1;
    if (record(next.takeProfit) && Number((next.takeProfit as any).minNetProfitUsd) === 5) {
      (next.takeProfit as any).minNetProfitUsd = .01;
      (next.takeProfit as any).minNetProfitRoiPct = .15;
    }
    next.settingsVersion = 16;
  }
  // V3.6.2 replaces legacy generic direction labels with explicit, persistent
  // user preference scopes.  Keep legacy fields for historical records only.
  if (Number(next.settingsVersion ?? 0) <= 17) {
    const pi=(next.portfolioIntelligence??={}) as Record<string,unknown>;
    const legacy=(value:unknown)=>value==='SHORT_ONLY'?'SHORT_ONLY':value==='SHORT_BIASED'?'INTELLIGENT_SHORT_BIAS':value==='LONG_BIASED'?'CUSTOM':value==='BOTH'?'BALANCED':undefined;
    pi.globalDirectionPreference=pi.globalDirectionPreference??legacy(pi.globalDirectionPolicy)??'INTELLIGENT_SHORT_BIAS';
    pi.tierDirectionPreferences=pi.tierDirectionPreferences??{CORE:'BALANCED',LIQUID_ALT:'INTELLIGENT_SHORT_BIAS',SPECULATIVE:'STRICT_SHORT_BIAS',NEW_LISTING:'SHORT_ONLY'};
    pi.symbolDirectionPreferences=pi.symbolDirectionPreferences??Object.fromEntries(Object.entries((pi.symbolDirectionPolicies??{}) as Record<string,unknown>).map(([k,v])=>[k,legacy(v)??'CUSTOM']));
    pi.altLongMarginFactors=pi.altLongMarginFactors??{CORE:1,LIQUID_ALT:.65,SPECULATIVE:.35,NEW_LISTING:.1};
    pi.altLongLeverageCaps=pi.altLongLeverageCaps??{CORE:20,LIQUID_ALT:8,SPECULATIVE:3,NEW_LISTING:1};
    next.settingsVersion=18;
  }
  if(!record(next.releasePolicy)||Number(next.releasePolicy.lifecycleVersion??0)<390){
    next.releasePolicy={...(record(next.releasePolicy)?next.releasePolicy:{}),lifecycleVersion:390};
    const external=(next.externalIntelligence??={}) as Record<string,unknown>;
    external.researchEnabled=true; // User-approved V3.9 continuous research duty; no Primary feed permission.
  }
  return next;
}

export class SettingsStore {
  private current!: SystemSettings;
  private db!: DatabaseSync;
  private runtimeEntityCache:Map<string,string>|null=null;
  private runtimeCheckpointStats={entityWrites:0,checkpointBytes:0,durationMs:0};
  private retentionCursor=0;
  private baselineFlights=new Map<string,Promise<string>>();
  checkpointMetrics(){return this.runtimeCheckpointStats;}
  private transactionActive = false;
  private operationalWorker:Worker|null=null;
  private operationalCache: {
    at: number;
    value: {
      integrity: boolean | null;
      status: "HEALTHY" | "OFFLINE" | "UNKNOWN";
      auditEvents: number;
      runtimePersistedAt: number | null;
      checkedAt: number | null;
      error: string | null;
    };
  } | null = null;
  private readonly secrets = new WindowsCredentialManagerSecretStore();
  private readonly machineDpapi = new WindowsDpapiSecretStore("LocalMachine");
  constructor(
    private configDir: string,
    private dataDir: string,
  ) {}
  private async open() {
    if (this.db) return;
    await mkdir(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dataDir, "zdj-settings.sqlite"));
    this.db.exec(
      "PRAGMA busy_timeout=250; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA journal_size_limit=67108864;",
    );
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS settings_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, changed_at INTEGER NOT NULL, source TEXT NOT NULL, old_version INTEGER, new_version INTEGER NOT NULL, summary TEXT NOT NULL); CREATE TABLE IF NOT EXISTS secrets (ref TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, last4 TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS connection_profiles (id TEXT PRIMARY KEY, profile TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS runtime_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS runtime_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, ts INTEGER NOT NULL, symbol TEXT, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS runtime_events_ts ON runtime_events(ts); CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`,
    );
    this.db.exec('CREATE TABLE IF NOT EXISTS runtime_entities(kind TEXT NOT NULL,entity_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,entity_id));');
    // Legacy hourly trigger deleted audit facts and ran unbounded work inside an event INSERT.
    this.db.exec('DROP TRIGGER IF EXISTS zdj_hourly_storage_retention');
    const migration = this.db
      .prepare("SELECT version FROM schema_migrations WHERE version=1")
      .get() as { version: number } | undefined;
    if (!migration) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS trade_records (trade_id TEXT PRIMARY KEY, status TEXT NOT NULL, symbol TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS trade_records_status_updated ON trade_records(status, updated_at); CREATE TABLE IF NOT EXISTS experience_samples (sample_id TEXT PRIMARY KEY, trade_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS experience_samples_created ON experience_samples(created_at); CREATE TABLE IF NOT EXISTS exchange_resources (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS proxy_resources (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS ai_resources (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,${Date.now()});`,
        );
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const syncMigration = this.db
      .prepare("SELECT version FROM schema_migrations WHERE version=2")
      .get() as { version: number } | undefined;
    if (!syncMigration) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS trade_sync_history (sync_id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS trade_sync_history_created ON trade_sync_history(created_at); INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,${Date.now()});`,
        );
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const governanceMigration = this.db
      .prepare("SELECT version FROM schema_migrations WHERE version=3")
      .get() as { version: number } | undefined;
    if (!governanceMigration) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS ai_runs_archive (run_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, started_at INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS ai_runs_archive_started ON ai_runs_archive(started_at); CREATE TABLE IF NOT EXISTS decision_chains (chain_id TEXT PRIMARY KEY, symbol TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS decision_chains_updated ON decision_chains(updated_at); INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,${Date.now()});`,
        );
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const snapshotMigration = this.db
      .prepare("SELECT version FROM schema_migrations WHERE version=4")
      .get() as { version: number } | undefined;
    if (!snapshotMigration) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS decision_snapshots (snapshot_id TEXT PRIMARY KEY, candidate_id TEXT, symbol TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS decision_snapshots_created ON decision_snapshots(created_at); INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,${Date.now()});`,
        );
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const temporalMigration = this.db
      .prepare("SELECT version FROM schema_migrations WHERE version=5")
      .get() as { version: number } | undefined;
    if (!temporalMigration) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS shadow_mark_series (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, symbol TEXT NOT NULL, mark REAL NOT NULL, bid REAL, ask REAL, snapshot_id TEXT);
      CREATE INDEX IF NOT EXISTS decision_snapshots_symbol_created ON decision_snapshots(symbol,created_at);
      CREATE INDEX IF NOT EXISTS shadow_mark_symbol_ts ON shadow_mark_series(symbol,ts);
      CREATE TABLE IF NOT EXISTS decision_episodes (
        episode_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, packet_id TEXT, scout_run_id TEXT,
        symbol TEXT NOT NULL, underlying TEXT NOT NULL, quote_asset TEXT NOT NULL, decided_at INTEGER NOT NULL,
        direction TEXT, decision TEXT, completeness TEXT NOT NULL, outcome_status TEXT NOT NULL,
        snapshot_id TEXT, risk_tier TEXT, liquidity_class TEXT, regime_state TEXT, regime_age_ms INTEGER,
        transition_score REAL, fingerprint TEXT, would_reuse INTEGER NOT NULL DEFAULT 0,
        return_15m REAL, return_1h REAL, return_4h REAL, return_24h REAL, return_3d REAL, return_7d REAL,
        mfe REAL, mae REAL, feature_json TEXT NOT NULL, decision_json TEXT NOT NULL, outcome_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS decision_episodes_decided ON decision_episodes(decided_at);
      CREATE INDEX IF NOT EXISTS decision_episodes_symbol_decided ON decision_episodes(symbol,decided_at);
      CREATE INDEX IF NOT EXISTS decision_episodes_underlying_decided ON decision_episodes(underlying,decided_at);
      CREATE INDEX IF NOT EXISTS decision_episodes_analog ON decision_episodes(risk_tier,liquidity_class,decided_at);
      CREATE TABLE IF NOT EXISTS regime_samples (
        sample_at INTEGER PRIMARY KEY, state TEXT NOT NULL, confidence REAL NOT NULL, bullish_breadth REAL,
        bearish_breadth REAL, neutral_breadth REAL, breadth_slope REAL, breadth_acceleration REAL,
        breadth_persistence INTEGER, eligible_count INTEGER NOT NULL, btc_eth_alignment TEXT,
        volatility REAL, extension REAL, multi_tf_conflict REAL, transition_v1 REAL, transition_v2 REAL,
        transition_v3 REAL, feature_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS regime_episodes (
        regime_id TEXT PRIMARY KEY, state TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
        confidence REAL NOT NULL, breadth_start REAL, breadth_peak REAL, breadth_current REAL,
        transition_score REAL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS regime_episodes_started ON regime_episodes(started_at);
      CREATE TABLE IF NOT EXISTS research_candidates (
        candidate_id TEXT PRIMARY KEY, kind TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL,
        status TEXT NOT NULL, proposed_at INTEGER NOT NULL, feature_set TEXT NOT NULL, formula TEXT NOT NULL,
        code_hash TEXT NOT NULL, training_window TEXT, validation_windows TEXT, metrics_json TEXT NOT NULL,
        hypothesis TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state_change_observations (
        run_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, observed_at INTEGER NOT NULL, fingerprint TEXT NOT NULL,
        would_reuse INTEGER NOT NULL, material_change INTEGER NOT NULL, reason TEXT NOT NULL,
        scout_tokens INTEGER NOT NULL, primary_tokens INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS state_change_observed ON state_change_observations(observed_at);
      CREATE TABLE IF NOT EXISTS temporal_jobs (
        job_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER,
        completed_at INTEGER, cursor TEXT, error TEXT, metrics_json TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,${Date.now()});
    `);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const liveValidationMigration = this.db
      .prepare("SELECT version FROM schema_migrations WHERE version=6")
      .get() as { version: number } | undefined;
    if (!liveValidationMigration) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS capital_epochs (
            capital_epoch_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, reason TEXT NOT NULL,
            status TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS capital_epochs_started ON capital_epochs(started_at);
          CREATE TABLE IF NOT EXISTS weekly_live_validations (
            validation_id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at INTEGER NOT NULL,
            required_until INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS weekly_live_validations_started ON weekly_live_validations(started_at);
          CREATE TABLE IF NOT EXISTS live_validation_daily_summaries (
            summary_id TEXT PRIMARY KEY, validation_id TEXT NOT NULL, day_key TEXT NOT NULL,
            generated_at INTEGER NOT NULL, payload TEXT NOT NULL,
            UNIQUE(validation_id,day_key)
          );
          INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(6,${Date.now()});
        `);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const externalIntelligenceMigration = this.db
      .prepare("SELECT version FROM schema_migrations WHERE version=7")
      .get() as { version: number } | undefined;
    const externalIntelligenceTables = new Set(
      (
        this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('external_intelligence_snapshots','external_provider_state')",
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    if (
      !externalIntelligenceMigration ||
      !externalIntelligenceTables.has("external_intelligence_snapshots") ||
      !externalIntelligenceTables.has("external_provider_state")
    ) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS external_intelligence_snapshots (id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_id TEXT NOT NULL, available_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL, received_at INTEGER NOT NULL, UNIQUE(provider,source_id,content_hash)); CREATE INDEX IF NOT EXISTS external_intelligence_available ON external_intelligence_snapshots(available_at,expires_at); CREATE TABLE IF NOT EXISTS external_provider_state (provider TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(7,${Date.now()});`,
        );
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const aiArchiveColumns = new Set(
      (this.db.prepare("PRAGMA table_info(ai_runs_archive)").all() as Array<{name:string}>).map(row=>row.name),
    );
    const aiArchiveSummaryColumns: Array<[string,string]> = [
      ['role','TEXT'],['model','TEXT'],['decision','TEXT'],['direction','TEXT'],
      ['completed_at','INTEGER'],['latency_ms','INTEGER'],['input_tokens','INTEGER'],
      ['output_tokens','INTEGER'],['short_reason','TEXT'],
    ];
    for (const [name,type] of aiArchiveSummaryColumns) if (!aiArchiveColumns.has(name)) try{
      this.db.exec(`ALTER TABLE ai_runs_archive ADD COLUMN ${name} ${type}`);
    }catch(error){if(!String(error).includes('duplicate column name'))throw error;}
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS ai_runs_archive_stable ON ai_runs_archive(started_at DESC,run_id DESC);
      CREATE INDEX IF NOT EXISTS ai_runs_archive_symbol_stable ON ai_runs_archive(symbol,started_at DESC,run_id DESC);
      CREATE INDEX IF NOT EXISTS ai_runs_archive_role_stable ON ai_runs_archive(role,started_at DESC,run_id DESC);
      CREATE INDEX IF NOT EXISTS ai_runs_archive_status_stable ON ai_runs_archive(status,started_at DESC,run_id DESC);
      CREATE INDEX IF NOT EXISTS ai_runs_archive_decision_stable ON ai_runs_archive(decision,started_at DESC,run_id DESC);
      CREATE INDEX IF NOT EXISTS ai_runs_archive_symbol_decision ON ai_runs_archive(symbol,decision,started_at DESC,run_id DESC);
      CREATE INDEX IF NOT EXISTS ai_runs_archive_role_status_decision ON ai_runs_archive(role,status,decision,started_at DESC,run_id DESC);
      INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(8,${Date.now()});
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS external_research_tasks (
        content_hash TEXT PRIMARY KEY, source_id TEXT NOT NULL, status TEXT NOT NULL,
        available_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL, payload TEXT NOT NULL, result TEXT,
        error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS external_research_ready ON external_research_tasks(status,next_attempt_at,available_at);
      INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(9,${Date.now()});
    `);
    const researchColumns=new Set((this.db.prepare('PRAGMA table_info(external_research_tasks)').all() as Array<{name:string}>).map(row=>row.name));
    if(!researchColumns.has('expires_at'))try{this.db.exec('ALTER TABLE external_research_tasks ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 9223372036854775807');}catch(error){if(!String(error).includes('duplicate column name'))throw error;}
    this.db.exec(`CREATE TABLE IF NOT EXISTS execution_tasks (
      intent_id TEXT PRIMARY KEY, scope TEXT NOT NULL, active INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL
    ); CREATE UNIQUE INDEX IF NOT EXISTS execution_tasks_active_scope ON execution_tasks(scope) WHERE active=1;`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS entry_execution_tasks(intent_id TEXT PRIMARY KEY,scope TEXT NOT NULL,active INTEGER NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS entry_execution_scope ON entry_execution_tasks(scope) WHERE active=1;`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS ai_runs_summary_symbol_decision_nocase ON ai_runs_archive(symbol COLLATE NOCASE,decision COLLATE NOCASE,started_at DESC,run_id DESC);
      CREATE INDEX IF NOT EXISTS ai_runs_summary_role_status_nocase ON ai_runs_archive(role COLLATE NOCASE,status COLLATE NOCASE,started_at DESC,run_id DESC);
      CREATE INDEX IF NOT EXISTS ai_runs_summary_decision_nocase ON ai_runs_archive(decision COLLATE NOCASE,started_at DESC,run_id DESC);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS external_research_retention ON external_research_tasks(updated_at);
      CREATE INDEX IF NOT EXISTS temporal_jobs_retention ON temporal_jobs(completed_at);
      CREATE INDEX IF NOT EXISTS ai_raw_retention ON ai_runs_archive(started_at) WHERE payload<>'{}' AND status IN ('COMPLETED','FAILED','CANCELED');`);
    const secretColumns = new Set(
      (
        this.db.prepare("PRAGMA table_info(secrets)").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    if (!secretColumns.has("last4"))
      try {
        this.db.exec(
          "ALTER TABLE secrets ADD COLUMN last4 TEXT NOT NULL DEFAULT ''",
        );
      } catch (error) {
        if (!String(error).includes("duplicate column name")) throw error;
      }
    // Retire legacy DPAPI ciphertext: SQLite retains metadata only; secrets live in Credential Manager.
    this.db
      .prepare(
        "DELETE FROM secrets WHERE ciphertext NOT LIKE 'credential-manager:%' AND ciphertext NOT LIKE 'machine-dpapi:%'",
      )
      .run();
  }
  private async defaults() {
    return JSON.parse(
      await readFile(
        path.join(this.configDir, "settings.default.json"),
        "utf8",
      ),
    ) as unknown;
  }
  async load(): Promise<SystemSettings> {
    await this.open();
    const row = this.db
      .prepare("SELECT payload FROM settings WHERE id=1")
      .get() as { payload: string } | undefined;
    if (row) {
      this.current = SystemSettingsSchema.parse(
        migrate(JSON.parse(row.payload)),
      );
      this.migrateCredentialNamespace();
      this.seedResources(this.current);
      this.persist(
        this.current,
        "v3.2-migration",
        this.current.settingsVersion,
      );
      this.seedOperationalMetrics();
      return this.current;
    }
    let legacy: unknown;
    try {
      legacy = JSON.parse(
        await readFile(path.join(this.dataDir, "settings.json"), "utf8"),
      );
    } catch {
      legacy = undefined;
    }
    this.current = SystemSettingsSchema.parse(
      migrate(merge(await this.defaults(), legacy)),
    );
    this.migrateCredentialNamespace();
    this.seedResources(this.current);
    this.persist(this.current, "bootstrap", null);
    this.seedOperationalMetrics();
    return this.current;
  }
  get() {
    return this.current;
  }
  dataDirectory() {
    return this.dataDir;
  }
  private seedResources(settings: SystemSettings) {
    if (!this.resourceList("ai").length)
      for (const resource of settings.aiResources)
        this.resourceSave("ai", resource);
    if (!this.resourceList("exchange").length)
      this.resourceSave("exchange", {
        id: "binance-usdm-testnet",
        name: "Binance USD-M",
        type: "BINANCE_USDM",
        environment: settings.connections.exchange.environment,
        enabled: false,
        status: "READY",
      });
    if (!this.resourceList("proxy").length)
      this.resourceSave("proxy", {
        id: "socks5h-default",
        name: "SOCKS5H 默认代理",
        type: "SOCKS5H",
        url: settings.connections.proxy.url,
        enabled: settings.connections.proxy.enabled,
        status: "READY",
      });
  }
  private persist(
    next: SystemSettings,
    source: string,
    oldVersion: number | null,
  ) {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db.prepare('SELECT payload FROM settings WHERE id=1').get() as {payload:string}|undefined;
      const previousCapacity = old ? JSON.parse(old.payload).portfolio?.maxPositions ?? null : null;
      this.db
        .prepare(
          "INSERT INTO settings(id,version,payload,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at",
        )
        .run(next.settingsVersion, JSON.stringify(next), now);
      this.db
        .prepare(
          "INSERT INTO settings_audit(changed_at,source,old_version,new_version,summary) VALUES(?,?,?,?,?)",
        )
        .run(
          now,
          source,
          oldVersion,
          next.settingsVersion,
          JSON.stringify({message:'non-secret system settings updated',maxPositions:{before:previousCapacity,after:next.portfolio.maxPositions}}),
        );
      this.db
        .prepare(
          "INSERT INTO connection_profiles(id,profile,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile,updated_at=excluded.updated_at",
        )
        .run(
          "active",
          JSON.stringify({
            connections: next.connections,
            aiResources: next.aiResources,
          }),
          now,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async save(next: unknown): Promise<SystemSettings> {
    await this.open();
    const parsed = SystemSettingsSchema.parse(next);
    const version = Math.max(
      (this.current?.settingsVersion ?? 0) + 1,
      parsed.settingsVersion + 1,
    );
    const updated = { ...parsed, settingsVersion: version };
    this.persist(updated, "api", version - 1);
    this.current = updated;
    return this.current;
  }
  async saveIfVersion(next:unknown,expectedVersion:number):Promise<SystemSettings>{
    await this.open();
    // No await occurs after the comparison: parse, transaction and publication
    // are one synchronous critical section in this store instance.
    if(this.current.settingsVersion!==expectedVersion)throw new Error('SETTINGS_VERSION_CONFLICT');
    const parsed=SystemSettingsSchema.parse(next),updated={...parsed,settingsVersion:expectedVersion+1};
    this.persist(updated,'cas',expectedVersion);
    this.current=updated;
    return updated;
  }
  private target(ref: string) {
    return `ZDJ-MITS/V3.1/${this.current.connections.exchange.environment}/${ref}`;
  }
  private dbRef(ref: string) {
    return `${this.current.connections.exchange.environment}:${ref}`;
  }
  private migrateCredentialNamespace() {
    const env = this.current.connections.exchange.environment;
    for (const row of this.db
      .prepare(
        "SELECT ref,ciphertext,last4,updated_at FROM secrets WHERE ref NOT LIKE 'TESTNET:%' AND ref NOT LIKE 'PRODUCTION:%'",
      )
      .all() as Array<{
      ref: string;
      ciphertext: string;
      last4: string;
      updated_at: number;
    }>) {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO secrets(ref,ciphertext,last4,updated_at) VALUES(?,?,?,?)",
        )
        .run(`${env}:${row.ref}`, row.ciphertext, row.last4, row.updated_at);
    }
  }
  private async writeMetadata(
    ref: string,
    plaintext: string,
    now = Date.now(),
    ciphertext = `credential-manager:${this.target(ref)}`,
  ) {
    this.db
      .prepare(
        "INSERT INTO secrets(ref,ciphertext,last4,updated_at) VALUES(?,?,?,?) ON CONFLICT(ref) DO UPDATE SET ciphertext=excluded.ciphertext,last4=excluded.last4,updated_at=excluded.updated_at",
      )
      .run(this.dbRef(ref), ciphertext, plaintext.slice(-4), now);
  }
  private async protect(ref: string, value: string) {
    try {
      await this.secrets.set(this.target(ref), value);
      return `credential-manager:${this.target(ref)}`;
    } catch {
      return `machine-dpapi:${await this.machineDpapi.protect(value)}`;
    }
  }
  private async reveal(row: { ciphertext: string } | undefined, ref: string) {
    if (!row) return null;
    if (row.ciphertext.startsWith("credential-manager:"))
      return this.secrets.get(this.target(ref));
    if (row.ciphertext.startsWith("machine-dpapi:"))
      return this.machineDpapi.unprotect(
        row.ciphertext.slice("machine-dpapi:".length),
      );
    return null;
  }
  async setSecret(ref: string, plaintext: string) {
    await this.open();
    const ciphertext = await this.protect(ref, plaintext);
    const now = Date.now();
    this.writeMetadata(ref, plaintext, now, ciphertext);
    this.db
      .prepare(
        "INSERT INTO settings_audit(changed_at,source,old_version,new_version,summary) VALUES(?,?,?,?,?)",
      )
      .run(
        now,
        "credentials",
        this.current.settingsVersion,
        this.current.settingsVersion,
        `${ref} updated (redacted)`,
      );
    return this.secretStatus(ref);
  }
  async setCredentialPair(
    keyRef: string,
    apiKey: string,
    secretRef: string,
    apiSecret: string,
  ) {
    await this.open();
    if (!apiKey.trim() || !apiSecret.trim())
      throw new Error("API Key and API Secret are required");
    const oldKey = await this.getSecret(keyRef),
      oldSecret = await this.getSecret(secretRef);
    try {
      await this.setSecret(keyRef, apiKey);
      await this.setSecret(secretRef, apiSecret);
    } catch (error) {
      if (oldKey) await this.setSecret(keyRef, oldKey);
      if (oldSecret) await this.setSecret(secretRef, oldSecret);
      throw error;
    }
    return {
      key: await this.secretStatus(keyRef),
      secret: await this.secretStatus(secretRef),
    };
  }
  async getSecret(ref: string) {
    await this.open();
    const row = this.db
      .prepare("SELECT ciphertext FROM secrets WHERE ref=?")
      .get(this.dbRef(ref)) as { ciphertext: string } | undefined;
    return this.reveal(row, ref);
  }
  async secretStatus(ref: string) {
    await this.open();
    const row = this.db
      .prepare("SELECT ciphertext,last4,updated_at FROM secrets WHERE ref=?")
      .get(this.dbRef(ref)) as
      | { ciphertext: string; last4: string; updated_at: number }
      | undefined;
    if (!row)
      return {
        configured: false,
        last4: null,
        updatedAt: null,
        backend: this.secrets.backend,
        status: "NOT_CONFIGURED",
      };
    try {
      const configured = Boolean(await this.reveal(row, ref));
      const backend = row.ciphertext.startsWith("machine-dpapi:")
        ? "WINDOWS_DPAPI_LOCAL_MACHINE"
        : this.secrets.backend;
      return {
        configured,
        last4: configured ? `****${row.last4}` : null,
        updatedAt: configured ? row.updated_at : null,
        backend,
        status: configured ? "READY" : "UNAVAILABLE",
      };
    } catch {
      return {
        configured: false,
        last4: null,
        updatedAt: null,
        backend: this.secrets.backend,
        status: "UNAVAILABLE",
      };
    }
  }
  integrityCheck(): boolean {
    const row = this.db.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    return row?.integrity_check === "ok";
  }
  checkpoint() {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  loadRuntime<T>() {
    const row=this.db.prepare('SELECT payload FROM runtime_state WHERE id=1').get() as {payload:string}|undefined;if(!row)return null;
    const value=JSON.parse(row.payload);
    if(value._entityLists){const entities=this.db.prepare('SELECT kind,entity_id,payload FROM runtime_entities').all() as Array<{kind:string;entity_id:string;payload:string}>;this.runtimeEntityCache=new Map(entities.map(r=>[`${r.kind}:${r.entity_id}`,r.payload]));
      for(const [kind,info] of Object.entries(value._entityLists) as Array<[string,{ids:string[];tuple:boolean}]>){value[kind]=info.ids.map(id=>{const raw=this.runtimeEntityCache!.get(`${kind}:${id}`);if(raw===undefined)throw new Error(`RUNTIME_ENTITY_MISSING:${kind}:${id}`);const entity=JSON.parse(raw);return info.tuple?[id,entity]:entity;});}delete value._entityLists;
    }
    return value as T;
  }
  persistRuntime(value: unknown) {
    const startedAt=Date.now(),core={...(value as any)},lists:Record<string,{ids:string[];tuple:boolean}>={},updates:Array<[string,string,string]>=[];
    this.runtimeEntityCache??=new Map((this.db.prepare('SELECT kind,entity_id,payload FROM runtime_entities').all() as any[]).map(r=>[`${r.kind}:${r.entity_id}`,r.payload]));
    const tuples=new Set(['positions','entryIntents','entryOrders','tpOrders','manualIntents','manualOrders','allocationPlans','entryReservations','tradeRecords','experienceSamples']);
    for(const [kind,rows] of Object.entries(core)){if(!Array.isArray(rows)||(!tuples.has(kind)&&!['aiRuns','executionFills'].includes(kind)))continue;const tuple=tuples.has(kind),ids:string[]=[];
      rows.forEach((row:any,index)=>{const id=String(tuple?row[0]:row.id??row.fillId??index),entity=tuple?row[1]:row,payload=JSON.stringify(entity);ids.push(id);if(this.runtimeEntityCache!.get(`${kind}:${id}`)!==payload)updates.push([kind,id,payload]);});lists[kind]={ids,tuple};delete core[kind];
    }
    core._entityLists=lists;const payload=JSON.stringify(core),outer=this.transactionActive;
    this.db.exec('SAVEPOINT runtime_checkpoint');try{
      const upsert=this.db.prepare('INSERT INTO runtime_entities(kind,entity_id,payload) VALUES(?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET payload=excluded.payload');for(const update of updates)upsert.run(...update);
      this.db.prepare('INSERT INTO runtime_state(id,payload,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(payload,Date.now());
      if(lists.aiRuns){
        const live=new Set(lists.aiRuns.ids),remove=this.db.prepare("DELETE FROM runtime_entities WHERE kind='aiRuns' AND entity_id=?");
        for(const key of this.runtimeEntityCache!.keys())if(key.startsWith('aiRuns:')&&!live.has(key.slice(7))){remove.run(key.slice(7));this.runtimeEntityCache!.delete(key);}
      }
      this.db.exec('RELEASE runtime_checkpoint');if(outer)this.runtimeEntityCache=null;else for(const [kind,id,raw] of updates)this.runtimeEntityCache!.set(`${kind}:${id}`,raw);
      this.runtimeCheckpointStats={entityWrites:updates.length,checkpointBytes:Buffer.byteLength(payload),durationMs:Date.now()-startedAt};
    }catch(error){this.db.exec('ROLLBACK TO runtime_checkpoint; RELEASE runtime_checkpoint');this.runtimeEntityCache=null;throw error;}
  }
  /** One indexed, bounded batch per scheduler tick. Never run from a UI read or audit INSERT. */
  maintainRetention(now=Date.now()) {
    if(this.transactionActive)return {skipped:true};
    const day=86_400_000,policies:[string,string,number,string][]=[
      ['decision_snapshots','created_at',7,'1'],
      ['decision_chains','updated_at',14,"status IN ('OPEN','WAITING_PRICE','CLOSED') AND NOT EXISTS (SELECT 1 FROM json_each(decision_chains.payload,'$.events') e WHERE json_extract(e.value,'$.type') GLOB '*ORDER*' OR json_extract(e.value,'$.type') GLOB '*FILL*' OR json_extract(e.value,'$.type') GLOB '*TP_*' OR json_extract(e.value,'$.type') GLOB '*MANUAL*')"],
      ['ai_runs_archive','started_at',90,"status IN ('COMPLETED','FAILED','CANCELED')"],
      ['external_research_tasks','updated_at',7,"status IN ('COMPLETED','FAILED','EXPIRED')"],
      ['external_intelligence_snapshots','expires_at',7,'1'],
      ['shadow_mark_series','ts',30,'1'],['regime_samples','sample_at',90,'1'],
      ['state_change_observations','observed_at',90,'1'],
      ['regime_episodes','started_at',90,'ended_at IS NOT NULL'],
      ['temporal_jobs','completed_at',7,"status IN ('COMPLETED','FAILED')"],
    ];
    const index=this.retentionCursor++%(policies.length+1);
    if(index===policies.length){
      return {table:'ai_runs_archive',compacted:Number(this.db.prepare("UPDATE ai_runs_archive SET payload='{}' WHERE rowid IN (SELECT rowid FROM ai_runs_archive WHERE started_at<? AND payload<>'{}' AND status IN ('COMPLETED','FAILED','CANCELED') LIMIT 100)").run(now-14*day).changes)};
    }
    const [table,column,days,extra]=policies[index]!;
    return {table,deleted:Number(this.db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${column}<? AND (${extra}) LIMIT 100)`).run(now-days*day).changes)};
  }
  upsertCapitalEpoch(value: any) {
    this.db.prepare("INSERT INTO capital_epochs(capital_epoch_id,started_at,reason,status,payload,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(capital_epoch_id) DO UPDATE SET status=excluded.status,payload=excluded.payload")
      .run(value.capitalEpochId,value.startedAt,value.reason,'ACTIVE',JSON.stringify(value),Date.now());
  }
  latestCapitalEpoch() {
    const row=this.db.prepare("SELECT payload FROM capital_epochs ORDER BY started_at DESC LIMIT 1").get() as {payload:string}|undefined;
    return row?JSON.parse(row.payload):null;
  }
  upsertWeeklyLiveValidation(value:any) {
    this.db.prepare("INSERT INTO weekly_live_validations(validation_id,status,started_at,required_until,payload,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(validation_id) DO UPDATE SET status=excluded.status,required_until=excluded.required_until,payload=excluded.payload,updated_at=excluded.updated_at")
      .run(value.validationId,value.status,value.startedAt,value.requiredUntil,JSON.stringify(value),Date.now());
  }
  latestWeeklyLiveValidation() {
    const row=this.db.prepare("SELECT payload FROM weekly_live_validations ORDER BY started_at DESC LIMIT 1").get() as {payload:string}|undefined;
    return row?JSON.parse(row.payload):null;
  }
  upsertValidationDailySummary(value:any) {
    this.db.prepare("INSERT INTO live_validation_daily_summaries(summary_id,validation_id,day_key,generated_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(validation_id,day_key) DO UPDATE SET summary_id=excluded.summary_id,generated_at=excluded.generated_at,payload=excluded.payload")
      .run(value.summaryId,value.validationId,value.dayKey,value.generatedAt,JSON.stringify(value));
  }
  listValidationDailySummaries(validationId:string) {
    return (this.db.prepare("SELECT payload FROM live_validation_daily_summaries WHERE validation_id=? ORDER BY day_key").all(validationId) as Array<{payload:string}>).map(row=>JSON.parse(row.payload));
  }
  upsertTradeRecord(value: unknown) {
    const row = value as any;
    this.db
      .prepare(
        "INSERT INTO trade_records(trade_id,status,symbol,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(trade_id) DO UPDATE SET status=excluded.status,symbol=excluded.symbol,payload=excluded.payload,updated_at=excluded.updated_at",
      )
      .run(
        row.tradeId,
        row.status,
        row.symbol,
        JSON.stringify(value),
        Date.now(),
      );
  }
  listTradeRecords() {
    return (
      this.db
        .prepare("SELECT payload FROM trade_records ORDER BY updated_at DESC")
        .all() as Array<{ payload: string }>
    ).map((row) => JSON.parse(row.payload));
  }
  upsertExperienceSample(value: unknown) {
    const row = value as any;
    this.db
      .prepare(
        "INSERT INTO experience_samples(sample_id,trade_id,payload,created_at) VALUES(?,?,?,?) ON CONFLICT(sample_id) DO UPDATE SET payload=excluded.payload",
      )
      .run(
        row.sampleId,
        row.tradeId,
        JSON.stringify(value),
        row.createdAt ?? Date.now(),
      );
  }
  deleteExperienceSample(sampleId: string) {
    this.db
      .prepare("DELETE FROM experience_samples WHERE sample_id=?")
      .run(sampleId);
  }
  async transaction<T>(
    work: () => T,
    options: { timeoutMs?: number; label?: string } = {},
  ): Promise<T> {
    await this.open();
    if (this.transactionActive)
      throw new Error("SQLITE_NESTED_TRANSACTION_FORBIDDEN");
    const startedAt = Date.now();
    let began = false;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      began = true;
      this.transactionActive = true;
      const value = work();
      if (
        value !== null &&
        typeof value === "object" &&
        typeof (value as { then?: unknown }).then === "function"
      )
        throw new Error("SQLITE_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN");
      if (
        options.timeoutMs !== undefined &&
        Date.now() - startedAt > options.timeoutMs
      )
        throw new Error(
          `SQLITE_TRANSACTION_TIMEOUT:${options.label ?? "UNNAMED"}`,
        );
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      if (began) this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionActive = false;
    }
  }
  claimManualExecution(scope: string, value: ManualExecutionRecord): ManualExecutionRecord {
    // One SQLite statement owns the slot before any network write. UNKNOWN never frees it.
    this.db.prepare('INSERT OR IGNORE INTO execution_tasks(intent_id,scope,active,payload,updated_at) VALUES(?,?,1,?,?)')
      .run(value.intent.id, scope, JSON.stringify(value), Date.now());
    const row = this.db.prepare('SELECT payload FROM execution_tasks WHERE scope=? AND active=1').get(scope) as {payload:string}|undefined;
    if (!row) throw new Error('EXECUTION_JOURNAL_CLAIM_FAILED');
    return JSON.parse(row.payload) as ManualExecutionRecord;
  }
  saveManualExecution(value: ManualExecutionRecord) {
    this.db.prepare('UPDATE execution_tasks SET active=?,payload=?,updated_at=? WHERE intent_id=?')
      .run(activeOrderStatus(value.order.status) ? 1 : 0, JSON.stringify(value), Date.now(), value.intent.id);
  }
  loadManualExecutions(): ManualExecutionRecord[] {
    return (this.db.prepare('SELECT payload FROM execution_tasks').all() as Array<{payload:string}>)
      .map(row => JSON.parse(row.payload) as ManualExecutionRecord);
  }
  claimEntryExecution(scope:string,value:EntryExecutionRecord,retryRejected=false){
    let result=this.db.prepare('INSERT OR IGNORE INTO entry_execution_tasks(intent_id,scope,active,payload,updated_at) VALUES(?,?,1,?,?)').run(value.intent.id,scope,JSON.stringify(value),Date.now());
    if(!result.changes&&retryRejected)result=this.db.prepare('UPDATE OR IGNORE entry_execution_tasks SET active=1,payload=?,updated_at=? WHERE intent_id=? AND active=0').run(JSON.stringify(value),Date.now(),value.intent.id);
    const row=this.db.prepare('SELECT payload FROM entry_execution_tasks WHERE scope=? AND active=1').get(scope) as {payload:string}|undefined;
    if(!row)throw new Error('ENTRY_SUBMISSION_UNKNOWN_JOURNAL_CONFLICT');
    return{acquired:result.changes>0,record:JSON.parse(row.payload) as EntryExecutionRecord};
  }
  saveEntryExecution(value:EntryExecutionRecord){this.db.prepare('UPDATE entry_execution_tasks SET active=?,payload=?,updated_at=? WHERE intent_id=?').run(activeOrderStatus(value.order.status)?1:0,JSON.stringify(value),Date.now(),value.intent.id);}
  loadEntryExecutions():EntryExecutionRecord[]{return(this.db.prepare('SELECT payload FROM entry_execution_tasks').all() as Array<{payload:string}>).map(row=>JSON.parse(row.payload));}
  recordTradeSyncHistory(value: unknown) {
    const row = value as any;
    this.db
      .prepare(
        "INSERT INTO trade_sync_history(sync_id,status,payload,created_at) VALUES(?,?,?,?) ON CONFLICT(sync_id) DO UPDATE SET status=excluded.status,payload=excluded.payload,created_at=excluded.created_at",
      )
      .run(
        row.syncId,
        row.status,
        JSON.stringify(value),
        row.createdAt ?? Date.now(),
      );
  }
  listTradeSyncHistory(limit = 50) {
    return (
      this.db
        .prepare(
          "SELECT payload FROM trade_sync_history ORDER BY created_at DESC LIMIT ?",
        )
        .all(Math.max(1, Math.min(500, limit))) as Array<{ payload: string }>
    ).map((row) => JSON.parse(row.payload));
  }
  getTradeSyncHistory(syncId: string) {
    const row = this.db
      .prepare("SELECT payload FROM trade_sync_history WHERE sync_id=?")
      .get(syncId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  listPersistedExchangeFillFacts(symbol: string, startTime: number, endTime: number) {
    const rows = this.db
      .prepare(
        "SELECT type,payload FROM runtime_events WHERE type IN ('EXCHANGE_FILL_ATTRIBUTED','EXCHANGE_FILL_UNATTRIBUTED') AND symbol=? ORDER BY ts ASC",
      )
      .all(symbol) as Array<{ type: string; payload: string }>;
    const byTradeId = new Map<string, any>();
    for (const row of rows) {
      const fill = JSON.parse(row.payload)?.fill;
      if (
        !fill ||
        fill.symbol !== symbol ||
        !fill.tradeId ||
        !Number.isFinite(fill.executionTime) ||
        fill.executionTime < startTime ||
        fill.executionTime > endTime
      )
        continue;
      const current = byTradeId.get(fill.tradeId);
      if (
        !current ||
        (current.source !== "EXCHANGE_AUDIT" &&
          fill.source === "EXCHANGE_AUDIT")
      )
        byTradeId.set(fill.tradeId, fill);
    }
    return [...byTradeId.values()].sort(
      (a, b) => a.executionTime - b.executionTime,
    );
  }
  listExperienceSamples() {
    return (
      this.db
        .prepare(
          "SELECT payload FROM experience_samples ORDER BY created_at DESC",
        )
        .all() as Array<{ payload: string }>
    ).map((row) => JSON.parse(row.payload));
  }
  resourceList(kind: "exchange" | "proxy" | "ai") {
    const table =
      kind === "exchange"
        ? "exchange_resources"
        : kind === "proxy"
          ? "proxy_resources"
          : "ai_resources";
    return (
      this.db
        .prepare(`SELECT payload FROM ${table} ORDER BY updated_at DESC`)
        .all() as Array<{ payload: string }>
    ).map((row) => JSON.parse(row.payload));
  }
  resourceSave(kind: "exchange" | "proxy" | "ai", value: any) {
    const table =
      kind === "exchange"
        ? "exchange_resources"
        : kind === "proxy"
          ? "proxy_resources"
          : "ai_resources";
    this.db
      .prepare(
        `INSERT INTO ${table}(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`,
      )
      .run(value.id, JSON.stringify(value), Date.now());
    return value;
  }
  resourceDelete(kind: "exchange" | "proxy" | "ai", id: string) {
    const table =
      kind === "exchange"
        ? "exchange_resources"
        : kind === "proxy"
          ? "proxy_resources"
          : "ai_resources";
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  }
  recordRuntimeEvent(event: {
    id: string;
    type: string;
    ts: number;
    symbol?: string;
    payload?: unknown;
  }) {
    const source=event.payload as any;
    // Filtering the journal must not skip AI archival or runtime execution hooks.
    if(isTelemetry(event.type,event.payload)){
      if(event.type.startsWith('AI_RUN_')&&source?.id){this.upsertAiRun(source);if(event.type==='AI_RUN_COMPLETED')this.appendDecisionChain(source.id,{...event,payload:{artifactRef:{table:'ai_runs_archive',runId:source.id},status:source.status,decision:source.decision}});}
      return;
    }
    const eventPayload=event.type.startsWith('AI_RUN_')&&source?.id ? {
      ...source,inputPreview:undefined,outputPreview:undefined,normalizedPreview:undefined,
      failure:source.failure?{...source.failure,rawOutput:undefined}:source.failure,
      artifactRef:{table:'ai_runs_archive',runId:source.id},
    }:event.payload ?? null;
    const payload = redactAudit(eventPayload, Infinity);
    const inserted=this.db
      .prepare(
        "INSERT OR IGNORE INTO runtime_events(id,type,ts,symbol,payload) VALUES(?,?,?,?,?)",
      )
      .run(event.id, event.type, event.ts, event.symbol ?? null, payload);
    if(inserted.changes&&this.operationalCache)this.operationalCache={at:Date.now(),value:{...this.operationalCache.value,auditEvents:this.operationalCache.value.auditEvents+1,runtimePersistedAt:this.operationalCache.value.runtimePersistedAt}};
    const row = event.payload as any;
    if (event.type.startsWith("AI_RUN_") && row?.id) this.upsertAiRun(row);
    if(['AI_RUN_TERMINAL','AI_RUN_FAILED'].includes(event.type)&&row?.id&&row.role==='PRIMARY_BRAIN')this.upsertLiveDecisionEpisode(row,event);
    const chainId =
      (event.type.startsWith('AI_RUN_') ? row?.id : undefined) ??
      row?.decisionChainId ??
      row?.runId ??
      row?.brainRunId ??
      row?.intent?.decisionChainId ??
      row?.intent?.brainRunId;
    if (chainId) this.appendDecisionChain(String(chainId), {...event,payload:eventPayload});
  }
  upsertAiRun(value: unknown) {
    const row = value as any;
    if (!row?.id) return;
    this.db
      .prepare(
        "INSERT INTO ai_runs_archive(run_id,symbol,started_at,status,payload,updated_at,role,model,decision,direction,completed_at,latency_ms,input_tokens,output_tokens,short_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at,role=excluded.role,model=excluded.model,decision=excluded.decision,direction=excluded.direction,completed_at=excluded.completed_at,latency_ms=excluded.latency_ms,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,short_reason=excluded.short_reason",
      )
      .run(
        row.id,
        row.symbol ?? "",
        row.startedAt ?? Date.now(),
        row.status ?? "FAILED",
        redactAudit(value, Infinity),
        Date.now(),
        row.role ?? null,
        row.model ?? null,
        row.decision ?? null,
        row.direction ?? null,
        row.completedAt ?? null,
        row.latencyMs ?? row.timing?.totalMs ?? null,
        row.inputTokens ?? null,
        row.outputTokens ?? null,
        String(row.reason ?? row.error ?? row.failure?.errorMessage ?? '').slice(0,500) || null,
      );
  }
  private upsertLiveDecisionEpisode(run:any,event:any){
    let input:any=null,decision:any=null;try{input=JSON.parse(run.inputPreview??'{}').packet??null;}catch{}try{decision=JSON.parse(run.normalizedPreview??'{}');}catch{}
    const facts=decision?.economicFloor??input?.economic??null, timing=decision?.timingEvent??null, episode={episodeId:`episode_${run.id}`,recordKind:'PRIMARY_INFERENCE_RUN',marketOpportunityEpisodeId:run.marketOpportunityEpisodeId??null,inferenceRunId:run.id,status:run.status,candidateReadyAt:event?.payload?.candidateReadyAt??null,primaryStartedAt:run.startedAt??null,primaryCompletedAt:run.completedAt??null,structureDirection:decision?.structureDirection??null,tradeSide:decision?.tradeSide??null,rejectLayer:decision?.rejectLayer??null,blockingCondition:decision?.blockingCondition??null,releaseCondition:decision?.releaseCondition??null,contextDiff:event?.payload?.contextDiff??null,triggerReason:run.triggerReason??null,economicFloor:facts,eventIdentity:timing,inputHash:run.inputContractHash??null,outputHash:run.promptHash??null,schemaFailurePath:run.failure?.errorCode??null};
    const symbol=String(run.symbol??input?.symbol??''),underlying=String(input?.portfolioIntelligence?.underlying??symbol.replace(/(USDT|USDC|BUSD)$/,'')),quote=String(input?.portfolioIntelligence?.quoteAsset??'UNKNOWN'),at=Number(run.completedAt??run.startedAt??Date.now());
    this.db.prepare(`INSERT INTO decision_episodes(episode_id,run_id,packet_id,scout_run_id,symbol,underlying,quote_asset,decided_at,direction,decision,completeness,outcome_status,snapshot_id,risk_tier,liquidity_class,regime_state,regime_age_ms,transition_score,fingerprint,would_reuse,return_15m,return_1h,return_4h,return_24h,return_3d,return_7d,mfe,mae,feature_json,decision_json,outcome_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET decision_json=excluded.decision_json,feature_json=excluded.feature_json,updated_at=excluded.updated_at`).run(episode.episodeId,run.id,run.packetId??null,null,symbol,underlying,quote,at,episode.tradeSide,run.decision??null,'PENDING','PENDING',null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,JSON.stringify({candidateReadyAt:episode.candidateReadyAt,primaryStartedAt:episode.primaryStartedAt,primaryCompletedAt:episode.primaryCompletedAt,inputHash:episode.inputHash,outputHash:episode.outputHash}),JSON.stringify(episode),JSON.stringify({status:'PENDING_LIVE_OBSERVATION'}),Date.now());
  }
  listAiRunSummaries(query: {
    from?:number; to?:number; symbol?:string; role?:string; status?:string;
    decision?:string; model?:string; page?:number; limit?:number;
  } = {}) {
    const page=Math.max(1,Math.trunc(Number(query.page??1))),limit=Math.max(1,Math.min(100,Math.trunc(Number(query.limit??20))));
    const where:string[]=['started_at>=?'],params:any[]=[Math.max(0,Number(query.from??Date.now()-90*24*60*60_000))];
    if(Number.isFinite(Number(query.to))) { where.push('started_at<=?'); params.push(Number(query.to)); }
    for(const key of ['symbol','role','status','decision'] as const) if(query[key]) { where.push(`${key}=? COLLATE NOCASE`); params.push(String(query[key])); }
    if(query.model) { where.push('model LIKE ? COLLATE NOCASE'); params.push(`%${String(query.model).replace(/[\\%_]/g,'\\$&')}%`); }
    const clause=where.join(' AND '),total=Number((this.db.prepare(`SELECT COUNT(*) count FROM ai_runs_archive WHERE ${clause}`).get(...params) as any)?.count??0);
    const rows=this.db.prepare(`SELECT run_id id,symbol,role,model,status,decision,direction,started_at startedAt,completed_at completedAt,latency_ms latencyMs,input_tokens inputTokens,output_tokens outputTokens,short_reason reason FROM ai_runs_archive WHERE ${clause} ORDER BY started_at DESC,run_id DESC LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit) as any[];
    return {page,limit,total,items:rows};
  }
  backfillAiRunSummaries(limit=25,budgetMs=8){
    const started=Date.now(),rows=this.db.prepare("SELECT run_id,payload FROM ai_runs_archive WHERE role IS NULL ORDER BY started_at DESC LIMIT ?").all(Math.max(1,Math.min(100,limit))) as Array<{run_id:string;payload:string}>;
    let updated=0;
    const statement=this.db.prepare("UPDATE ai_runs_archive SET role=?,model=?,decision=?,direction=?,completed_at=?,latency_ms=?,input_tokens=?,output_tokens=?,short_reason=? WHERE run_id=? AND role IS NULL");
    for(const item of rows){
      if(Date.now()-started>=budgetMs)break;
      try{const row=JSON.parse(item.payload);statement.run(row.role??null,row.model??null,row.decision??null,row.direction??null,row.completedAt??null,row.latencyMs??row.timing?.totalMs??null,row.inputTokens??null,row.outputTokens??null,String(row.reason??row.error??row.failure?.errorMessage??'').slice(0,500)||null,item.run_id);updated++;}catch{}
    }
    return {scanned:rows.length,updated,elapsedMs:Date.now()-started};
  }
  aiRunHealthSummary(since:number){
    const rows=this.db.prepare("SELECT status FROM ai_runs_archive WHERE started_at>=? AND status IN ('COMPLETED','FAILED') ORDER BY started_at DESC,run_id DESC LIMIT 5000").all(since) as Array<{status:string}>;
    let consecutiveFailures=0;for(const row of rows){if(row.status==='COMPLETED')break;consecutiveFailures++;}
    return {completed:rows.filter(row=>row.status==='COMPLETED').length,consecutiveFailures};
  }
  listAiRuns(since = Date.now() - 90 * 24 * 60 * 60_000, limit = 10000) {
    return (
      this.db
        .prepare(
          "SELECT payload FROM ai_runs_archive WHERE started_at>=? ORDER BY started_at DESC LIMIT ?",
        )
        .all(since, Math.max(1, Math.min(100000, limit))) as Array<{
        payload: string;
      }>
    ).map((row) => JSON.parse(row.payload));
  }
  listEntryObservationRuns(since:number,until:number,limit=10001):any[] {
    return this.db.prepare("SELECT run_id AS id,symbol,role,status,decision,direction,started_at AS startedAt,completed_at AS completedAt,json_extract(payload,'$.error') AS error,json_extract(payload,'$.normalizedPreview') AS normalizedPreview FROM ai_runs_archive WHERE role='PRIMARY_BRAIN' AND started_at BETWEEN ? AND ? ORDER BY started_at DESC LIMIT ?").all(since,until,Math.max(1,Math.min(10001,limit)));
  }
  getAiRun(runId: string) {
    const row = this.db
      .prepare("SELECT payload FROM ai_runs_archive WHERE run_id=?")
      .get(runId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  appendDecisionChain(
    chainId: string,
    event: { type: string; ts: number; symbol?: string; payload?: unknown },
  ) {
    const existing = this.db
      .prepare("SELECT payload FROM decision_chains WHERE chain_id=?")
      .get(chainId) as { payload: string } | undefined;
    const current = existing
      ? JSON.parse(existing.payload)
      : {
          chainId,
          symbol: event.symbol ?? null,
          startedAt: event.ts,
          updatedAt: event.ts,
          status: "OPEN",
          events: [],
        };
    current.symbol = current.symbol ?? event.symbol ?? null;
    current.updatedAt = event.ts;
    current.events.push({
      type: event.type,
      ts: event.ts,
      payload: JSON.parse(redactAudit(event.payload, 16384)),
    });
    if(current.events.length>256){current.archivedEventCount=Number(current.archivedEventCount??0)+current.events.length-256;current.events=current.events.slice(-256);current.archiveTable='runtime_events';}
    if(event.type==='ENTRY_EXECUTION_WAITING')current.status='WAITING_PRICE';
    if(['ENTRY_SUBMIT_ATTEMPTED','ENTRY_ORDER_CREATED'].includes(event.type))current.status='WORKING';
    if(event.type==='ENTRY_ORDER_SUBMISSION_UNKNOWN')current.status='UNKNOWN_RECONCILIATION';
    if(['ENTRY_FILLED','TRADE_RECORD_CLOSED','CANDIDATE_REJECTED','ENTRY_ORDER_BLOCKED','ENTRY_ANALYSIS_FAILED','ENTRY_EXECUTION_WAIT_TERMINATED','ENTRY_ORDER_EXPIRED','ENTRY_RANGE_INVALIDATED'].includes(event.type))
      current.status = event.type === "ENTRY_FILLED" ? "FILLED" : "CLOSED";
    this.db
      .prepare(
        "INSERT INTO decision_chains(chain_id,symbol,started_at,updated_at,status,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(chain_id) DO UPDATE SET symbol=excluded.symbol,updated_at=excluded.updated_at,status=excluded.status,payload=excluded.payload",
      )
      .run(
        chainId,
        current.symbol,
        current.startedAt,
        current.updatedAt,
        current.status,
        JSON.stringify(current),
      );
  }
  getDecisionChain(chainId: string) {
    const row = this.db
      .prepare("SELECT payload FROM decision_chains WHERE chain_id=?")
      .get(chainId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  listDecisionChains(since = Date.now() - 24 * 60 * 60_000, limit = 100) {
    return (
      this.db
        .prepare(
          "SELECT payload FROM decision_chains WHERE updated_at>=? ORDER BY updated_at DESC LIMIT ?",
        )
        .all(since, Math.max(1, Math.min(1000, limit))) as Array<{
        payload: string;
      }>
    ).map((row) => JSON.parse(row.payload));
  }
  upsertDecisionSnapshot(value: unknown) {
    const row = value as any;
    if (!row?.snapshotId || !row?.symbol) return;
    this.db
      .prepare(
        "INSERT OR IGNORE INTO decision_snapshots(snapshot_id,candidate_id,symbol,created_at,payload) VALUES(?,?,?,?,?)",
      )
      .run(
        row.snapshotId,
        row.candidateId ?? null,
        row.symbol,
        row.createdAt ?? Date.now(),
        redactAudit(value, Infinity),
      );
  }
  getDecisionSnapshot(id: string) {
    const row = this.db
      .prepare("SELECT payload FROM decision_snapshots WHERE snapshot_id=?")
      .get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  listDecisionSnapshots(
    since = Date.now() - 90 * 24 * 60 * 60_000,
    limit = 1000,
  ) {
    return (
      this.db
        .prepare(
          "SELECT payload FROM decision_snapshots WHERE created_at>=? ORDER BY created_at DESC LIMIT ?",
        )
        .all(since, Math.max(1, Math.min(10000, limit))) as Array<{
        payload: string;
      }>
    ).map((row) => JSON.parse(row.payload));
  }
  upsertExternalIntelligenceSnapshot(value:any){
    const result=this.db.prepare('INSERT OR IGNORE INTO external_intelligence_snapshots(id,provider,source_id,available_at,expires_at,content_hash,payload,received_at) VALUES(?,?,?,?,?,?,?,?)').run(value.id,value.provider,value.sourceId,value.availableAt,value.expiresAt,value.contentHash,JSON.stringify(value),value.receivedAt);
    this.db.prepare('DELETE FROM external_intelligence_snapshots WHERE expires_at<?').run(Date.now()-7*86_400_000);
    return result.changes>0;
  }
  listExternalIntelligenceSnapshots(asOf=Date.now(),limit=100){
    return (this.db.prepare('SELECT payload FROM external_intelligence_snapshots WHERE available_at<=? ORDER BY available_at DESC LIMIT ?').all(asOf,Math.max(1,Math.min(1000,limit))) as Array<{payload:string}>).map(row=>JSON.parse(row.payload));
  }
  setExternalProviderState(provider:string,value:any){this.db.prepare('INSERT INTO external_provider_state(provider,status,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at').run(provider,String(value.status),JSON.stringify(value),Date.now());}
  listExternalProviderStates(){return (this.db.prepare('SELECT payload FROM external_provider_state ORDER BY provider').all() as Array<{payload:string}>).map(row=>JSON.parse(row.payload));}
  enqueueExternalResearch(value:any){const now=Date.now();const result=this.db.prepare("INSERT OR IGNORE INTO external_research_tasks(content_hash,source_id,status,available_at,expires_at,attempts,next_attempt_at,payload,created_at,updated_at) VALUES(?,?,'QUEUED',?,?,0,?,?,?,?)").run(value.contentHash,value.sourceId,value.availableAt,value.expiresAt??Number.MAX_SAFE_INTEGER,value.availableAt,JSON.stringify(value),now,now);return result.changes>0;}
  nextExternalResearch(now=Date.now()){this.db.prepare("UPDATE external_research_tasks SET status='EXPIRED',error='EVENT_EXPIRED',updated_at=? WHERE status IN ('QUEUED','RETRY') AND expires_at<?").run(now,now);this.db.prepare("UPDATE external_research_tasks SET status='RETRY',next_attempt_at=?,error='RECOVERED_AFTER_RESTART',updated_at=? WHERE status='RUNNING' AND updated_at<?").run(now,now,now-120_000);const row=this.db.prepare("SELECT content_hash contentHash,payload,attempts FROM external_research_tasks WHERE status IN ('QUEUED','RETRY') AND next_attempt_at<=? AND expires_at>=? ORDER BY available_at,content_hash LIMIT 1").get(now,now) as any;if(!row)return null;this.db.prepare("UPDATE external_research_tasks SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE content_hash=?").run(now,row.contentHash);return{contentHash:row.contentHash,payload:JSON.parse(row.payload),attempts:Number(row.attempts)+1};}
  completeExternalResearch(contentHash:string,result:any){this.db.prepare("UPDATE external_research_tasks SET status='COMPLETED',result=?,error=NULL,updated_at=? WHERE content_hash=?").run(JSON.stringify(result),Date.now(),contentHash);}
  failExternalResearch(contentHash:string,error:string,attempts:number){const terminal=attempts>=3,delay=Math.min(300_000,5_000*2**Math.max(0,attempts-1)),now=Date.now();this.db.prepare("UPDATE external_research_tasks SET status=?,next_attempt_at=?,error=?,updated_at=? WHERE content_hash=?").run(terminal?'FAILED':'RETRY',now+delay,error.slice(0,1000),now,contentHash);}
  externalResearchMetrics(){const rows=this.db.prepare("SELECT status,COUNT(*) count FROM external_research_tasks GROUP BY status").all() as any[];const counts=Object.fromEntries(rows.map(row=>[row.status,Number(row.count)]));const last=this.db.prepare("SELECT source_id sourceId,status,updated_at updatedAt,error FROM external_research_tasks ORDER BY updated_at DESC LIMIT 1").get() as any;return{queued:(counts.QUEUED??0)+(counts.RETRY??0),running:counts.RUNNING??0,completed:counts.COMPLETED??0,failed:counts.FAILED??0,last:last??null};}
  getDecisionEpisodeByRun(runId: string) {
    const row = this.db
      .prepare("SELECT * FROM decision_episodes WHERE run_id=?")
      .get(runId) as any;
    if (!row) return null;
    return {
      episodeId: row.episode_id,
      runId: row.run_id,
      packetId: row.packet_id,
      scoutRunId: row.scout_run_id,
      symbol: row.symbol,
      underlying: row.underlying,
      quoteAsset: row.quote_asset,
      decidedAt: row.decided_at,
      direction: row.direction,
      decision: row.decision,
      completeness: row.completeness,
      outcomeStatus: row.outcome_status,
      snapshotId: row.snapshot_id,
      riskTier: row.risk_tier,
      liquidityClass: row.liquidity_class,
      regimeState: row.regime_state,
      regimeAgeMs: row.regime_age_ms,
      transitionScore: row.transition_score,
      fingerprint: row.fingerprint,
      wouldReuse: Boolean(row.would_reuse),
      returns: {
        m15: row.return_15m,
        h1: row.return_1h,
        h4: row.return_4h,
        h24: row.return_24h,
        d3: row.return_3d,
        d7: row.return_7d,
      },
      mfe: row.mfe,
      mae: row.mae,
      feature: JSON.parse(row.feature_json),
      decisionLayer: JSON.parse(row.decision_json),
      outcome: JSON.parse(row.outcome_json),
      updatedAt: row.updated_at,
    };
  }
  recordShadowMark(value: {
    id: string;
    ts: number;
    symbol: string;
    mark: number;
    bid?: number | null;
    ask?: number | null;
    snapshotId?: string | null;
  }) {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS shadow_mark_series (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, symbol TEXT NOT NULL, mark REAL NOT NULL, bid REAL, ask REAL, snapshot_id TEXT)",
    );
    this.db
      .prepare(
        "INSERT OR IGNORE INTO shadow_mark_series(id,ts,symbol,mark,bid,ask,snapshot_id) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        value.id,
        value.ts,
        value.symbol,
        value.mark,
        value.bid ?? null,
        value.ask ?? null,
        value.snapshotId ?? null,
      );
    this.db
      .prepare("DELETE FROM shadow_mark_series WHERE ts<?")
      .run(Date.now() - 30 * 24 * 60 * 60_000);
  }
  ensureShadowMarkTable() {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS shadow_mark_series (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, symbol TEXT NOT NULL, mark REAL NOT NULL, bid REAL, ask REAL, snapshot_id TEXT)",
    );
  }
  listShadowMarkSeries(
    since = Date.now() - 24 * 60 * 60_000,
    symbol?: string,
    limit = 100000,
  ) {
    const safe = Math.max(1, Math.min(200000, limit));
    const rows = symbol
      ? this.db
          .prepare(
            "SELECT id,ts,symbol,mark,bid,ask,snapshot_id AS snapshotId FROM shadow_mark_series WHERE ts>=? AND symbol=? ORDER BY ts ASC LIMIT ?",
          )
          .all(since, symbol, safe)
      : this.db
          .prepare(
            "SELECT id,ts,symbol,mark,bid,ask,snapshot_id AS snapshotId FROM shadow_mark_series WHERE ts>=? ORDER BY ts ASC LIMIT ?",
          )
          .all(since, safe);
    return rows as any[];
  }
  shadowMarkCoverage(since = Date.now() - 24 * 60 * 60_000) {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS samples,COUNT(DISTINCT symbol) AS symbols,MIN(ts) AS first_ts,MAX(ts) AS last_ts FROM shadow_mark_series WHERE ts>=?",
      )
      .get(since) as any;
    return {
      samples: Number(row?.samples ?? 0),
      symbols: Number(row?.symbols ?? 0),
      firstAt: row?.first_ts ?? null,
      lastAt: row?.last_ts ?? null,
    };
  }
  runtimeEvents(since: number, types: string[] = [], limit = 5000) {
    let rows: Array<{
      id: string;
      type: string;
      ts: number;
      symbol: string | null;
      payload: string;
    }>;
    if (types.length) {
      const placeholders = types.map(() => "?").join(",");
      rows = this.db
        .prepare(
          `SELECT id,type,ts,symbol,payload FROM runtime_events WHERE ts>=? AND type IN (${placeholders}) ORDER BY ts ASC LIMIT ?`,
        )
        .all(since, ...types, limit) as typeof rows;
    } else
      rows = this.db
        .prepare(
          "SELECT id,type,ts,symbol,payload FROM runtime_events WHERE ts>=? ORDER BY ts ASC LIMIT ?",
        )
        .all(since, limit) as typeof rows;
    return rows.map((row) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        const runId=row.payload.match(/"id"\s*:\s*"([^"\\]+)"/)?.[1];
        const recovered=runId&&row.type.startsWith('AI_RUN_')?this.getAiRun(runId):null;
        payload={...(recovered??{}),dataError:'LEGACY_INVALID_EVENT_JSON',recoveredFromArchive:Boolean(recovered)};
      }
      return { ...row, payload };
    });
  }
  runtimeEventsRecent(since: number, types: string[] = [], limit = 20000) {
    const safe = Math.max(1, Math.min(20000, limit));
    const placeholders = types.map(() => "?").join(",");
    const sql = types.length
      ? `SELECT id,type,ts,symbol,payload FROM runtime_events WHERE ts>=? AND type IN (${placeholders}) ORDER BY ts DESC LIMIT ?`
      : "SELECT id,type,ts,symbol,payload FROM runtime_events WHERE ts>=? ORDER BY ts DESC LIMIT ?";
    const rows = this.db.prepare(sql).all(since, ...types, safe) as Array<{
      id: string;
      type: string;
      ts: number;
      symbol: string | null;
      payload: string;
    }>;
    return rows.reverse().map((row) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = null;
      }
      return { ...row, payload };
    });
  }
  operationalMetrics() {
    return this.operationalCache?.value??{integrity:null,status:"UNKNOWN" as const,auditEvents:0,runtimePersistedAt:null,checkedAt:null,error:null};
  }
  private seedOperationalMetrics(){const events=this.db.prepare('SELECT COUNT(*) AS n FROM runtime_events').get() as {n:number},runtime=this.db.prepare('SELECT updated_at FROM runtime_state WHERE id=1').get() as {updated_at:number}|undefined,checkedAt=Date.now(),integrity=this.integrityCheck();this.operationalCache={at:checkedAt,value:{integrity,status:integrity?'HEALTHY':'OFFLINE',auditEvents:Number(events.n),runtimePersistedAt:runtime?.updated_at??null,checkedAt,error:null}};}
  startOperationalMonitor(intervalMs=30_000) {
    if(this.operationalWorker)return;
    const worker=new Worker(new URL('../workers/sqliteHealthWorker.js',import.meta.url),{workerData:{dbPath:path.join(this.dataDir,'zdj-settings.sqlite'),intervalMs}});
    worker.on('message',(value:any)=>{this.operationalCache={at:Date.now(),value:{integrity:value.integrity===true?true:value.integrity===false?false:null,status:value.integrity===true?'HEALTHY':value.integrity===false?'OFFLINE':'UNKNOWN',auditEvents:Number(value.auditEvents??0),runtimePersistedAt:Number.isFinite(value.runtimePersistedAt)?Number(value.runtimePersistedAt):null,checkedAt:Number.isFinite(value.checkedAt)?Number(value.checkedAt):null,error:value.error?String(value.error):null}};});
    worker.on('error',(error)=>{this.operationalCache={at:Date.now(),value:{integrity:null,status:'UNKNOWN',auditEvents:this.operationalCache?.value.auditEvents??0,runtimePersistedAt:this.operationalCache?.value.runtimePersistedAt??null,checkedAt:Date.now(),error:error.message}};});
    this.operationalWorker=worker;
  }
  /** A single verified baseline, shared by both manual sync paths, never one whole DB per sync. */
  tradeSyncBaseline(directory:string):Promise<string>{
    const destination=path.resolve(directory,'trade-sync-baseline.sqlite'),existing=this.baselineFlights.get(destination);
    if(existing)return existing;
    const flight=(async()=>{
      await mkdir(directory,{recursive:true});
      const verify=(file:string)=>{const db=new DatabaseSync(file,{readOnly:true});try{const rows=db.prepare('PRAGMA integrity_check').all();if(rows.length!==1||rows[0]?.integrity_check!=='ok')throw new Error('TRADE_SYNC_BASELINE_INVALID');}finally{db.close();}};
      try{await stat(destination);verify(destination);return destination;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const size=Number((this.db.prepare('PRAGMA page_count').get() as any).page_count)*Number((this.db.prepare('PRAGMA page_size').get() as any).page_size);
      if(size>512*1024**2)throw new Error('TRADE_SYNC_BASELINE_TOO_LARGE: offline storage cleanup required');
      const temporary=destination+`.${process.pid}.${Date.now()}.tmp`;
      try{await sqliteBackup(this.db,temporary);verify(temporary);await link(temporary,destination);return destination;}finally{await unlink(temporary).catch(()=>{});}
    })();this.baselineFlights.set(destination,flight);void flight.catch(()=>this.baselineFlights.delete(destination));return flight;
  }
  async backup(destination: string) {
    await this.open();
    await sqliteBackup(this.db,destination);
    return destination;
  }
  close() {
    void this.operationalWorker?.terminate();this.operationalWorker=null;
    this.db?.close();
  }
}
