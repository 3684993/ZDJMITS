<script setup lang="ts">
defineProps<{ title: string; detail?: string }>();
</script>

<template><div class="empty"><strong>{{ title }}</strong><span v-if="detail">{{ detail }}</span></div></template>
