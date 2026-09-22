import { describe, expect, it } from "vitest";
import { buildGovernancePatch, canSubmit, changedPaths, describeRefusals, exitCoordinationRows, formatGovernanceValue, initialValues, requiredAcks, type GovernancePanelState, type GovernanceRow } from "./governancePanel";

/**
 * S08: the governance panel's own logic. The point of these tests is that the page never gets to
 * decide what a number means - it displays the unit the server sent, it sends back the same magnitude,
 * and it cannot offer a change the server marked read-only.
 */

const row = (over: Partial<GovernanceRow> & { key: string }): GovernanceRow => ({
  value: null, kind: "number", unit: "COUNT", min: 0, max: 10, enum: null,
  default: 0, meaning: "测试字段", effectiveAt: "NEXT_TICK", editable: true, ack: null, ackOnlyFor: null, readOnlyReason: null,
  consumers: ["x.ts#y"], atDefault: true,
  ...over,
  path: `riskGovernance.exitCoordination.${over.key}`,
});

const authority = row({ key: "aiExitAuthority", kind: "enum", unit: "ENUM", value: "OFF", enum: ["OFF", "SHADOW", "ENFORCE"],
  ack: "AI_EXIT_ENFORCE_AUTHORITY", ackOnlyFor: ["ENFORCE"] });
const reviews = row({ key: "normalReviewsPerPlan", value: 2, min: 0, max: 6 });
const lossLimit = row({ key: "aiExitLossLimitUsd", unit: "USD", value: 10, min: 0, max: 10 });
const locked = row({ key: "positionReviewWishful", editable: false, readOnlyReason: "没有生产消费者" });
const unrelated = row({ key: "somewhereElse", value: 1 });

const state = (rows: GovernanceRow[]): GovernancePanelState => ({ rows, settingsVersion: 4,
  ownershipSchema: { schemaVersion: 1, runtimeSchemaVersion: 1, minSupported: 1 } });

describe("governance panel", () => {
  it("shows only the exit-coordination block on this tab", () => {
    const rows = exitCoordinationRows(state([authority, reviews, lossLimit, locked,
      { ...unrelated, path: "positionManagement.humanHandoffAfterMinutes" }]));
    expect(rows.map(item => item.path)).toEqual([
      "riskGovernance.exitCoordination.aiExitAuthority",
      "riskGovernance.exitCoordination.normalReviewsPerPlan",
      "riskGovernance.exitCoordination.aiExitLossLimitUsd",
      "riskGovernance.exitCoordination.positionReviewWishful",
    ]);
  });

  it("seeds the draft from the server value and reports nothing dirty", () => {
    const draft = initialValues([reviews, lossLimit]);
    expect(draft["riskGovernance.exitCoordination.normalReviewsPerPlan"]).toBe(2);
    expect(draft["riskGovernance.exitCoordination.aiExitLossLimitUsd"]).toBe(10);
    expect(changedPaths([reviews], draft)).toEqual([]);
    expect(changedPaths([reviews], { [reviews.path]: 4 })).toEqual([reviews.path]);
  });

  it("sends the value it displayed, without a hidden unit conversion", () => {
    const roi = row({ key: "minNetProfitRoiPct", unit: "PERCENT_OF_MARGIN", value: 0.15 });
    expect(buildGovernancePatch([roi], { [roi.path]: 0.15 }).fields).toEqual({});
    expect(buildGovernancePatch([roi], { [roi.path]: 0.3 }).fields).toEqual({ [roi.path]: 0.3 });
    expect(formatGovernanceValue(roi)).toContain("0.15 即 0.15%");
  });

  it("refuses to offer a change to a field the server marked read-only", () => {
    const built = buildGovernancePatch([locked], { [locked.path]: true });
    expect(built.fields).toEqual({});
    expect(built.refused).toEqual([{ path: locked.path, reason: "服务端把该字段标为不可编辑" }]);
    expect(canSubmit({ fields: {}, refused: built.refused, requiredAcks: [], grantedAcks: [] }).ok).toBe(false);
  });

  it("asks for an acknowledgement only when authority actually increases", () => {
    const toShadow = buildGovernancePatch([authority], { [authority.path]: "SHADOW" });
    expect(requiredAcks([authority], toShadow.fields)).toEqual([]);
    const toEnforce = buildGovernancePatch([authority], { [authority.path]: "ENFORCE" });
    expect(requiredAcks([authority], toEnforce.fields)).toEqual(["AI_EXIT_ENFORCE_AUTHORITY"]);
    expect(canSubmit({ fields: toEnforce.fields, refused: [], requiredAcks: ["AI_EXIT_ENFORCE_AUTHORITY"], grantedAcks: [] }))
      .toMatchObject({ ok: false, reason: expect.stringContaining("需要先确认权限变更") });
    expect(canSubmit({ fields: toEnforce.fields, refused: [], requiredAcks: ["AI_EXIT_ENFORCE_AUTHORITY"], grantedAcks: ["AI_EXIT_ENFORCE_AUTHORITY"] }).ok).toBe(true);
  });

  it("does not let an operator save an unchanged form", () => {
    expect(canSubmit({ fields: {}, refused: [], requiredAcks: [], grantedAcks: [] }))
      .toMatchObject({ ok: false, reason: "没有需要保存的改动" });
  });

  it("renders units the operator can read without opening code", () => {
    expect(formatGovernanceValue(row({ key: "reviewMinIntervalMs", unit: "MS", value: 300_000 }))).toBe("5 分钟（300000 ms）");
    expect(formatGovernanceValue(row({ key: "lossLine", unit: "USD", value: 10 }))).toBe("10 USDT");
    expect(formatGovernanceValue(row({ key: "ratioLine", unit: "RATIO", value: 0.01 }))).toContain("1.00%");
    expect(formatGovernanceValue(row({ key: "handoffMinutes", unit: "MINUTES", value: 1440 }))).toContain("24 小时");
    expect(formatGovernanceValue({ ...reviews, value: null })).toBe("未设置");
  });

  it("turns a server refusal list into one readable line per field", () => {
    const lines = describeRefusals({ refusals: [{ path: reviews.path, code: "GOVERNANCE_ABOVE_MAXIMUM", detail: "99>6" }] });
    expect(lines).toEqual([`${reviews.path}：99>6`]);
    expect(describeRefusals({})).toEqual([]);
  });
});
