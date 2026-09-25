/**
 * プラグインのAPI（`/api/plugins/{uid}`）の定義。
 * プラグイン（Node）と設定画面（Vue）の両方から参照するため、副作用のあるコードは置かない。
 */

export const PLUGIN_UID = 'net.misskey-hub.onecomme';

export type MisskeyUser = {
    id: string;
    username: string;
    name: string | null;
    avatarUrl: string | null;
};

export type CaptureStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting';

/** 設定画面に返す状態 */
export type PublicState = {
    loggedIn: boolean;
    /** MiAuthの認可待ち */
    miauthPending: boolean;
    misskeyHost: string | null;
    misskeyUser: MisskeyUser | null;
    enableCapture: boolean;
    captureChannelId: string | null;
    captureChannelName: string | null;
    onecommeServiceId: string | null;
    captureStatus: CaptureStatus;
};

export type ChannelSummary = {
    id: string;
    name: string;
    description: string | null;
    bannerUrl: string | null;
    color: string;
    isArchived: boolean;
    notesCount: number;
    usersCount: number;
};

export type ServiceSummary = {
    id: string;
    name: string;
};

export type SettingsUpdate = {
    enableCapture?: boolean;
    onecommeServiceId?: string | null;
    captureChannelId?: string | null;
};

/** `GET ?action=xxx` */
export type PluginGetActions = {
    state: { response: PublicState };
    channels: { response: ChannelSummary[] };
    services: { response: ServiceSummary[] };
};

/** `POST { action: 'xxx', ...body }` */
export type PluginPostActions = {
    'miauth/start': { body: { host: string }; response: { url: string } };
    'miauth/cancel': { body: Record<string, never>; response: PublicState };
    logout: { body: Record<string, never>; response: PublicState };
    settings: { body: SettingsUpdate; response: PublicState };
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
