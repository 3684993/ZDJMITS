<script setup lang="ts">
defineProps<{ label: string; value: number }>();
</script>

<template><div class="score-row"><div><span>{{ label }}</span><strong>{{ value.toFixed(0) }}</strong></div><div class="score-track"><i :style="{ width: `${Math.max(0, Math.min(100, value))}%` }"></i></div></div></template>
