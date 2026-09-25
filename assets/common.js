// @ts-check
'use strict';

const PLUGIN_UID = 'net.misskey-hub.onecomme';

/**
 * プラグインのAPI（http://localhost:11180/api/plugins/{uid}）を呼び出す
 * @param {'GET' | 'POST'} method
 * @param {{ params?: Record<string, string>; body?: unknown }} [opts]
 */
async function callPluginApi(method, opts = {}) {
    const url = new URL(`/api/plugins/${PLUGIN_UID}`, location.origin);
    for (const [key, value] of Object.entries(opts.params ?? {})) {
        url.searchParams.set(key, value);
    }

    const res = await fetch(url, {
        method,
        headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    let json = null;
    try {
        json = await res.json();
    } catch {
        // noop
    }

    // わんコメはプラグインの戻り値 { code, response } をそのまま返す
    const payload = json != null && typeof json === 'object' && 'response' in json ? json.response : json;
    const failed = !res.ok
        || (json != null && typeof json.code === 'number' && json.code >= 400)
        || (payload != null && typeof payload === 'object' && 'error' in payload);
    if (failed) {
        throw new Error(payload?.error ?? `リクエストに失敗しました (${res.status})`);
    }
    return payload;
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/**
 * @param {string} message
 * @param {'info' | 'error'} [type]
 */
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast == null) return;
    toast.textContent = message;
    toast.classList.toggle('error', type === 'error');
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 4000);
}

/** @param {unknown} err */
function getErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
