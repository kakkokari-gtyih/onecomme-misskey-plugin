import { onMounted, onUnmounted, ref } from 'vue';
import type { PublicState } from '@onecomme-misskey/shared';

import { getApi, getErrorMessage } from '@/api.js';

const POLLING_INTERVAL = 2000;

/**
 * プラグインの状態を読み込み、接続状態とログイン待ちの状態を定期的に更新する。
 * （編集中のフォームを上書きしないよう、ログイン状態が変わったとき以外は一部の項目のみ更新する）
 */
export function usePluginState() {
    const state = ref<PublicState | null>(null);
    const loadError = ref<string | null>(null);

    async function load() {
        try {
            state.value = await getApi('state');
            loadError.value = null;
        } catch (err) {
            loadError.value = getErrorMessage(err);
        }
    }

    async function poll() {
        if (state.value == null || document.hidden) return;
        try {
            const latest = await getApi('state');
            if (state.value == null) return;
            if (latest.loggedIn !== state.value.loggedIn || latest.misskeyUser?.id !== state.value.misskeyUser?.id) {
                state.value = latest;
            } else {
                state.value.captureStatus = latest.captureStatus;
                state.value.miauthPending = latest.miauthPending;
            }
        } catch {
            // noop
        }
    }

    function replace(next: PublicState) {
        state.value = next;
    }

    let timer: ReturnType<typeof setInterval> | undefined;
    onMounted(() => {
        void load();
        timer = setInterval(poll, POLLING_INTERVAL);
    });
    onUnmounted(() => {
        clearInterval(timer);
    });

    return { state, loadError, load, replace };
}
