/**
 * プラグインのAPI（`/api/plugins/{uid}`）の定義。
 * プラグイン（Node）と設定画面（Vue）の両方から参照するため、副作用のあるコードは置かない。
 */

export const PLUGIN_UID = 'app.sekigae.mk.onecomme';

export type MisskeyUser = {
    id: string;
    username: string;
    name: string | null;
    avatarUrl: string | null;
};

/**
 * チャンネル連携の状態
 * - off: わんコメ側で枠の「接続」がオフ
 * - connecting / connected / reconnecting: Misskeyのストリーミングの接続状態
 */
export type LinkStatus = 'off' | 'connecting' | 'connected' | 'reconnecting';

/** 視聴URLにMisskeyのチャンネルのURLが設定されている、わんコメの枠 */
export type ChannelLink = {
    serviceId: string;
    serviceName: string;
    channelId: string;
    /** 取得できるまでは null */
    channelName: string | null;
    status: LinkStatus;
};

/** 表示設定 */
export type DisplaySettings = {
    /** ロールバッジを表示する */
    showRoleBadges: boolean;
    /** 返信を含める */
    includeReplies: boolean;
};

/** 表示設定の項目（すべて boolean） */
export const DISPLAY_SETTING_KEYS = ['showRoleBadges', 'includeReplies'] as const satisfies readonly (keyof DisplaySettings)[];

/** 設定画面に返す状態 */
export type PublicState = {
    loggedIn: boolean;
    /** MiAuthの認可待ち */
    miauthPending: boolean;
    misskeyHost: string | null;
    misskeyUser: MisskeyUser | null;
    /** ログイン中のサーバーのチャンネルが設定されている枠 */
    links: ChannelLink[];
    display: DisplaySettings;
};

/** `GET ?action=xxx` */
export type PluginGetActions = {
    state: { response: PublicState };
};

/** `POST { action: 'xxx', ...body }` */
export type PluginPostActions = {
    'miauth/start': { body: { host: string }; response: { url: string } };
    'miauth/cancel': { body: Record<string, never>; response: PublicState };
    logout: { body: Record<string, never>; response: PublicState };
    display: { body: Partial<DisplaySettings>; response: PublicState };
};

export type PluginErrorResponse = {
    error: string;
};

/**
 * わんコメがHTTPレスポンスとして返す形式。
 * プラグインの `request()` の戻り値がそのままJSONになる（HTTPステータスは常に200）。
 */
export type PluginApiEnvelope<T> = {
    code: number;
    response: T | PluginErrorResponse;
};
