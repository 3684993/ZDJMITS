// Read-only closeout probe for the PLACE→Submit round. Nothing here writes to the Engine or the exchange.
// Usage: node scripts/v396-place-to-submit-live-check.mjs <out.json> [label]
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'docs/evidence/v396/place-to-submit-root-cause-20260926/b00-live-check.json';
const label = process.argv[3] ?? 'check';
const base = process.argv[4] ?? 'http://127.0.0.1:8080/api/v3';

const get = async (suffix) => {
  const response = await fetch(base + suffix);
  if (!response.ok) throw new Error(`${suffix} -> ${response.status}`);
  return response.json();
};

const [closeout, pipeline, settings, instancePath] = [await get('/diagnostics/closeout'), await get('/pipeline'), await get('/settings'), 'data/runtime/engine-instance.json'];
const capacity = pipeline.capacityVisibility ?? {};
const verdict = pipeline.authoritativeBlocker ?? {};
const conversion = pipeline.entryConversion ?? {};
const instance = fs.existsSync(instancePath) ? JSON.parse(fs.readFileSync(instancePath, 'utf8')) : null;
const secondaryCodes = (verdict.secondary ?? []).map((row) => row.code);

const result = {
  label, at: new Date().toISOString(),
  identity: {head: null, buildId: instance?.buildId ?? null, artifactHash: instance?.artifactHash ?? null, sourceHash: instance?.sourceHash ?? null,
    pid: instance?.pid ?? null, startedAt: instance?.startedAt ?? null, startReason: instance?.startReason ?? null, restartCount: instance?.restartCount ?? null},
  writeBoundary: closeout.productionWriteBoundary ?? null,
  safety: {environment: settings.connections?.exchange?.environment, executionMode: settings.connections?.executionMode,
    entrySafetyMode: pipeline.runtimeControl?.entrySafetyMode, aiExitAuthority: settings.riskGovernance?.aiExitAuthority ?? settings.aiExitAuthority ?? null,
    tradeEconomicsAdmissionMode: settings.tradeEconomics?.admissionMode, settingsVersion: settings.settingsVersion},
  protection: {required: pipeline.takeProfit?.required ?? null, protected: pipeline.takeProfit?.protected ?? null, missing: pipeline.takeProfit?.missing ?? null,
    unresolved: pipeline.takeProfit?.positionFactUnresolved ?? null, unverifiedTp: pipeline.takeProfit?.unverifiedTp ?? null,
    existingPositions: pipeline.existingPositions ?? null},
  // The two surfaces that used to disagree, read in the same instant from the same projection.
  capacitySays: {sideStatus: capacity.sideStatus?.code ?? null, firstBlocker: capacity.firstBlocker ?? null, exhaustedForNewRisk: capacity.exhaustedForNewRisk ?? null,
    exhaustedReason: capacity.exhaustedReason ?? null, admission: capacity.admission ?? null,
    entryCapacityUsd: {LONG: capacity.entryCapacity?.LONG?.executableNotionalUsd ?? null, SHORT: capacity.entryCapacity?.SHORT?.executableNotionalUsd ?? null}},
  admissionSays: {code: verdict.code ?? null, stage: verdict.stage ?? null, nextAction: verdict.nextAction ?? null,
    binding: verdict.evidence?.riskAdmissionBinding ?? null, gates: verdict.evidence?.riskAdmissionGates ?? null,
    reasons: verdict.evidence?.riskAdmissionReasons ?? null, ageMs: verdict.evidence?.riskAdmissionAgeMs ?? null},
  secondaryCodes,
  consistent: verdict.code !== 'NONE' ? capacity.sideStatus?.code === 'RISK_ADMISSION_EXHAUSTED' || capacity.exhaustedReason === 'RISK_ADMISSION'
    : capacity.sideStatus?.code !== 'RISK_ADMISSION_EXHAUSTED',
  conversion30m: {place: conversion.thirtyMinutes?.place ?? null, riskAllowed: conversion.thirtyMinutes?.riskAllowed ?? null,
    tradePlanReady: conversion.thirtyMinutes?.tradePlanReady ?? null, reservationCreated: conversion.thirtyMinutes?.reservationCreated ?? null,
    intentCreated: conversion.thirtyMinutes?.intentCreated ?? null, submitAttempted: conversion.thirtyMinutes?.submitAttempted ?? null,
    orderSubmitted: conversion.thirtyMinutes?.orderSubmitted ?? null, topDropReason: conversion.thirtyMinutes?.topDropReason ?? null},
  conversion1h: {place: conversion.oneHour?.place ?? null, riskAllowed: conversion.oneHour?.riskAllowed ?? null,
    reservationCreated: conversion.oneHour?.reservationCreated ?? null, orderSubmitted: conversion.oneHour?.orderSubmitted ?? null,
    topDropReason: conversion.oneHour?.topDropReason ?? null},
  modelCost: {primaryBrain: pipeline.primaryBrain?.completed ?? null, scout: pipeline.scout?.completed ?? null, aiHealth: pipeline.aiHealth?.status ?? null},
};
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
