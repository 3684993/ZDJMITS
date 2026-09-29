// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { useNow } from './useNow';

const Probe = defineComponent({
  setup() {
    const now = useNow(30_000);
    return () => h('span', String(now.value));
  },
});

const START = 1_800_000_000_000;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
afterEach(() => { vi.useRealTimers(); });

describe('useNow', () => {
  it('advances on a modest interval so a holding duration ticks over without a refresh', async () => {
    const wrapper = mount(Probe);
    expect(Number(wrapper.text())).toBe(START);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Number(wrapper.text())).toBe(START + 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Number(wrapper.text())).toBe(START + 60_000);
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(Number(wrapper.text())).toBe(START + 60_000);
  });
});
