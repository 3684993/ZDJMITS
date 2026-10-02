import {describe, expect, it} from 'vitest';
import {relatedBrainRunArtifacts} from './router.js';

describe('AI run related evidence identity', () => {
  it.each([undefined, null, '', ' '])('does not borrow Scout or Primary artifacts when packet identity is %s', packetId => {
    const compacted = {id: 'retained-primary', role: 'PRIMARY_BRAIN', status: 'COMPLETED', packetId, rawArtifactStatus: 'COMPACTED'};
    const unrelated = [
      {id: 'other-scout', role: 'SCOUT', packetId, inputPreview: 'unrelated scout input', outputPreview: 'unrelated scout output'},
      {id: 'other-primary', role: 'PRIMARY_BRAIN', packetId, inputPreview: 'unrelated primary input'},
    ];
    const result = relatedBrainRunArtifacts(compacted, unrelated);
    expect(result.scout).toBeUndefined();
    expect(result.primary).toBe(compacted);
    expect(result.primary.inputPreview).toBeUndefined();
  });

  it('keeps the selected durable Primary input when another Primary reused the same packet', () => {
    const selected = {id: 'selected', role: 'PRIMARY_BRAIN', packetId: 'packet-1', inputPreview: 'selected frozen input'};
    const scout = {id: 'scout', role: 'SCOUT', packetId: 'packet-1', inputPreview: 'same packet scout input'};
    const result = relatedBrainRunArtifacts(selected, [
      {id: 'other-primary', role: 'PRIMARY_BRAIN', packetId: 'packet-1', inputPreview: 'different prompt for same packet'},
      {id: 'unrelated-scout', role: 'SCOUT', packetId: 'packet-2', inputPreview: 'different packet'},
      scout,
    ]);
    expect(result).toEqual({scout, primary: selected});
  });

  it('retains the selected Scout artifact and links a Primary only with an exact known packet', () => {
    const selected = {id: 'scout-selected', role: 'SCOUT', packetId: 'packet-1', inputPreview: 'selected scout input'};
    const primary = {id: 'primary', role: 'PRIMARY_BRAIN', packetId: 'packet-1', inputPreview: 'primary input'};
    expect(relatedBrainRunArtifacts(selected, [
      {id: 'scout-old', role: 'SCOUT', packetId: 'packet-1', inputPreview: 'older scout input'}, primary,
    ])).toEqual({scout: selected, primary});
  });
});
