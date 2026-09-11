<script setup lang="ts">
defineProps<{ value: string }>();

const cls = (value: string) => {
  const status = value.toUpperCase();
  if (['HEALTHY', 'ONLINE', 'PROTECTED', 'FILLED', 'PLACE_LONG', 'LONG', 'READY'].includes(status)) return 'good';
  if (['OFFLINE', 'MISSING', 'MISMATCH', 'FAILED', 'REJECTED', 'SHORT', 'PLACE_SHORT'].includes(status)) return status === 'SHORT' || status === 'PLACE_SHORT' ? 'bad' : 'danger';
  if (['DEGRADED', 'PENDING', 'WORKING', 'ANALYZING', 'BUSY', 'EXPIRED'].includes(status)) return 'warn';
  return 'neutral';
};
</script>

<template><span class="status-badge" :class="cls(value)">{{ value }}</span></template>
