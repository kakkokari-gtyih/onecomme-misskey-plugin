import { randomUUID } from 'node:crypto';
import type { entities } from 'misskey-js';
import type { PluginRequest } from '@onecomme.com/onesdk/types/Plugin';
import type { Service } from '@onecomme.com/onesdk/types/Service';
import type StoreType from 'electron-store';

import { PLUGIN_UID } from '@onecomme-misskey/shared';
import type { CaptureStatus, MisskeyUser, PluginGetActions, PluginPostActions, PublicState } from '@onecomme-misskey/shared';

import { defineOnecommePlugin } from '@/def.js';
import type { OnecommePlugin } from '@/def.js';
import { ChannelCapture, buildMiAuthUrl, checkMiAuth, createApiClient, normalizeOrigin } from '@/misskey.js';
import { noteToComment } from '@/note.js';
import { createService, getServices, sendComment } from '@/onecomme.js';

/** 設定画面（Viteでビルドした `dist/ui`） */
const SETTINGS_PAGE_URL = `http://localhost:11180/plugins/${PLUGIN_UID}/ui/index.html`;
const MIAUTH_APP_NAME = 'わんコメ Misskey連携';
const DEFAULT_SERVICE_NAME = 'Misskey';
/** MiAuthの認可を確認する間隔と、諦めるまでの時間 */
const MIAUTH_CHECK_INTERVAL = 2000;
const MIAUTH_TIMEOUT = 10 * 60 * 1000;

const defaultState = {
    misskeyHost: null as string | null,
    misskeyToken: null as string | null,
    misskeyUser: null as MisskeyUser | null,
    enableCapture: false,
    captureChannelId: null as string | null,
    captureChannelName: null as string | null,
    /** コメントを流す わんコメの枠のID */
    onecommeServiceId: null as string | null,
    //#region 表示設定・defaults は浅くマージされるため、設定はフラットなキーで持つこと
    showRoleBadges: false,
    //#endregion
};

type State = typeof defaultState;

type GetHandlers = {
    [K in keyof PluginGetActions]: (params: PluginRequest['params']) => Promise<PluginGetActions[K]['response']>;
};

/** POSTのbodyはプラグイン側で検証するため、ハンドラーには未検証の値を渡す */
type PostHandlers = {
    [K in keyof PluginPostActions]: (body: Record<string, unknown>) => Promise<PluginPostActions[K]['response']>;
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
    /** 現在の接続先（設定が変わったときだけ張り直すため） */
    let captureKey: string | null = null;
    /** わんコメの枠ごとの「接続」スイッチの状態 */
    const serviceEnabled = new Map<string, boolean>();
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
            captureStatus: getCaptureStatus(),
            display: {
                showRoleBadges: s.get('showRoleBadges'),
            },
        };
    }

    function getCaptureStatus(): CaptureStatus {
        if (!getStore().get('enableCapture')) return 'disabled';
        if (!isTargetServiceEnabled()) return 'serviceDisconnected';
        return capture?.status ?? 'disabled';
    }

    /** コメントを流す枠の「接続」がオンになっているか */
    function isTargetServiceEnabled(): boolean {
        const serviceId = getStore().get('onecommeServiceId');
        return serviceId != null && serviceEnabled.get(serviceId) === true;
    }

    function updateServices(services: Service[]) {
        serviceEnabled.clear();
        for (const service of services) {
            serviceEnabled.set(service.id, service.enabled);
        }
    }

    /** 保存されている枠が存在しなければ、新しく「Misskey」枠を作成する */
    async function ensureService(): Promise<string> {
        const s = getStore();
        const serviceId = s.get('onecommeServiceId');
        const services = await getServices();
        updateServices(services);
        if (serviceId != null && services.some((service) => service.id === serviceId)) {
            return serviceId;
        }
        const created = await createService(DEFAULT_SERVICE_NAME);
        serviceEnabled.set(created.id, created.enabled);
        s.set('onecommeServiceId', created.id);
        console.info(`[onecomme] created service "${created.name}" (${created.id})`);
        return created.id;
    }

    async function handleNote(note: entities.Note, source: ChannelCapture) {
        const s = getStore();
        const serviceId = s.get('onecommeServiceId');
        // 切断処理と行き違いで届いたノートは捨てる
        if (serviceId == null || !isTargetServiceEnabled()) return;

        const body = noteToComment(note, {
            serviceId,
            myUserId: s.get('misskeyUser')?.id ?? null,
            resolveEmoji: (name, host, remoteEmojis) => source.resolveEmoji(name, host, remoteEmojis),
            showRoleBadges: s.get('showRoleBadges'),
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

    /**
     * 現在の設定に合わせてストリーミング接続を張る・切る。
     * わんコメ側で枠の「接続」がオフの間は、Misskeyへの接続自体を切っておく。
     */
    function applyCapture() {
        const s = getStore();
        const origin = s.get('misskeyHost');
        const token = s.get('misskeyToken');
        const channelId = s.get('captureChannelId');
        const shouldConnect = s.get('enableCapture') && isTargetServiceEnabled()
            && origin != null && token != null && channelId != null;
        const key = shouldConnect ? JSON.stringify([origin, token, channelId]) : null;

        // 接続先が変わっていなければ張り直さない
        if (key === captureKey) return;

        capture?.stop();
        capture = null;
        captureKey = key;
        if (!shouldConnect) return;

        const newCapture: ChannelCapture = new ChannelCapture({
            origin,
            token,
            channelId,
            onNote: (note) => handleNote(note, newCapture),
        });
        newCapture.start();
        capture = newCapture;
    }

    function getCredential(): { origin: string; token: string } {
        const s = getStore();
        const origin = s.get('misskeyHost');
        const token = s.get('misskeyToken');
        if (origin == null || token == null) throw new HttpError(401, 'Misskeyにログインしていません');
        return { origin, token };
    }

    const getHandlers: GetHandlers = {
        state: async () => getPublicState(),

        channels: async () => {
            const { origin, token } = getCredential();
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
        },

        services: async () => {
            const services = await getServices();
            return services.map((service) => ({ id: service.id, name: service.name }));
        },
    };

    const postHandlers: PostHandlers = {
        'miauth/start': async (body) => {
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
        },

        'miauth/cancel': async () => {
            cancelMiAuth();
            return getPublicState();
        },

        logout: async () => {
            const s = getStore();
            s.set('misskeyToken', null);
            s.set('misskeyUser', null);
            s.set('enableCapture', false);
            applyCapture();
            return getPublicState();
        },

        settings: async (body) => {
            const s = getStore();
            const { origin, token } = getCredential();

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
        },

        display: async (body) => {
            const s = getStore();
            if ('showRoleBadges' in body) {
                if (typeof body['showRoleBadges'] !== 'boolean') throw new HttpError(400, 'showRoleBadges の指定が正しくありません');
                s.set('showRoleBadges', body['showRoleBadges']);
            }
            return getPublicState();
        },
    };

    function isHandlerKey<T extends object>(handlers: T, key: unknown): key is keyof T {
        return typeof key === 'string' && Object.hasOwn(handlers, key);
    }

    async function handleGet(req: PluginRequest): Promise<unknown> {
        getStore();
        const action = req.params['action'] ?? 'state';
        if (!isHandlerKey(getHandlers, action)) throw new HttpError(404, '不明な操作です');
        return getHandlers[action](req.params);
    }

    async function handlePost(req: PluginRequest): Promise<unknown> {
        getStore();
        const body = parseBody(req.body);
        const action = body['action'];
        if (!isHandlerKey(postHandlers, action)) throw new HttpError(404, '不明な操作です');
        return postHandlers[action](body);
    }

    const plugin: OnecommePlugin<State> = {
        //#region Meta
        name: 'Misskey連携プラグイン',
        uid: PLUGIN_UID,
        version: _VERSION_,
        author: 'kakkokari-gtyih',
        url: SETTINGS_PAGE_URL,
        permissions: ['services'],
        defaultState,
        //#endregion

        init: (api, initialData) => {
            store = api.store;
            updateServices(initialData.services ?? []);
            applyCapture();
        },

        subscribe: (type, ...args) => {
            if (type !== 'services' || store == null) return;
            updateServices(args[0] as Service[]);
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
            captureKey = null;
        },
    };

    return plugin;
});
