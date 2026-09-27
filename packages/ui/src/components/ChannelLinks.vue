<template>
    <section class="card">
        <h2 class="card-title">コメント連携</h2>

        <p>わんコメの枠にMisskeyのチャンネルを設定すると、そのチャンネルの新しいノートがコメントとして追加されます。</p>
        <ol class="mt-3 list-decimal pl-5 space-y-1">
            <li>わんコメで枠を追加します</li>
            <li>
                枠の「視聴URL」に、Misskeyのチャンネルのページのアドレスを貼り付けます
                <span class="block text-xs text-muted">例: <code class="rounded bg-canvas px-1">{{ host }}/channels/xxxxxxxxxx</code></span>
            </li>
            <li>枠の「接続」をオンにすると、コメントの追加が始まります</li>
        </ol>
        <ul class="mt-3 list-disc pl-5 space-y-0.5 text-xs text-muted">
            <li>ログイン中のサーバー（{{ hostname }}）のチャンネルのみ連携できます。</li>
            <li>枠を複数追加すると、複数のチャンネルを同時に連携できます。</li>
            <li>わんコメの仕様上、同じ種類のサイトに同時に接続できる枠の数には上限があります（ライセンスによって異なります）。</li>
        </ul>

        <h3 class="field-label mt-5">チャンネルを設定した枠</h3>
        <div v-if="links.length === 0" class="rounded-lg border border-line border-dashed p-3 text-center text-muted">
            チャンネルのアドレスが設定された枠はまだありません。
        </div>
        <ul v-else class="flex flex-col gap-2">
            <li v-for="link in links" :key="link.serviceId" class="flex items-center gap-3 rounded-lg border border-line p-2">
                <div class="min-w-0 flex-1">
                    <div class="truncate font-bold">{{ link.serviceName }}</div>
                    <div class="truncate text-xs text-muted">{{ link.channelName ?? link.channelId }}</div>
                </div>
                <StatusBadge :status="link.status" class="shrink-0" />
                <a
                    :href="`${host}/channels/${link.channelId}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block h-8 w-8 shrink-0 rounded-full p-2.5 hover:bg-accent/20"
                    title="チャンネルを開く"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="block h-3 w-3" viewBox="0 0 16 16">
                        <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5"/>
                        <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0z"/>
                    </svg>
                </a>
            </li>
        </ul>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ChannelLink } from '@onecomme-misskey/shared';

import StatusBadge from '@/components/StatusBadge.vue';

const props = defineProps<{
    /** ログイン中のサーバーのorigin */
    host: string;
    links: ChannelLink[];
}>();

const hostname = computed(() => new URL(props.host).host);
</script>
