<template>
    <span class="rounded-full border px-2.5 py-0.5 text-xs" :class="current.class">{{ current.label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CaptureStatus } from '@onecomme-misskey/shared';

const props = defineProps<{
    status: CaptureStatus;
}>();

const STATUS = {
    disabled: { label: '停止中', class: 'border-line text-muted' },
    connecting: { label: '接続中…', class: 'border-warning text-warning' },
    connected: { label: '接続済み', class: 'border-accent text-accent' },
    reconnecting: { label: '再接続中…', class: 'border-warning text-warning' },
} satisfies Record<CaptureStatus, { label: string; class: string }>;

const current = computed(() => STATUS[props.status]);
</script>
