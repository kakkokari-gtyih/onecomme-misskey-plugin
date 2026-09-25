<template>
    <div class="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="チャンネル">
        <div v-if="channels == null" class="rounded-lg border border-line border-dashed p-3 text-center text-muted">読み込み中…</div>
        <div v-else-if="items.length === 0" class="rounded-lg border border-line border-dashed p-3 text-center text-muted">
            お気に入りに登録したチャンネルがありません。Misskeyでチャンネルをお気に入りに登録してから「再読み込み」を押してください。
        </div>
        <label
            v-for="channel in items"
            :key="channel.id"
            class="flex cursor-pointer items-center gap-3 rounded-lg border p-2"
            :class="model === channel.id ? 'border-accent ring-1 ring-accent ring-inset' : 'border-line'"
        >
            <input v-model="model" type="radio" name="channel" :value="channel.id" class="m-0 shrink-0 accent-accent">
            <span
                class="h-9 w-16 shrink-0 overflow-hidden rounded-md border-l-4 bg-line"
                :style="{ borderLeftColor: channel.color }"
            >
                <img v-if="channel.bannerUrl != null" :src="channel.bannerUrl" alt="" class="size-full object-cover">
            </span>
            <span class="min-w-0 flex-1">
                <span class="block truncate font-bold">{{ channel.name }}<template v-if="channel.isArchived">（アーカイブ済み）</template></span>
                <span class="block truncate text-xs text-muted">{{ channel.description }}</span>
            </span>
        </label>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ChannelSummary } from '@onecomme-misskey/shared';

const props = defineProps<{
    /** null は読み込み中 */
    channels: ChannelSummary[] | null;
    /** 保存済みのチャンネル名（お気に入りから外れている場合の表示用） */
    savedChannelName: string | null;
}>();

const model = defineModel<string | null>({ required: true });

const items = computed<ChannelSummary[]>(() => {
    if (props.channels == null) return [];
    const id = model.value;
    // 選択中のチャンネルがお気に入りから外れていても選択肢に残す
    if (id != null && !props.channels.some((c) => c.id === id)) {
        return [{
            id,
            name: props.savedChannelName ?? id,
            description: 'お気に入りに登録されていないチャンネル',
            bannerUrl: null,
            color: 'transparent',
            isArchived: false,
            notesCount: 0,
            usersCount: 0,
        }, ...props.channels];
    }
    return props.channels;
});
</script>
