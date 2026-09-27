import type { Service, ServiceMeta } from '@onecomme.com/onesdk/types/Service';
import type { SystemCommentOptions, SystemMessage } from '@onecomme.com/onesdk/types/System';

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

/** 枠の配信情報（タイトルや接続中の表示など）を更新する。既存の値にマージされる */
export async function updateServiceMeta(serviceId: string, meta: ServiceMeta): Promise<void> {
    await request(`/services/${encodeURIComponent(serviceId)}/meta`, { method: 'PUT', body: { type: 'external', meta } });
}

export async function sendComment(body: SendCommentRequest): Promise<void> {
    await request('/comments', { method: 'POST', body });
}

export async function sendSystemComment(serviceId: string, data: SystemMessage, options: Omit<SystemCommentOptions, 'type'> = {}): Promise<void> {
    await request('/comments/system', { method: 'POST', body: { serviceId, data, options } });
}
