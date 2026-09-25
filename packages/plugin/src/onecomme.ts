import { randomUUID } from 'node:crypto';
import type { Service } from '@onecomme.com/onesdk/types/Service';

import type { SendCommentRequest } from '@/types/onecomme.js';

const ONECOMME_API_BASE = 'http://127.0.0.1:11180/api';

/** レスポンスが `{ status, data }` で包まれている場合とそうでない場合の両方に対応する */
function unwrap<T>(res: unknown): T {
    if (res != null && typeof res === 'object' && 'data' in res && 'status' in res) {
        return (res as { data: T }).data;
    }
    return res as T;
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${ONECOMME_API_BASE}${path}`, {
        method: init?.method ?? 'GET',
        headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: init?.body !== undefined ? JSON.stringify(init.body) : null,
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`わんコメのAPI呼び出しに失敗しました: ${init?.method ?? 'GET'} ${path} (${res.status} ${res.statusText}) ${text}`);
    }
    return unwrap<T>(text.length > 0 ? JSON.parse(text) : null);
}

export async function getServices(): Promise<Service[]> {
    const services = await request<Service[] | null>('/services');
    return Array.isArray(services) ? services : [];
}

export async function createService(name: string): Promise<Service> {
    // `POST /api/services` は `id` が必須（指定したIDでそのまま枠が作成される）
    // 連携を有効にした操作で作成されるため、「接続」はオンの状態で作成する
    const id = randomUUID();
    const created = await request<Service | null>('/services', { method: 'POST', body: { id, name, enabled: true } });
    if (created == null || created.id !== id) {
        throw new Error('わんコメの枠を作成できませんでした');
    }
    return created;
}

export async function sendComment(body: SendCommentRequest): Promise<void> {
    await request('/comments', { method: 'POST', body });
}
