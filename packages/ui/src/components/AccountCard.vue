<template>
    <div class="flex items-center gap-3">
        <img
            v-if="user.avatarUrl != null"
            :src="user.avatarUrl"
            alt=""
            class="size-12 shrink-0 rounded-full object-cover bg-line"
        >
        <div v-else class="size-12 shrink-0 rounded-full bg-line"></div>
        <div class="min-w-0 flex-1">
            <div class="truncate font-bold">{{ user.name || user.username }}</div>
            <div class="truncate text-muted">{{ acct }}</div>
        </div>
        <button type="button" class="btn" @click="emit('logout')">ログアウト</button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MisskeyUser } from '@onecomme-misskey/shared';

const props = defineProps<{
    user: MisskeyUser;
    origin: string;
}>();

const emit = defineEmits<{
    (ev: 'logout'): void;
}>();

const acct = computed(() => `@${props.user.username}@${new URL(props.origin).host}`);
</script>
