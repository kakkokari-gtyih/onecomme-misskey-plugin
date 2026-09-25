<template>
    <section class="card">
        <h2 class="card-title">コメント連携</h2>

        <div class="flex flex-wrap items-center justify-between gap-3">
            <ToggleSwitch v-model="enableCapture">チャンネルのノートをコメント一覧に流す</ToggleSwitch>
            <StatusBadge :status="state.captureStatus" />
        </div>

        <label class="mt-4 block">
            <span class="field-label">わんコメの枠</span>
            <ServiceSelect v-model="serviceId" :services="services" />
            <span class="note">ノートはこの枠のコメントとして追加されます。枠ごとの読み上げや色の設定が適用されます。</span>
        </label>

        <div class="mt-4">
            <div class="flex items-center justify-between gap-2">
                <span class="field-label mb-0">チャンネル</span>
                <button type="button" class="btn btn-sm" @click="loadChannels">再読み込み</button>
            </div>
            <span class="note">Misskeyでお気に入りに登録したチャンネルが表示されます。</span>
            <ChannelList v-model="channelId" :channels="channels" :savedChannelName="state.captureChannelName" />
        </div>

        <div class="mt-5 flex justify-end">
            <button type="button" class="btn-primary" :disabled="saving" @click="save">保存</button>
        </div>
    </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { ChannelSummary, PublicState, ServiceSummary } from '@onecomme-misskey/shared';

import { getApi, getErrorMessage, postApi } from '@/api.js';
import ChannelList from '@/components/ChannelList.vue';
import ServiceSelect from '@/components/ServiceSelect.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import { useToast } from '@/composables/useToast.js';

const props = defineProps<{
    state: PublicState;
}>();

const emit = defineEmits<{
    'update:state': [state: PublicState];
}>();

const { show } = useToast();

// 編集中の値（保存するまでプラグインには反映しない）
const enableCapture = ref(false);
const serviceId = ref<string | null>(null);
const channelId = ref<string | null>(null);

// state が差し替わったとき（保存時・ログイン状態の変化時）だけ同期する。
// 接続状態のポーリングは同じオブジェクトを書き換えるだけなので、編集中の値は上書きされない
watch(() => props.state, (state) => {
    enableCapture.value = state.enableCapture;
    serviceId.value = state.onecommeServiceId;
    channelId.value = state.captureChannelId;
}, { immediate: true });

const services = ref<ServiceSummary[]>([]);
const channels = ref<ChannelSummary[] | null>(null);
const saving = ref(false);

async function loadServices() {
    try {
        services.value = await getApi('services');
    } catch (err) {
        services.value = [];
        show(`わんコメの枠一覧を取得できませんでした: ${getErrorMessage(err)}`, 'error');
    }
}

async function loadChannels() {
    channels.value = null;
    try {
        channels.value = await getApi('channels');
    } catch (err) {
        channels.value = [];
        show(`チャンネル一覧を取得できませんでした: ${getErrorMessage(err)}`, 'error');
    }
}

async function save() {
    saving.value = true;
    try {
        const next = await postApi('settings', {
            enableCapture: enableCapture.value,
            onecommeServiceId: serviceId.value,
            captureChannelId: channelId.value,
        });
        // 枠が新しく作成されている可能性があるので一覧を更新する
        await loadServices();
        emit('update:state', next);
        show('保存しました');
    } catch (err) {
        show(getErrorMessage(err), 'error');
        // 失敗時は有効/無効だけプラグイン側の状態に合わせる
        try {
            enableCapture.value = (await getApi('state')).enableCapture;
        } catch {
            // noop
        }
    } finally {
        saving.value = false;
    }
}

onMounted(() => {
    void Promise.all([loadServices(), loadChannels()]);
});
</script>
