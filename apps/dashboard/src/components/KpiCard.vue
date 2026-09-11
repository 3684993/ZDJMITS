<script setup lang="ts">
defineProps<{ label: string; value: string; detail?: string; tone?: 'normal' | 'positive' | 'negative' | 'accent' }>();
</script>

<template><div class="kpi"><span>{{ label }}</span><strong :class="tone">{{ value }}</strong><small v-if="detail">{{ detail }}</small></div></template>
