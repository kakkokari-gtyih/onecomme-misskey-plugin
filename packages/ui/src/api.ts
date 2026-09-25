import { PLUGIN_UID } from '@onecomme-misskey/shared';
import type { PluginApiEnvelope, PluginErrorResponse, PluginGetActions, PluginPostActions } from '@onecomme-misskey/shared';

/** 同一オリジン（わんコメ、または開発時の Vite のプロキシ）のプラグインAPI */
const API_PATH = `/api/plugins/${PLUGIN_UID}`;

function isEnvelope(value: unknown): value is PluginApiEnvelope<unknown> {
    return value != null && typeof value === 'object' && 'code' in value && 'response' in value;
}

function isErrorResponse(value: unknown): value is PluginErrorResponse {
    return value != null && typeof value === 'object' && 'error' in value && typeof value.error === 'string';
}

async function request<T>(method: 'GET' | 'POST', opts: { params?: Record<string, string>; body?: unknown }): Promise<T> {
    const url = new URL(API_PATH, location.origin);
    for (const [key, value] of Object.entries(opts.params ?? {})) {
        url.searchParams.set(key, value);
    }

    const res = await fetch(url, {
        method,
        headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
    });

    let json: unknown = null;
    try {
        json = await res.json();
    } catch {
        // noop
    }

    // わんコメはプラグインの戻り値 { code, response } をそのまま返す（HTTPステータスは常に200）
    if (isEnvelope(json)) {
        if (json.code >= 400 || isErrorResponse(json.response)) {
            throw new Error(isErrorResponse(json.response) ? json.response.error : `リクエストに失敗しました (${json.code})`);
        }
        return json.response as T;
    }

    // プラグインが無効な場合など、わんコメ本体がエラーを返したとき
    const message = json != null && typeof json === 'object' && 'message' in json && typeof json.message === 'string' ? json.message : null;
    throw new Error(message ?? `リクエストに失敗しました (${res.status})`);
}

export function getApi<K extends keyof PluginGetActions>(action: K): Promise<PluginGetActions[K]['response']> {
    return request('GET', { params: { action } });
}

export function postApi<K extends keyof PluginPostActions>(action: K, body: PluginPostActions[K]['body']): Promise<PluginPostActions[K]['response']> {
    return request('POST', { body: { ...body, action } });
}

export function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
