import { onUnmounted, ref, type Ref } from 'vue';

/**
 * A wall clock the views can render against, so a holding duration ticks over instead of only changing
 * when somebody refreshes. The interval is always cleared on unmount: no dangling `setInterval`.
 */
export function useNow(intervalMs = 30_000): Ref<number> {
  const now = ref(Date.now());
  const timer = window.setInterval(() => { now.value = Date.now(); }, intervalMs);
  onUnmounted(() => window.clearInterval(timer));
  return now;
}
