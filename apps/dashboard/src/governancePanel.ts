/**
 * S08: the dashboard side of the governance settings panel, kept out of the component so it can be
 * tested without a browser and so the page cannot invent units of its own.
 *
 * The rows come from the server readback. This module only works out what the operator changed, which
 * changes need an acknowledgement before they may be sent, and how a refusal should be shown. It never
 * sends a field the server did not mark editable, and it never strips the unit off a value on the way
 * in or on the way out - a page that displayed `0.15` while sending `15` would be the bug this avoids.
 */

export type GovernanceRow = {
  path: string;
  value: unknown;
  kind: 'boolean' | 'integer' | 'number' | 'enum';
  unit: string;
  min: number | null;
  max: number | null;
  enum: string[] | null;
  default: unknown;
  meaning: string;
  effectiveAt: string;
  editable: boolean;
  ack: string | null;
  /** Which values need the acknowledgement. The server owns this rule; the page only mirrors it. */
  ackOnlyFor: unknown[] | null;
  readOnlyReason: string | null;
  consumers: string[];
  atDefault: boolean;
};

export type GovernancePanelState = {
  rows: GovernanceRow[];
  settingsVersion: number;
  ownershipSchema: { schemaVersion: number; runtimeSchemaVersion: number; minSupported: number } | null;
};

/** The subset an operator should see first: the AI exit and bounded-review block. */
export const EXIT_COORDINATION_PREFIX = 'riskGovernance.exitCoordination.';

export function exitCoordinationRows(state: GovernancePanelState) {
  return state.rows.filter(row => row.path.startsWith(EXIT_COORDINATION_PREFIX));
}

export function initialValues(rows: GovernanceRow[]): Record<string, unknown> {
  return Object.fromEntries(rows.map(row => [row.path, row.value]));
}

/** Paths whose edited value differs from what the server reported. */
export function changedPaths(rows: GovernanceRow[], draft: Record<string, unknown>): string[] {
  return rows.filter(row => row.editable && JSON.stringify(draft[row.path]) !== JSON.stringify(row.value)).map(row => row.path);
}

export function buildGovernancePatch(rows: GovernanceRow[], draft: Record<string, unknown>) {
  const editable = new Map(rows.filter(row => row.editable).map(row => [row.path, row]));
  const fields: Record<string, unknown> = {};
  const refused: Array<{ path: string; reason: string }> = [];
  for (const [path, value] of Object.entries(draft)) {
    const row = editable.get(path);
    if (!row) { if (JSON.stringify(value) !== JSON.stringify(rows.find(item => item.path === path)?.value)) refused.push({ path, reason: '服务端把该字段标为不可编辑' }); continue; }
    if (JSON.stringify(value) === JSON.stringify(row.value)) continue;
    fields[path] = value;
  }
  return { fields, refused };
}

/** Which acknowledgement tokens the pending patch requires before it can be sent. */
export function requiredAcks(rows: GovernanceRow[], fields: Record<string, unknown>) {
  const acks = new Set<string>();
  for (const row of rows) {
    if (!row.editable || !row.ack) continue;
    if (!(row.path in fields)) continue;
    if (JSON.stringify(fields[row.path]) === JSON.stringify(row.value)) continue;
    // The server decides which values are an authority increase; asking for a confirmation it would
    // not require would train an operator to tick the box without reading it.
    if (row.ackOnlyFor && !row.ackOnlyFor.some(value => JSON.stringify(value) === JSON.stringify(fields[row.path]))) continue;
    acks.add(row.ack);
  }
  return [...acks].sort();
}

export function canSubmit(input: { fields: Record<string, unknown>; refused: Array<{ path: string; reason: string }>; requiredAcks: string[]; grantedAcks: string[] }) {
  if (!Object.keys(input.fields).length) return { ok: false, reason: '没有需要保存的改动' };
  if (input.refused.length) return { ok: false, reason: input.refused.map(item => `${item.path}：${item.reason}`).join('；') };
  const missing = input.requiredAcks.filter(ack => !input.grantedAcks.includes(ack));
  if (missing.length) return { ok: false, reason: `需要先确认权限变更：${missing.join('、')}` };
  return { ok: true, reason: '' };
}

/** How one value is rendered, with its unit kept attached to it. */
export function formatGovernanceValue(row: GovernanceRow) {
  if (row.value === null || row.value === undefined || row.value === '') return '未设置';
  if (row.unit === 'MS') return Number(row.value) >= 60_000 ? `${Math.round(Number(row.value) / 60_000 * 10) / 10} 分钟（${row.value} ms）` : `${row.value} ms`;
  if (row.unit === 'MINUTES' && Number(row.value) >= 60) return `${Math.round(Number(row.value) / 60 * 10) / 10} 小时（${row.value} 分钟）`;
  if (row.unit === 'PERCENT_OF_MARGIN') return `${row.value}%（按保证金计，0.15 即 0.15%）`;
  if (row.unit === 'RATIO' && typeof row.value === 'number') return `${row.value}（= ${(row.value * 100).toFixed(2)}%）`;
  if (row.unit === 'USD') return `${row.value} USDT`;
  return String(row.value);
}

export function describeRefusals(refusals: unknown) {
  const list = Array.isArray((refusals as any)?.refusals) ? (refusals as any).refusals : Array.isArray(refusals) ? refusals : [];
  return list.map((refusal: any) => `${refusal.path ?? refusal.code}：${refusal.detail ?? refusal.code ?? '拒绝'}`);
}
