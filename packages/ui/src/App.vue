<template>
    <main class="mx-auto max-w-160 px-4 pt-6 pb-12">
        <h1 class="text-xl font-bold mb-4">Misskey連携プラグイン</h1>

        <section class="card">
            <h2 class="card-title">Misskeyアカウント</h2>
            <p v-if="loadError != null" class="text-danger">設定を読み込めませんでした: {{ loadError }}</p>
            <p v-else-if="state == null" class="text-muted">読み込み中…</p>
            <AccountCard
                v-else-if="state.loggedIn && state.misskeyUser != null && state.misskeyHost != null"
                :user="state.misskeyUser"
                :origin="state.misskeyHost"
                @logout="onLogout"
            />
            <LoginForm
                v-else
                :initialOrigin="state.misskeyHost"
                :pending="state.miauthPending"
                @started="onLoginStarted"
                @cancel="onLoginCancel"
            />
        </section>

        <template v-if="state?.loggedIn">
            <CaptureSettings :state="state" @update:state="replace" />
            <DisplaySettings :state="state" @update:state="replace" />
        </template>
    </main>

    <AppToast />
</template>

<script setup lang="ts">
import { watch } from 'vue';

import { getErrorMessage, postApi } from '@/api.js';
import AccountCard from '@/components/AccountCard.vue';
import AppToast from '@/components/AppToast.vue';
import CaptureSettings from '@/components/CaptureSettings.vue';
import DisplaySettings from '@/components/DisplaySettings.vue';
import LoginForm from '@/components/LoginForm.vue';
import { usePluginState } from '@/composables/usePluginState.js';
import { useToast } from '@/composables/useToast.js';

const { state, loadError, replace } = usePluginState();
const { show } = useToast();

/** ユーザー操作によるキャンセルかどうか（タイムアウトと区別するため） */
let cancelledByUser = false;

watch(() => state.value?.miauthPending, (pending, prev) => {
    if (!prev || pending) return;
    if (state.value?.loggedIn) {
        show('ログインしました');
    } else if (!cancelledByUser) {
        show('ログインがタイムアウトしました。もう一度お試しください', 'error');
    }
    cancelledByUser = false;
});

function onLoginStarted() {
    if (state.value != null) state.value.miauthPending = true;
}

async function onLoginCancel() {
    cancelledByUser = true;
    try {
        replace(await postApi('miauth/cancel', {}));
    } catch (err) {
        show(getErrorMessage(err), 'error');
    }
}

async function onLogout() {
    if (!confirm('ログアウトしますか？コメント連携も停止します。')) return;
    try {
        replace(await postApi('logout', {}));
        show('ログアウトしました');
    } catch (err) {
        show(getErrorMessage(err), 'error');
    }
}
</script>
