import { nyaize } from 'misskey-js';
import type { entities } from 'misskey-js';
import { parseSimple } from 'mfm-js';
import type { MfmSimpleNode } from 'mfm-js';

import type { SendCommentRequest } from '@/types/onecomme.js';

export type EmojiResolver = (name: string, host: string | null, remoteEmojis: Record<string, string> | undefined) => string | null;

type Rendered = {
    /** わんコメのコメント本文として表示するHTML */
    html: string;
    /** 読み上げ用の平文（カスタム絵文字は除去） */
    text: string;
};

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * MFM（parseSimple）を 平文＋Unicode絵文字 / カスタム絵文字 のHTMLに変換する
 */
function renderMfm(
    nodes: MfmSimpleNode[],
    opts: {
        nyaize: boolean;
        resolveEmoji: (name: string) => string | null;
    },
): Rendered {
    let html = '';
    let text = '';

    for (const node of nodes) {
        switch (node.type) {
            case 'text': {
                let t = node.props.text.replace(/\r\n|\r|\n/g, '\n');
                if (opts.nyaize) {
                    t = nyaize(t);
                }
                t = t.replace(/\n/g, ' ');
                html += escapeHtml(t);
                text += t;
                break;
            }

            case 'unicodeEmoji': {
                html += escapeHtml(node.props.emoji);
                text += node.props.emoji;
                break;
            }

            case 'emojiCode': {
                const url = opts.resolveEmoji(node.props.name);
                if (url != null) {
                    const alt = escapeHtml(`:${node.props.name}:`);
                    // わんコメがYouTubeのカスタム絵文字に使うのと同じ形式にする
                    // （コメントはサニタイズされ style 属性は除去される。大きさはテンプレート側のCSSで調整される）
                    html += `<img src="${escapeHtml(url)}" alt="${alt}" data-custom-emoji="true" />`;
                } else {
                    // 解決できない絵文字は Misskey 本体と同様にテキストのまま表示する
                    html += escapeHtml(`:${node.props.name}:`);
                    text += `:${node.props.name}:`;
                }
                break;
            }

            case 'plain': {
                // <plain> の中身には nyaize を適用しない（Misskey本体と同じ挙動）
                const inner = renderMfm(node.children, { ...opts, nyaize: false });
                html += inner.html;
                text += inner.text;
                break;
            }
        }
    }

    return { html, text };
}

/** カスタム絵文字を除去して平文を返す（ユーザー名用） */
function toPlainText(input: string): string {
    return parseSimple(input).map((node) => {
        switch (node.type) {
            case 'text': return node.props.text.replace(/\r\n|\r|\n/g, ' ');
            case 'unicodeEmoji': return node.props.emoji;
            case 'emojiCode': return ''; // カスタム絵文字は除去する
            case 'plain': return node.children.map((c) => c.props.text).join('');
        }
    }).join('');
}

export function getUserDisplayName(user: entities.UserLite): string {
    if (user.name != null && user.name.trim() !== '') {
        return toPlainText(user.name);
    }
    return getUserAcct(user);
}

export function getUserAcct(user: entities.UserLite): string {
    return user.host != null ? `@${user.username}@${user.host}` : `@${user.username}`;
}

/**
 * ノートをわんコメのコメントに変換する。
 * コメントとして表示する本文が無い場合（本文なしのリノートやファイルのみのノート等）は null を返す。
 */
export function noteToComment(note: entities.Note, ctx: {
    serviceId: string;
    myUserId: string | null;
    resolveEmoji: EmojiResolver;
}): SendCommentRequest | null {
    // CWが設定されている場合は、本文ではなくCWの注釈のみを表示する
    const source = note.cw ?? note.text;
    if (source == null || source.trim() === '') return null;

    const rendered = renderMfm(parseSimple(source), {
        nyaize: note.user.isCat === true,
        resolveEmoji: (name) => ctx.resolveEmoji(name, note.user.host, note.emojis),
    });

    const displayName = getUserDisplayName(note.user);
    const acct = getUserAcct(note.user);

    return {
        service: {
            id: ctx.serviceId,
        },
        comment: {
            id: `misskey-${note.id}`,
            userId: note.userId,
            liveId: note.channelId ?? 'misskey',
            name: displayName,
            screenName: acct,
            displayName,
            profileImage: note.user.avatarUrl,
            badges: (note.user.badgeRoles ?? [])
                .filter((role) => role.iconUrl != null)
                .map((role) => ({ url: role.iconUrl!, label: role.name })),
            isOwner: ctx.myUserId != null && note.userId === ctx.myUserId,
            hasGift: false,
            comment: rendered.html,
            speechText: rendered.text,
            timestamp: note.createdAt,
        },
    };
}
