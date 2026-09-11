import { describe, expect, it } from 'vitest';
import { byClosedAtDesc, byOpenedAtDesc } from './chronologicalSort.js';

describe('chronological API ordering', () => {
  it('puts newest positions first and unknown entry time last', () => {
    const rows = [{ id: 'old', openedAt: 10 }, { id: 'new', openedAt: 20 }, { id: 'unknown', openedAt: null }];
    expect(rows.sort(byOpenedAtDesc).map(x => x.id)).toEqual(['new', 'old', 'unknown']);
  });
  it('orders closed trades by close fact, independent of update time', () => {
    const rows = [{ id: 'first', closedAt: 10 }, { id: 'latest', closedAt: 20, updatedAt: 1 }, { id: 'open', closedAt: null }];
    expect(rows.sort(byClosedAtDesc).map(x => x.id)).toEqual(['latest', 'first', 'open']);
  });
});
