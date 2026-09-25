// @ts-check
'use strict';

/**
 * @typedef {{
 *   loggedIn: boolean;
 *   miauthPending: boolean;
 *   misskeyHost: string | null;
 *   misskeyUser: { id: string; username: string; name: string | null; avatarUrl: string | null } | null;
 *   enableCapture: boolean;
 *   captureChannelId: string | null;
 *   captureChannelName: string | null;
 *   onecommeServiceId: string | null;
 *   captureStatus: 'disabled' | 'connecting' | 'connected' | 'reconnecting';
 * }} PublicState
 * @typedef {{ id: string; name: string; description: string | null; bannerUrl: string | null; color: string; isArchived: boolean }} Channel
 * @typedef {{ id: string; name: string }} Service
 */

const STATUS_LABELS = {
    disabled: '停止中',
    connecting: '接続中…',
    connected: '接続済み',
    reconnecting: '再接続中…',
};

const STATUS_POLLING_INTERVAL = 3000;
const LOGIN_POLLING_INTERVAL = 2000;

/** @param {string} id */
function $(id) {
    const el = document.getElementById(id);
    if (el == null) throw new Error(`#${id} not found`);
    return el;
}

const el = {
    accountLoading: $('account-loading'),
    accountInfo: $('account-info'),
    accountAvatar: /** @type {HTMLImageElement} */ ($('account-avatar')),
    accountName: $('account-name'),
    accountAcct: $('account-acct'),
    logoutButton: /** @type {HTMLButtonElement} */ ($('logout-button')),
    loginForm: /** @type {HTMLFormElement} */ ($('login-form')),
    loginHost: /** @type {HTMLInputElement} */ ($('login-host')),
    loginWaiting: $('login-waiting'),
    loginCancel: /** @type {HTMLButtonElement} */ ($('login-cancel')),
    captureSection: $('capture-section'),
    enableCapture: /** @type {HTMLInputElement} */ ($('enable-capture')),
    captureStatus: $('capture-status'),
    serviceSelect: /** @type {HTMLSelectElement} */ ($('service-select')),
    reloadChannels: /** @type {HTMLButtonElement} */ ($('reload-channels')),
    channelList: $('channel-list'),
    saveButton: /** @type {HTMLButtonElement} */ ($('save-button')),
};

/** @type {PublicState | null} */
let state = null;
/** @type {Channel[] | null} */
let channels = null;
/** @type {Service[]} */
let services = [];

/** @param {PublicState['captureStatus']} status */
function renderStatus(status) {
    el.captureStatus.textContent = STATUS_LABELS[status] ?? status;
    el.captureStatus.className = `status ${status}`;
}

function renderAccount() {
    if (state == null) return;
    el.accountLoading.hidden = true;

    const user = state.misskeyUser;
    if (state.loggedIn && user != null && state.misskeyHost != null) {
        const host = new URL(state.misskeyHost).host;
        el.accountInfo.hidden = false;
        el.loginForm.hidden = true;
        el.accountAvatar.src = user.avatarUrl ?? '';
        el.accountName.textContent = user.name || user.username;
        el.accountAcct.textContent = `@${user.username}@${host}`;
    } else {
        el.accountInfo.hidden = true;
        el.loginForm.hidden = false;
        if (state.misskeyHost != null && el.loginHost.value === '') {
            el.loginHost.value = new URL(state.misskeyHost).host;
        }
    }
    el.captureSection.hidden = !state.loggedIn;
}

function renderSettings() {
    if (state == null) return;
    el.enableCapture.checked = state.enableCapture;
    renderStatus(state.captureStatus);
    renderServices();
    renderChannels();
}

function renderServices() {
    if (state == null) return;
    const selected = state.onecommeServiceId;
    el.serviceSelect.replaceChildren();

    const createOption = document.createElement('option');
    createOption.value = '';
    createOption.textContent = '（新しく「Misskey」枠を作成する）';
    el.serviceSelect.append(createOption);

    for (const service of services) {
        const option = document.createElement('option');
        option.value = service.id;
        option.textContent = service.name;
        el.serviceSelect.append(option);
    }

    el.serviceSelect.value = selected != null && services.some((s) => s.id === selected) ? selected : '';
}

function renderChannels() {
    if (state == null) return;
    el.channelList.replaceChildren();

    if (channels == null) {
        const loading = document.createElement('div');
        loading.className = 'channel-empty';
        loading.textContent = '読み込み中…';
        el.channelList.append(loading);
        return;
    }

    /** @type {Channel[]} */
    const items = [...channels];
    // 選択中のチャンネルがお気に入りから外れていても選択肢に残す
    if (state.captureChannelId != null && !items.some((c) => c.id === state?.captureChannelId)) {
        items.unshift({
            id: state.captureChannelId,
            name: state.captureChannelName ?? state.captureChannelId,
            description: 'お気に入りに登録されていないチャンネル',
            bannerUrl: null,
            color: 'transparent',
            isArchived: false,
        });
    }

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'channel-empty';
        empty.textContent = 'お気に入りに登録したチャンネルがありません。Misskeyでチャンネルをお気に入りに登録してから「再読み込み」を押してください。';
        el.channelList.append(empty);
        return;
    }

    for (const channel of items) {
        const label = document.createElement('label');
        label.className = 'channel';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'channel';
        radio.value = channel.id;
        radio.checked = channel.id === state.captureChannelId;

        const banner = document.createElement('div');
        banner.className = 'channel-banner';
        if (channel.bannerUrl != null) {
            banner.style.backgroundImage = `url("${CSS.escape(channel.bannerUrl)}")`;
        }
        banner.style.borderLeftColor = channel.color;

        const body = document.createElement('div');
        body.className = 'channel-body';
        const name = document.createElement('div');
        name.className = 'channel-name';
        name.textContent = channel.isArchived ? `${channel.name}（アーカイブ済み）` : channel.name;
        const desc = document.createElement('div');
        desc.className = 'channel-desc';
        desc.textContent = channel.description ?? '';
        body.append(name, desc);

        label.append(radio, banner, body);
        el.channelList.append(label);
    }
}

async function loadServices() {
    try {
        services = await callPluginApi('GET', { params: { action: 'services' } });
    } catch (err) {
        services = [];
        showToast(`わんコメの枠一覧を取得できませんでした: ${getErrorMessage(err)}`, 'error');
    }
    renderServices();
}

async function loadChannels() {
    channels = null;
    renderChannels();
    try {
        channels = await callPluginApi('GET', { params: { action: 'channels' } });
    } catch (err) {
        channels = [];
        showToast(`チャンネル一覧を取得できませんでした: ${getErrorMessage(err)}`, 'error');
    }
    renderChannels();
}

async function load() {
    try {
        state = await callPluginApi('GET');
    } catch (err) {
        el.accountLoading.textContent = `設定を読み込めませんでした: ${getErrorMessage(err)}`;
        return;
    }
    renderAccount();
    if (state?.loggedIn) {
        renderSettings();
        await Promise.all([loadServices(), loadChannels()]);
    }
}

/** @type {ReturnType<typeof setInterval> | undefined} */
let loginTimer;

/**
 * 別タブでのMiAuthの完了を待つ。
 * コールバックは使わず、プラグイン側がMiAuthのセッションを確認しているので、
 * ログイン状態をポーリングして完了を検知する。
 */
function waitForLogin() {
    clearInterval(loginTimer);
    loginTimer = setInterval(async () => {
        try {
            /** @type {PublicState} */
            const latest = await callPluginApi('GET');
            if (latest.loggedIn && !latest.miauthPending) {
                clearInterval(loginTimer);
                setLoginWaiting(false);
                showToast('ログインしました');
                await load();
            } else if (!latest.miauthPending) {
                // タイムアウト等でプラグイン側が確認をやめた
                clearInterval(loginTimer);
                setLoginWaiting(false);
                showToast('ログインがタイムアウトしました。もう一度お試しください', 'error');
            }
        } catch {
            // noop
        }
    }, LOGIN_POLLING_INTERVAL);
}

/** @param {boolean} waiting */
function setLoginWaiting(waiting) {
    const submit = /** @type {HTMLButtonElement | null} */ (el.loginForm.querySelector('button[type="submit"]'));
    if (submit) submit.disabled = waiting;
    el.loginWaiting.hidden = !waiting;
}

el.loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // ポップアップブロックを避けるため、ユーザー操作の直後にタブを開いておく
    const authWindow = window.open('about:blank', '_blank');
    setLoginWaiting(true);
    try {
        const { url } = await callPluginApi('POST', { body: { action: 'miauth/start', host: el.loginHost.value } });
        if (authWindow != null) {
            authWindow.location.href = url;
        } else {
            window.open(url, '_blank');
        }
        waitForLogin();
    } catch (err) {
        authWindow?.close();
        setLoginWaiting(false);
        showToast(getErrorMessage(err), 'error');
    }
});

el.loginCancel.addEventListener('click', async () => {
    clearInterval(loginTimer);
    setLoginWaiting(false);
    try {
        await callPluginApi('POST', { body: { action: 'miauth/cancel' } });
    } catch (err) {
        showToast(getErrorMessage(err), 'error');
    }
});

el.logoutButton.addEventListener('click', async () => {
    if (!confirm('ログアウトしますか？コメント連携も停止します。')) return;
    try {
        state = await callPluginApi('POST', { body: { action: 'logout' } });
        renderAccount();
        showToast('ログアウトしました');
    } catch (err) {
        showToast(getErrorMessage(err), 'error');
    }
});

el.reloadChannels.addEventListener('click', () => {
    void loadChannels();
});

el.saveButton.addEventListener('click', async () => {
    const checked = /** @type {HTMLInputElement | null} */ (el.channelList.querySelector('input[name="channel"]:checked'));
    el.saveButton.disabled = true;
    try {
        state = await callPluginApi('POST', {
            body: {
                action: 'settings',
                enableCapture: el.enableCapture.checked,
                onecommeServiceId: el.serviceSelect.value === '' ? null : el.serviceSelect.value,
                captureChannelId: checked?.value ?? null,
            },
        });
        // 枠が新しく作成されている可能性があるので一覧を更新する
        await loadServices();
        renderSettings();
        showToast('保存しました');
    } catch (err) {
        showToast(getErrorMessage(err), 'error');
        // 失敗時はサーバー側の状態に合わせる
        try {
            state = await callPluginApi('GET');
            el.enableCapture.checked = state?.enableCapture ?? false;
            if (state) renderStatus(state.captureStatus);
        } catch {
            // noop
        }
    } finally {
        el.saveButton.disabled = false;
    }
});

// 接続状態のみを定期的に更新する（編集中のフォームは上書きしない）
setInterval(async () => {
    if (state == null || !state.loggedIn || document.hidden) return;
    try {
        /** @type {PublicState} */
        const latest = await callPluginApi('GET');
        renderStatus(latest.captureStatus);
    } catch {
        // noop
    }
}, STATUS_POLLING_INTERVAL);

void load();
