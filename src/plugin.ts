import { randomUUID } from 'node:crypto';
import type { entities } from 'misskey-js';
import type { PluginRequest } from '@onecomme.com/onesdk/types/Plugin';
import type StoreType from 'electron-store';

import { defineOnecommePlugin } from '@/utils/def.js';
import type { OnecommePlugin } from '@/utils/def.js';
import { ChannelCapture, buildMiAuthUrl, checkMiAuth, createApiClient, normalizeOrigin } from '@/utils/misskey.js';
import type { CaptureStatus } from '@/utils/misskey.js';
import { noteToComment } from '@/utils/note.js';
import { createService, getServices, sendComment } from '@/utils/onecomme.js';

const PLUGIN_UID = 'net.misskey-hub.onecomme';
const SETTINGS_PAGE_URL = `http://localhost:11180/plugins/${PLUGIN_UID}/assets/index.html`;
const MIAUTH_APP_NAME = 'わんコメ Misskey連携';
const DEFAULT_SERVICE_NAME = 'Misskey';
/** MiAuthの認可を確認する間隔と、諦めるまでの時間 */
const MIAUTH_CHECK_INTERVAL = 2000;
const MIAUTH_TIMEOUT = 10 * 60 * 1000;

type MisskeyUser = {
    id: string;
    username: string;
    name: string | null;
    avatarUrl: string | null;
};

const defaultState = {
    misskeyHost: null as string | null,
    misskeyToken: null as string | null,
    misskeyUser: null as MisskeyUser | null,
    enableCapture: false,
    captureChannelId: null as string | null,
    captureChannelName: null as string | null,
    /** コメントを流す わんコメの枠のID */
    onecommeServiceId: null as string | null,
};

type State = typeof defaultState;

/** 設定画面に返す状態 */
type PublicState = {
    loggedIn: boolean;
    /** MiAuthの認可待ち */
    miauthPending: boolean;
    misskeyHost: string | null;
    misskeyUser: MisskeyUser | null;
    enableCapture: boolean;
    captureChannelId: string | null;
    captureChannelName: string | null;
    onecommeServiceId: string | null;
    captureStatus: CaptureStatus | 'disabled';
};

class HttpError extends Error {
    constructor(public code: number, message: string) {
        super(message);
    }
}

function parseBody(body: unknown): Record<string, unknown> {
    if (body == null || body === '') return {};
    if (typeof body === 'string') {
        const parsed: unknown = JSON.parse(body);
        return parsed != null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    }
    return typeof body === 'object' ? body as Record<string, unknown> : {};
}

function getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    // misskey-js の APIError は Error のインスタンスではない
    if (err != null && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
    return String(err);
}

function getString(body: Record<string, unknown>, key: string): string {
    const value = body[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new HttpError(400, `${key} を指定してください`);
    }
    return value.trim();
}

export default defineOnecommePlugin(() => {
    let store: StoreType<State> | null = null;
    let capture: ChannelCapture | null = null;
    /** 進行中のMiAuthセッション */
    let pendingMiAuth: { origin: string; session: string; timer: ReturnType<typeof setInterval> } | null = null;

    function getStore(): StoreType<State> {
        if (store == null) throw new HttpError(503, 'プラグインが初期化されていません');
        return store;
    }

    function getPublicState(): PublicState {
        const s = getStore();
        return {
            loggedIn: s.get('misskeyHost') != null && s.get('misskeyToken') != null,
            miauthPending: pendingMiAuth != null,
            misskeyHost: s.get('misskeyHost'),
            misskeyUser: s.get('misskeyUser'),
            enableCapture: s.get('enableCapture'),
            captureChannelId: s.get('captureChannelId'),
            captureChannelName: s.get('captureChannelName'),
            onecommeServiceId: s.get('onecommeServiceId'),
            captureStatus: capture?.status ?? 'disabled',
        };
    }

    /** 保存されている枠が存在しなければ、新しく「Misskey」枠を作成する */
    async function ensureService(): Promise<string> {
        const s = getStore();
        const serviceId = s.get('onecommeServiceId');
        const services = await getServices();
        if (serviceId != null && services.some((service) => service.id === serviceId)) {
            return serviceId;
        }
        const created = await createService(DEFAULT_SERVICE_NAME);
        s.set('onecommeServiceId', created.id);
        console.info(`[onecomme] created service "${created.name}" (${created.id})`);
        return created.id;
    }

    async function handleNote(note: entities.Note, source: ChannelCapture) {
        const s = getStore();
        const serviceId = s.get('onecommeServiceId') ?? await ensureService();

        const body = noteToComment(note, {
            serviceId,
            myUserId: s.get('misskeyUser')?.id ?? null,
            resolveEmoji: (name, host, remoteEmojis) => source.resolveEmoji(name, host, remoteEmojis),
        });
        if (body == null) return;

        await sendComment(body);
    }

    function cancelMiAuth() {
        if (pendingMiAuth == null) return;
        clearInterval(pendingMiAuth.timer);
        pendingMiAuth = null;
    }

    /**
     * MiAuthを開始し、認可されるまでプラグイン側でセッションを確認し続ける。
     * （コールバックを使わないため、設定画面はログイン状態のポーリングで完了を検知する）
     */
    function startMiAuth(origin: string): string {
        cancelMiAuth();

        const session = randomUUID();
        const startedAt = Date.now();
        let checking = false;

        const timer = setInterval(async () => {
            if (pendingMiAuth?.session !== session || checking) return;
            if (Date.now() - startedAt > MIAUTH_TIMEOUT) {
                console.info('[misskey] MiAuth timed out');
                cancelMiAuth();
                return;
            }

            checking = true;
            try {
                const result = await checkMiAuth(origin, session);
                // 確認中に別のログインが開始・キャンセルされた場合は無視する
                if (result == null || pendingMiAuth?.session !== session) return;
                cancelMiAuth();
                saveLogin(origin, result.token, result.user);
                console.info(`[misskey] logged in as @${result.user.username} (${origin})`);
            } catch (err) {
                // 一時的なネットワークエラー等は次回の確認で再試行する
                console.error('[misskey] MiAuth check failed', err);
            } finally {
                checking = false;
            }
        }, MIAUTH_CHECK_INTERVAL);

        pendingMiAuth = { origin, session, timer };
        return session;
    }

    function saveLogin(origin: string, token: string, user: entities.UserDetailedNotMe) {
        const s = getStore();
        const prevOrigin = s.get('misskeyHost');
        s.set('misskeyHost', origin);
        s.set('misskeyToken', token);
        s.set('misskeyUser', {
            id: user.id,
            username: user.username,
            name: user.name,
            avatarUrl: user.avatarUrl,
        });
        if (prevOrigin !== origin) {
            // 別サーバーに切り替えた場合、チャンネルの選択は引き継げない
            s.set('enableCapture', false);
            s.set('captureChannelId', null);
            s.set('captureChannelName', null);
        }
        applyCapture();
    }

    /** 現在の設定に合わせてストリーミング接続を張り直す */
    function applyCapture() {
        capture?.stop();
        capture = null;

        const s = getStore();
        const origin = s.get('misskeyHost');
        const token = s.get('misskeyToken');
        const channelId = s.get('captureChannelId');
        if (!s.get('enableCapture') || origin == null || token == null || channelId == null) return;

        const newCapture: ChannelCapture = new ChannelCapture({
            origin,
            token,
            channelId,
            onNote: (note) => handleNote(note, newCapture),
        });
        newCapture.start();
        capture = newCapture;
    }

    async function handleGet(req: PluginRequest): Promise<unknown> {
        const s = getStore();
        switch (req.params['action']) {
            case undefined:
            case 'state': {
                return getPublicState();
            }

            case 'channels': {
                const origin = s.get('misskeyHost');
                const token = s.get('misskeyToken');
                if (origin == null || token == null) throw new HttpError(401, 'Misskeyにログインしていません');
                const channels = await createApiClient(origin, token).request('channels/my-favorites', {});
                return channels.map((channel) => ({
                    id: channel.id,
                    name: channel.name,
                    description: channel.description,
                    bannerUrl: channel.bannerUrl,
                    color: channel.color,
                    isArchived: channel.isArchived,
                    notesCount: channel.notesCount,
                    usersCount: channel.usersCount,
                }));
            }

            case 'services': {
                const services = await getServices();
                return services.map((service) => ({ id: service.id, name: service.name }));
            }


            default: {
                throw new HttpError(404, '不明な操作です');
            }
        }
    }

    async function handlePost(req: PluginRequest): Promise<unknown> {
        const s = getStore();
        const body = parseBody(req.body);

        switch (body['action']) {
            case 'miauth/start': {
                let origin: string;
                try {
                    origin = normalizeOrigin(getString(body, 'host'));
                } catch (err) {
                    if (err instanceof HttpError) throw err;
                    throw new HttpError(400, 'サーバーのURLが正しくありません');
                }
                const session = startMiAuth(origin);
                return {
                    url: buildMiAuthUrl({
                        origin,
                        session,
                        appName: MIAUTH_APP_NAME,
                    }),
                };
            }

            case 'miauth/cancel': {
                cancelMiAuth();
                return getPublicState();
            }

            case 'logout': {
                s.set('misskeyToken', null);
                s.set('misskeyUser', null);
                s.set('enableCapture', false);
                applyCapture();
                return getPublicState();
            }

            case 'settings': {
                const origin = s.get('misskeyHost');
                const token = s.get('misskeyToken');
                if (origin == null || token == null) throw new HttpError(401, 'Misskeyにログインしていません');

                if ('onecommeServiceId' in body) {
                    const serviceId = body['onecommeServiceId'];
                    if (serviceId !== null && typeof serviceId !== 'string') throw new HttpError(400, '枠の指定が正しくありません');
                    s.set('onecommeServiceId', serviceId);
                }

                if ('captureChannelId' in body) {
                    const channelId = body['captureChannelId'];
                    if (channelId === null) {
                        s.set('captureChannelId', null);
                        s.set('captureChannelName', null);
                    } else if (typeof channelId === 'string') {
                        const channel = await createApiClient(origin, token).request('channels/show', { channelId });
                        s.set('captureChannelId', channel.id);
                        s.set('captureChannelName', channel.name);
                    } else {
                        throw new HttpError(400, 'チャンネルの指定が正しくありません');
                    }
                }

                if ('enableCapture' in body) {
                    s.set('enableCapture', body['enableCapture'] === true);
                }

                if (s.get('enableCapture')) {
                    if (s.get('captureChannelId') == null) {
                        s.set('enableCapture', false);
                        throw new HttpError(400, 'コメント一覧に流すチャンネルを選択してください');
                    }
                    await ensureService();
                }

                applyCapture();
                return getPublicState();
            }

            default: {
                throw new HttpError(404, '不明な操作です');
            }
        }
    }

    const plugin: OnecommePlugin<State> = {
        //#region Meta
        name: 'Misskey連携プラグイン',
        uid: PLUGIN_UID,
        version: _VERSION_,
        author: 'kakkokari-gtyih',
        url: SETTINGS_PAGE_URL,
        permissions: [],
        defaultState,
        //#endregion

        init: (api) => {
            store = api.store;
            applyCapture();
        },

        request: async (req) => {
            try {
                switch (req.method) {
                    case 'GET': {
                        return { code: 200, response: await handleGet(req) };
                    }
                    case 'POST': {
                        return { code: 200, response: await handlePost(req) };
                    }
                    default: {
                        throw new HttpError(405, '許可されていないメソッドです');
                    }
                }
            } catch (err) {
                if (err instanceof HttpError) {
                    return { code: err.code, response: { error: err.message } };
                }
                console.error('[plugin] request failed', err);
                return { code: 500, response: { error: getErrorMessage(err) } };
            }
        },

        destroy: () => {
            cancelMiAuth();
            capture?.stop();
            capture = null;
        },
    };

    return plugin;
});
