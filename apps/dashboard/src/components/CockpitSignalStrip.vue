<script setup lang="ts">
import type {CockpitSignal} from '../utils/cockpitStatus';
defineProps<{signals:CockpitSignal[]}>();
</script>
<template>
  <div class="cockpit-signals" aria-label="交易环境与关键链路" data-cockpit-signal-strip>
    <div v-for="signal in signals" :key="signal.id" class="signal-item" :class="'signal-'+signal.tone"
      :data-signal="signal.id" :title="signal.detail" :aria-label="signal.label+'：'+signal.text+'。'+signal.detail">
      <span class="signal-dot" aria-hidden="true"></span>
      <span class="signal-copy"><b v-if="signal.id!=='environment'">{{signal.label}}</b><strong>{{signal.text}}</strong></span>
    </div>
  </div>
</template>
<style scoped>
.cockpit-signals{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
.signal-item{--signal:#8593a4;display:flex;align-items:center;gap:7px;min-height:29px;border:1px solid var(--line);background:var(--surface);padding:5px 9px;border-radius:100px;font-size:11px;line-height:1.1;white-space:nowrap}
.signal-good{--signal:#159b67}.signal-warn{--signal:#e1a13e}.signal-bad{--signal:#e05259}
.signal-dot{width:8px;height:8px;background:var(--signal);box-shadow:0 0 0 3px color-mix(in srgb,var(--signal) 12%,transparent);border-radius:50%;flex:none}
.signal-copy{display:flex;gap:4px;align-items:center}.signal-copy b{font-weight:500;color:var(--muted)}.signal-copy strong{font-weight:650;color:var(--text)}
.signal-bad .signal-copy strong{color:var(--red)}.signal-warn .signal-copy strong{color:var(--text)}
@media(max-width:900px){.cockpit-signals{gap:5px;flex-wrap:nowrap;overflow-x:auto;max-width:100%;scrollbar-width:thin}.signal-item{flex:none}}
</style>