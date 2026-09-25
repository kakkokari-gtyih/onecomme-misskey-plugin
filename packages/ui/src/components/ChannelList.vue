<template>
    <div class="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="チャンネル">
        <div v-if="channels == null" class="rounded-lg border border-line border-dashed p-3 text-center text-muted">読み込み中…</div>
        <div v-else-if="items.length === 0" class="rounded-lg border border-line border-dashed p-3 text-center text-muted">
            お気に入りに登録したチャンネルがありません。Misskeyでチャンネルをお気に入りに登録してから「再読み込み」を押してください。
        </div>
        <label
            v-for="channel in items"
            :key="channel.id"
            class="flex cursor-pointer items-center gap-3 rounded-lg border p-2 hover:bg-accent/5"
            :class="model === channel.id ? 'border-accent ring-1 ring-accent ring-inset' : 'border-line'"
        >
            <input v-model="model" type="radio" name="channel" :value="channel.id" class="sr-only">
            <div class="flex h-5 w-5 p-[3px] shrink-0 border-2 border-line rounded-full">
                <div v-if="model === channel.id" class="h-2.5 w-2.5 rounded-full bg-accent"></div>
            </div>
            <div class="min-w-0 flex-1">
                <div class="block truncate font-bold">{{ channel.name }}<template v-if="channel.isArchived">（アーカイブ済み）</template></div>
                <div class="block truncate text-xs text-muted">{{ channel.description }}</div>
            </div>
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
