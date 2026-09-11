<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string; flush?: boolean }>();
</script>

<template><section class="panel" :class="{ flush }"><header v-if="title || subtitle" class="panel-head"><div><h2 v-if="title">{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p></div><slot name="actions"/></header><div class="panel-body"><slot/></div></section></template>
