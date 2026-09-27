import { randomUUID } from 'node:crypto';
import type { entities } from 'misskey-js';
import type { PluginRequest } from '@onecomme.com/onesdk/types/Plugin';
import type { Service, ServiceMeta } from '@onecomme.com/onesdk/types/Service';
import type StoreType from 'electron-store';

import { DISPLAY_SETTING_KEYS, PLUGIN_UID } from '@onecomme-misskey/shared';
import type { ChannelLink, DisplaySettings, MisskeyUser, PluginGetActions, PluginPostActions, PublicState } from '@onecomme-misskey/shared';

import { defineOnecommePlugin } from '@/def.js';
import type { OnecommePlugin } from '@/def.js';
import { MisskeyStream, buildMiAuthUrl, checkMiAuth, createApiClient, normalizeOrigin, parseChannelUrl } from '@/misskey.js';
import { noteToComment } from '@/note.js';
import { getServices, sendComment, updateServiceMeta } from '@/onecomme.js';

/** 設定画面（Viteでビルドした `dist/ui`） */
const SETTINGS_PAGE_URL = `http://localhost:11180/plugins/${PLUGIN_UID}/ui/index.html`;
const MIAUTH_APP_NAME = 'わんコメ Misskey連携';
/** MiAuthの認可を確認する間隔と、諦めるまでの時間 */
const MIAUTH_CHECK_INTERVAL = 2000;
const MIAUTH_TIMEOUT = 10 * 60 * 1000;
/**
 * 枠の一覧を確認する間隔。
 * 枠の削除はプラグインに通知されないため、定期的に取得して追従する
 */
const SERVICES_POLL_INTERVAL = 10 * 1000;

const defaultState = {
    misskeyHost: null as string | null,
    misskeyToken: null as string | null,
    misskeyUser: null as MisskeyUser | null,
    //#region 表示設定・defaults は浅くマージされるため、設定はフラットなキーで持つこと
    showRoleBadges: false,
    includeReplies: false,
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

/** 視聴URLにチャンネルのURLが設定されている枠 */
type ResolvedLink = {
    service: Service;
    channelId: string;
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

/** 連携の判定に使う項目だけを比較する */
function servicesSignature(services: Service[]): string {
    return JSON.stringify(services.map((s) => [s.id, s.name, s.url, s.enabled]));
}

export default defineOnecommePlugin(() => {
    let store: StoreType<State> | null = null;
    /** わんコメの枠の一覧 */
    let services: Service[] = [];
    let servicesPollTimer: ReturnType<typeof setInterval> | null = null;

    /** Misskeyのストリーミング接続（連携中のチャンネルが1つもなければ null） */
    let stream: MisskeyStream | null = null;
    /** 現在の接続先（サーバーかトークンが変わったときだけ張り直すため） */
    let streamKey: string | null = null;

    /** チャンネルID → チャンネル名 */
    const channelNames = new Map<string, string>();
    let channelNamesOrigin: string | null = null;
    const channelNamesFetching = new Set<string>();
    /** 枠ID → 最後に反映した配信情報（同じ内容で何度も更新しないため） */
    const appliedMeta = new Map<string, string>();

    /** 進行中のMiAuthセッション */
    let pendingMiAuth: { origin: string; session: string; timer: ReturnType<typeof setInterval> } | null = null;

    function getStore(): StoreType<State> {
        if (store == null) throw new HttpError(503, 'プラグインが初期化されていません');
        return store;
    }

    function getCredential(): { origin: string; token: string } | null {
        const s = getStore();
        const origin = s.get('misskeyHost');
        const token = s.get('misskeyToken');
        return origin != null && token != null ? { origin, token } : null;
    }

    /** 視聴URLにログイン中のサーバーのチャンネルのURLが設定されている枠 */
    function getLinks(): ResolvedLink[] {
        const credential = getCredential();
        if (credential == null) return [];
        return services.flatMap((service) => {
            const channelId = parseChannelUrl(service.url ?? '', credential.origin);
            return channelId != null ? [{ service, channelId }] : [];
        });
    }

    function getPublicState(): PublicState {
        const s = getStore();
        return {
            loggedIn: getCredential() != null,
            miauthPending: pendingMiAuth != null,
            misskeyHost: s.get('misskeyHost'),
            misskeyUser: s.get('misskeyUser'),
            links: getLinks().map(({ service, channelId }): ChannelLink => ({
                serviceId: service.id,
                serviceName: service.name,
                channelId,
                channelName: channelNames.get(channelId) ?? null,
                status: service.enabled ? (stream?.status ?? 'connecting') : 'off',
            })),
            display: {
                showRoleBadges: s.get('showRoleBadges'),
                includeReplies: s.get('includeReplies'),
            } satisfies DisplaySettings,
        };
    }

    function updateServices(next: Service[]) {
        services = next;
        sync();
    }

    /**
     * 枠の状態に合わせて、チャンネルの購読とストリーミング接続を張る・切る。
     * - 「接続」がオンの枠のチャンネルだけを購読する
     * - 購読するチャンネルが1つもなくなったら、ストリーミング接続自体を切る
     */
    function sync() {
        if (store == null) return;
        const credential = getCredential();
        const links = getLinks();
        const channelIds = new Set(links.filter((link) => link.service.enabled).map((link) => link.channelId));

        const key = credential != null && channelIds.size > 0 ? JSON.stringify([credential.origin, credential.token]) : null;
        if (key !== streamKey) {
            stream?.stop();
            stream = null;
            streamKey = key;
            appliedMeta.clear();
            if (credential != null && key != null) {
                const newStream: MisskeyStream = new MisskeyStream({
                    origin: credential.origin,
                    token: credential.token,
                    onNote: (note, channelId) => handleNote(note, channelId, newStream),
                    onStatusChange: () => syncServiceMeta(),
                });
                newStream.start();
                stream = newStream;
            }
        }
        stream?.setChannels(channelIds);

        fetchChannelNames(links);
        syncServiceMeta();
    }

    /** 表示用にチャンネル名を取得する（チャンネルの情報は認証なしで取得できる） */
    function fetchChannelNames(links: ResolvedLink[]) {
        const origin = getCredential()?.origin ?? null;
        if (origin !== channelNamesOrigin) {
            channelNames.clear();
            channelNamesOrigin = origin;
        }
        if (origin == null) return;

        for (const { channelId } of links) {
            if (channelNames.has(channelId) || channelNamesFetching.has(channelId)) continue;
            channelNamesFetching.add(channelId);
            createApiClient(origin, null).request('channels/show', { channelId })
                .then((channel) => {
                    if (channelNamesOrigin !== origin) return;
                    channelNames.set(channelId, channel.name);
                    syncServiceMeta();
                })
                .catch((err) => {
                    console.error(`[misskey] failed to fetch channel ${channelId}`, err);
                })
                .finally(() => {
                    channelNamesFetching.delete(channelId);
                });
        }
    }

    /** 連携中の枠の配信情報（タイトル・接続中の表示）を、チャンネルとストリーミングの状態に合わせる */
    function syncServiceMeta() {
        if (stream == null) return;
        const status = stream.status;
        const activeIds = new Set<string>();

        for (const { service, channelId } of getLinks()) {
            if (!service.enabled) continue;
            activeIds.add(service.id);

            const meta: ServiceMeta = {
                isConnecting: status === 'connecting',
                isReconnecting: status === 'reconnecting',
            };
            const channelName = channelNames.get(channelId);
            if (channelName != null) meta.title = channelName;

            const signature = JSON.stringify(meta);
            if (appliedMeta.get(service.id) === signature) continue;
            appliedMeta.set(service.id, signature);
            updateServiceMeta(service.id, meta).catch((err) => {
                appliedMeta.delete(service.id);
                console.error(`[onecomme] failed to update meta of ${service.id}`, err);
            });
        }

        // 接続がオフになった枠は、再びオンになったときに改めて反映する
        for (const serviceId of appliedMeta.keys()) {
            if (!activeIds.has(serviceId)) appliedMeta.delete(serviceId);
        }
    }

    async function pollServices() {
        try {
            const latest = await getServices();
            if (servicesSignature(latest) !== servicesSignature(services)) {
                updateServices(latest);
            }
        } catch {
            // わんコメの起動直後などは失敗することがある。次回の確認で再試行する
        }
    }

    async function handleNote(note: entities.Note, channelId: string, source: MisskeyStream) {
        const s = getStore();
        if (note.replyId != null && !s.get('includeReplies')) return;

        // 「接続」がオンの、このチャンネルを設定している枠すべてに追加する
        // （切断処理と行き違いで届いたノートは、対象の枠がないので捨てられる）
        const targets = getLinks().filter((link) => link.service.enabled && link.channelId === channelId);
        for (const { service } of targets) {
            const body = noteToComment(note, {
                serviceId: service.id,
                myUserId: s.get('misskeyUser')?.id ?? null,
                resolveEmoji: (name, host, remoteEmojis) => source.resolveEmoji(name, host, remoteEmojis),
                showRoleBadges: s.get('showRoleBadges'),
            });
            if (body == null) return;
            await sendComment(body);
        }
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
        s.set('misskeyHost', origin);
        s.set('misskeyToken', token);
        s.set('misskeyUser', {
            id: user.id,
            username: user.username,
            name: user.name,
            avatarUrl: user.avatarUrl,
        });
        sync();
    }

    const getHandlers: GetHandlers = {
        state: async () => getPublicState(),
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
            sync();
            return getPublicState();
        },

        display: async (body) => {
            const s = getStore();
            // 先にすべて検証してから保存する
            const updates: Partial<DisplaySettings> = {};
            for (const key of DISPLAY_SETTING_KEYS) {
                if (!(key in body)) continue;
                const value = body[key];
                if (typeof value !== 'boolean') throw new HttpError(400, `${key} の指定が正しくありません`);
                updates[key] = value;
            }
            for (const [key, value] of Object.entries(updates) as [keyof DisplaySettings, boolean][]) {
                s.set(key, value);
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
        // 枠の視聴URL・「接続」スイッチの状態を受け取るため
        permissions: ['services'],
        defaultState,
        //#endregion

        init: (api, initialData) => {
            store = api.store;
            updateServices(initialData.services ?? []);
            servicesPollTimer = setInterval(pollServices, SERVICES_POLL_INTERVAL);
        },

        subscribe: (type, ...args) => {
            if (type !== 'services' || store == null) return;
            updateServices(args[0] as Service[]);
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
            if (servicesPollTimer != null) {
                clearInterval(servicesPollTimer);
                servicesPollTimer = null;
            }
            stream?.stop();
            stream = null;
            streamKey = null;
            appliedMeta.clear();
        },
    };

    return plugin;
});
