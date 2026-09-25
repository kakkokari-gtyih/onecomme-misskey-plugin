import { Stream, api } from 'misskey-js';
import type { entities, IChannelConnection, Channels } from 'misskey-js';
import WebSocket from 'ws';

/**
 * MiAuthで要求する権限
 * - read:account: ストリーミングへの接続に必要
 * - read:channels: お気に入りチャンネル一覧の取得に必要
 */
export const MIAUTH_PERMISSIONS = ['read:account', 'read:channels'] as const;

/** ユーザー入力（`misskey.io` や `https://misskey.io/` など）からoriginを得る */
export function normalizeOrigin(input: string): string {
    let value = input.trim();
    if (!/^https?:\/\//i.test(value)) {
        value = `https://${value}`;
    }
    const url = new URL(value);
    return url.origin;
}

/**
 * MiAuthの認可画面のURLを作る。
 * コールバックは指定しない（認可後、Misskeyの画面上でアプリに戻るよう案内される）。
 */
export function buildMiAuthUrl(opts: {
    origin: string;
    session: string;
    appName: string;
}): string {
    const url = new URL(`/miauth/${opts.session}`, opts.origin);
    url.searchParams.set('name', opts.appName);
    url.searchParams.set('permission', MIAUTH_PERMISSIONS.join(','));
    return url.toString();
}

/**
 * MiAuthのセッションを確認する。まだ認可されていない場合は null を返す。
 * 成功するのは認可後の最初の1回のみ（2回目以降は `ok: false` になる）。
 */
export async function checkMiAuth(origin: string, session: string): Promise<{ token: string; user: entities.UserDetailedNotMe } | null> {
    const res = await fetch(`${origin}/api/miauth/${encodeURIComponent(session)}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (!res.ok) {
        throw new Error(`ログインの確認に失敗しました (${res.status} ${res.statusText})`);
    }
    const json = await res.json() as { ok: boolean; token?: string; user?: entities.UserDetailedNotMe };
    if (!json.ok || json.token == null || json.user == null) {
        return null;
    }
    return { token: json.token, user: json.user };
}

export function createApiClient(origin: string, token: string | null) {
    return new api.APIClient({ origin, credential: token });
}

export type CaptureStatus = 'connecting' | 'connected' | 'reconnecting';

/** `/emoji/` ルートが受け付ける名前（Misskey backend の ServerService を参照） */
const EMOJI_ROUTE_SAFE = /^[a-zA-Z0-9\-_.]+$/;
const EMOJI_LIST_REFRESH_INTERVAL = 60 * 1000;
const HEARTBEAT_INTERVAL = 60 * 1000;

/**
 * 指定したチャンネルの新規ノートをストリーミングで受け取る
 */
export class ChannelCapture {
    private readonly origin: string;
    private readonly token: string;
    private readonly channelId: string;
    private readonly onNote: (note: entities.Note) => Promise<void>;

    private stream: Stream | null = null;
    private connection: IChannelConnection<Channels['channel']> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    /** ノートを受信順に処理するためのキュー */
    private queue: Promise<void> = Promise.resolve();

    /** ローカルのカスタム絵文字 名前 → 画像URL */
    private localEmojis = new Map<string, string>();
    private localEmojisFetchedAt = 0;
    private localEmojisFetching: Promise<void> | null = null;

    public status: CaptureStatus = 'connecting';

    constructor(opts: {
        origin: string;
        token: string;
        channelId: string;
        onNote: (note: entities.Note) => Promise<void>;
    }) {
        this.origin = opts.origin;
        this.token = opts.token;
        this.channelId = opts.channelId;
        this.onNote = opts.onNote;
    }

    public start() {
        // 絵文字一覧の取得を待ってからノートを処理する
        this.queue = this.refreshLocalEmojis();

        this.stream = new Stream(this.origin, { token: this.token }, { WebSocket });
        this.stream.on('_connected_', () => {
            this.status = 'connected';
            console.info(`[misskey] connected to ${this.origin} (channel: ${this.channelId})`);
        });
        this.stream.on('_disconnected_', () => {
            this.status = 'reconnecting';
            console.info(`[misskey] disconnected from ${this.origin}, reconnecting...`);
        });

        // 接続前に呼んでも送信はキューイングされ、再接続時にも自動で再購読される
        this.connection = this.stream.useChannel('channel', { channelId: this.channelId });
        this.connection.on('note', (note) => {
            this.queue = this.queue
                .then(() => this.onNote(note))
                .catch((err) => {
                    console.error('[misskey] failed to handle note', err);
                });
        });

        this.heartbeatTimer = setInterval(() => {
            if (this.stream?.state === 'connected') {
                this.stream.heartbeat();
            }
        }, HEARTBEAT_INTERVAL);
    }

    public stop() {
        if (this.heartbeatTimer != null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.connection?.dispose();
        this.connection = null;
        this.stream?.close();
        this.stream = null;
    }

    private refreshLocalEmojis(): Promise<void> {
        if (this.localEmojisFetching != null) return this.localEmojisFetching;

        this.localEmojisFetchedAt = Date.now();
        this.localEmojisFetching = createApiClient(this.origin, null).request('emojis', {})
            .then((res) => {
                this.localEmojis = new Map(res.emojis.map((emoji) => [emoji.name, emoji.url]));
            })
            .catch((err) => {
                console.error('[misskey] failed to fetch emojis', err);
            })
            .finally(() => {
                this.localEmojisFetching = null;
            });
        return this.localEmojisFetching;
    }

    /**
     * カスタム絵文字の画像URLを解決する（Misskey本体の MkCustomEmoji と同等の解決ルール）
     * @param name MFM上の絵文字名
     * @param authorHost ノート投稿者のホスト（ローカルユーザーは null）
     * @param remoteEmojis リモートのノートに付与される `emojis`
     */
    public resolveEmoji(name: string, authorHost: string | null, remoteEmojis: Record<string, string> | undefined): string | null {
        if (authorHost == null) {
            const localName = name.endsWith('@.') ? name.slice(0, -2) : name;
            const url = this.localEmojis.get(localName);
            if (url == null) {
                // 新しく追加された絵文字かもしれないので、一定時間ごとに一覧を再取得する
                if (Date.now() - this.localEmojisFetchedAt > EMOJI_LIST_REFRESH_INTERVAL) {
                    void this.refreshLocalEmojis();
                }
                return null;
            }
            // サーバーのメディアプロキシ経由（絵文字サイズに縮小済み）で配信させる
            return EMOJI_ROUTE_SAFE.test(localName) ? `${this.origin}/emoji/${localName}.webp` : url;
        }

        const url = remoteEmojis?.[name];
        if (url == null) return null;
        return EMOJI_ROUTE_SAFE.test(name) && EMOJI_ROUTE_SAFE.test(authorHost)
            ? `${this.origin}/emoji/${name}@${authorHost}.webp`
            : url;
    }
}
