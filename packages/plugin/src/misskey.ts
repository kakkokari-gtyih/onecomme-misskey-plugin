import { Stream, api } from 'misskey-js';
import type { entities, IChannelConnection, Channels } from 'misskey-js';
import WebSocket from 'ws';

import type { LinkStatus } from '@onecomme-misskey/shared';

/**
 * MiAuthで要求する権限
 * - read:account: ストリーミングへの接続に必要
 */
export const MIAUTH_PERMISSIONS = ['read:account'] as const;

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

/**
 * わんコメの枠の視聴URLから、Misskeyのチャンネルページ（`{origin}/channels/{channelId}`）のチャンネルIDを取り出す。
 * ログイン中のサーバー以外のURLや、チャンネルページ以外のURLの場合は null を返す。
 */
export function parseChannelUrl(url: string, origin: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url.trim());
    } catch {
        return null;
    }
    if (parsed.origin !== origin) return null;
    const match = parsed.pathname.match(/^\/channels\/([a-zA-Z0-9]+)\/?$/);
    return match?.[1] ?? null;
}

export type StreamStatus = Exclude<LinkStatus, 'off'>;

/** `/emoji/` ルートが受け付ける名前（Misskey backend の ServerService を参照） */
const EMOJI_ROUTE_SAFE = /^[a-zA-Z0-9\-_.]+$/;
const EMOJI_LIST_REFRESH_INTERVAL = 60 * 1000;
const HEARTBEAT_INTERVAL = 60 * 1000;

/**
 * Misskeyのストリーミング接続（1本）を保持し、複数のチャンネルを購読する
 */
export class MisskeyStream {
    public readonly origin: string;
    private readonly token: string;
    private readonly onNote: (note: entities.Note, channelId: string) => Promise<void>;
    private readonly onStatusChange: (status: StreamStatus) => void;

    private stream: Stream | null = null;
    /** チャンネルID → チャンネルの購読 */
    private readonly connections = new Map<string, IChannelConnection<Channels['channel']>>();
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    /** ノートを受信順に処理するためのキュー */
    private queue: Promise<void> = Promise.resolve();

    /** ローカルのカスタム絵文字 名前 → 画像URL */
    private localEmojis = new Map<string, string>();
    private localEmojisFetchedAt = 0;
    private localEmojisFetching: Promise<void> | null = null;

    public status: StreamStatus = 'connecting';

    constructor(opts: {
        origin: string;
        token: string;
        onNote: (note: entities.Note, channelId: string) => Promise<void>;
        onStatusChange: (status: StreamStatus) => void;
    }) {
        this.origin = opts.origin;
        this.token = opts.token;
        this.onNote = opts.onNote;
        this.onStatusChange = opts.onStatusChange;
    }

    public start() {
        // 絵文字一覧の取得を待ってからノートを処理する
        this.queue = this.refreshLocalEmojis();

        this.stream = new Stream(this.origin, { token: this.token }, { WebSocket });
        this.stream.on('_connected_', () => {
            console.info(`[misskey] connected to ${this.origin}`);
            this.setStatus('connected');
        });
        this.stream.on('_disconnected_', () => {
            console.info(`[misskey] disconnected from ${this.origin}, reconnecting...`);
            this.setStatus('reconnecting');
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
        for (const connection of this.connections.values()) {
            connection.dispose();
        }
        this.connections.clear();
        this.stream?.close();
        this.stream = null;
    }

    /** 購読するチャンネルを指定した集合に合わせる（増えたものは購読し、減ったものは購読を解除する） */
    public setChannels(channelIds: ReadonlySet<string>) {
        const stream = this.stream;
        if (stream == null) return;

        for (const [channelId, connection] of this.connections) {
            if (channelIds.has(channelId)) continue;
            connection.dispose();
            this.connections.delete(channelId);
            console.info(`[misskey] unsubscribed channel ${channelId}`);
        }

        for (const channelId of channelIds) {
            if (this.connections.has(channelId)) continue;
            // 接続前に呼んでも送信はキューイングされ、再接続時にも自動で再購読される
            const connection = stream.useChannel('channel', { channelId });
            connection.on('note', (note) => {
                this.queue = this.queue
                    .then(() => this.onNote(note, channelId))
                    .catch((err) => {
                        console.error('[misskey] failed to handle note', err);
                    });
            });
            this.connections.set(channelId, connection);
            console.info(`[misskey] subscribed channel ${channelId}`);
        }
    }

    private setStatus(status: StreamStatus) {
        if (this.status === status) return;
        this.status = status;
        this.onStatusChange(status);
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
