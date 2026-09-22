#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { REQUIRED_ABLATION_GROUPS, sealExperimentManifest } from '../apps/engine/dist/services/s09ExperimentManifest.js';

/**
 * S09: writes the pre-registration for the offline replay before any result exists.
 *
 * The point of generating it with this script rather than typing it is that `experimentId` and the
 * `formal` flag are derived from the content by the same code that later has to honour them: a manifest
 * that was edited afterwards stops matching its own identity, and the report refuses it.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3_600_000;
const outPath = path.resolve(root, process.argv.find(argument => argument.startsWith('--out='))?.slice('--out='.length)
  ?? 'docs/evidence/v396/final-convergence-20260922/J6/experiment-manifest.json');
const frozenAt = Number(process.env.ZDJ_EXPERIMENT_FROZEN_AT ?? Date.UTC(2026, 8, 22));

const groups = [
  { id: 'A', description: '冻结基线：现状完整账户表现', policy: 'v395-baseline', parameters: { aiExitAuthority: 'OFF', positionReviewEnabled: false, horizonMs: 4 * HOUR } },
  { id: 'B', description: '基线 + 确定性有限期/交接/合法退出，决策输入可控', policy: 'deterministic-management', parameters: { aiExitAuthority: 'OFF', positionReviewEnabled: false, humanHandoffAfterMinutes: 1440, horizonMs: 4 * HOUR } },
  { id: 'C', description: '无 LLM 的简单可解释规则，同执行与风控', policy: 'simple-rule', parameters: { rule: 'momentum-15m', horizonMs: 4 * HOUR } },
  { id: 'D', description: '27B 计划，无 9B 增量研究', policy: 'plan-27b-only', parameters: { scout: false, review: false, horizonMs: 4 * HOUR } },
  { id: 'E', description: '27B 计划 + 9B 增量研究 + 交易记忆', policy: 'plan-27b-plus-memory', parameters: { scout: true, review: true, memory: true, horizonMs: 4 * HOUR } },
  { id: 'E-minus-memory', description: 'E 去交易记忆（预注册子消融，不允许事后删除）', policy: 'plan-27b-plus-memory', parameters: { scout: true, review: true, memory: false, horizonMs: 4 * HOUR } },
];
if (groups.length !== REQUIRED_ABLATION_GROUPS.length) throw new Error('ABLATION_GROUP_SET_INCOMPLETE');

const manifest = sealExperimentManifest({
  schemaVersion: 'V396-EXPERIMENT-1',
  hypothesis: '有限复核与不可变计划在保持经济优势的同时降低模型调用成本',
  frozenAt,
  splits: { trainEnd: frozenAt + 30 * 24 * HOUR, validationEnd: frozenAt + 45 * 24 * HOUR, finalTestEnd: frozenAt + 60 * 24 * HOUR },
  // The longest evaluated holding window across groups, so no cycle straddles two sets.
  embargoMs: Math.max(...groups.map(group => Number(group.parameters.horizonMs ?? 0))),
  universeRule: { asOf: 'AT_EVENT_TIME', listingSource: 'exchange-info-at-event-time', exclusions: ['DELISTED_BEFORE_DECISION'], snapshotHash: 'uni_pending_frozen_listing_snapshot' },
  missingDataRule: { maxGapMs: 5 * 60_000, treatUnknownAs: 'UNRESOLVED', dropCycle: false },
  groups: groups.map(group => ({ ...group, configHash: '' })),
  primaryMetric: { id: 'account_net_return_after_funding', formula: '(finalEquity-startEquity)/startEquity*100，含手续费/资金费/滑点/模型与人工延迟',
    denominator: 'startEquityUsd', currencyUnit: 'USDT', timeGranularity: 'per-cycle-closed-then-account' },
  secondaryMetrics: ['maxDrawdownPct', 'tailLossUsd', 'capitalUsageUsdSeconds', 'handoffBacklog', 'openAgeMsP95', 'exitSlippageBpsAvg', 'modelCostMsTotal'],
  riskBudget: { source: 'S05_PORTFOLIO_PROFILE', snapshotHash: 'v396r' + '0'.repeat(64), maxCapitalAtRiskUsd: 0, maxStressLossUsd: 0 },
  thresholds: { nonInferiorityMarginPct: 5, minIndependentSamples: 240, minCoverageRatio: 0.95, acceptableExecutionModelErrorBps: 25, minimumTokenSavingPct: 30 },
  bootstrap: { method: 'stationary-block', blockLengthMs: 6 * HOUR, replicates: 4000, intervalLevelPct: 95, seed: 20260922 },
  costModel: { makerRate: 0.0002, takerRate: 0.0004, slippageSource: 'observed-vs-arrival-price', fundingSource: 'exchange-income-facts', modelLatencyMs: 1500, ackLossModelled: true },
  humanResponseScenarios: [
    { id: '5m', responseMs: 5 * 60_000, description: '人工 5 分钟内响应' },
    { id: '1h', responseMs: HOUR, description: '人工 1 小时响应' },
    { id: '8h', responseMs: 8 * HOUR, description: '人工 8 小时响应' },
    { id: 'never', responseMs: null, description: '无人响应：周期保持右删失且资本仍被占用' }],
  tokenComparison: { frozenEventSetHash: null, baselineRows: 0, boundedRows: 0 },
  reproduction: { command: 'node scripts/v396-replay-report.mjs --manifest docs/evidence/v396/final-convergence-20260922/J6/experiment-manifest.json --bundle <frozen-bundle.json>',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    settingsHash: 'pending-settings-hash-at-run-time', promptSchemaVersion: 'V3.9.2', dataHashes: {} },
});

if (!existsSync(path.dirname(outPath))) mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.error(`EXPERIMENT_MANIFEST_WRITTEN ${path.relative(root, outPath)} id=${manifest.experimentId} formal=${manifest.formal}`);
