<template>
    <form @submit.prevent="submit">
        <label class="block">
            <span class="field-label">サーバーのURL</span>
            <input v-model="host" type="text" class="input" placeholder="misskey.io" autocomplete="url" required>
        </label>
        <button type="submit" class="btn-primary mt-3" :disabled="starting || pending">Misskeyでログイン</button>
        <p class="note">MiAuthでログインします。</p>

        <div v-if="pending" class="mt-3">
            <p class="mb-2 text-xs font-bold text-accent">
                別のタブでMisskeyのログインを許可してください。許可すると自動でこの画面に反映されます（「アプリケーションに戻って」と表示されたら、そのタブは閉じて構いません）。
            </p>
            <button type="button" class="btn btn-sm" @click="emit('cancel')">キャンセル</button>
        </div>
    </form>
</template>

<script setup lang="ts">
import { ref } from 'vue';

import { getErrorMessage, postApi } from '@/api.js';
import { useToast } from '@/composables/useToast.js';

const props = defineProps<{
    /** 前回ログインしていたサーバー */
    initialOrigin: string | null;
    /** MiAuthの認可待ち */
    pending: boolean;
}>();

const emit = defineEmits<{
    started: [];
    cancel: [];
}>();

const { show } = useToast();

const host = ref(props.initialOrigin != null ? new URL(props.initialOrigin).host : '');
const starting = ref(false);

async function submit() {
    // ポップアップブロックを避けるため、ユーザー操作の直後にタブを開いておく
    const authWindow = window.open('about:blank', '_blank');
    starting.value = true;
    try {
        const { url } = await postApi('miauth/start', { host: host.value });
        if (authWindow != null) {
            authWindow.location.href = url;
        } else {
            window.open(url, '_blank');
        }
        emit('started');
    } catch (err) {
        authWindow?.close();
        show(getErrorMessage(err), 'error');
    } finally {
        starting.value = false;
    }
}
</script>
