import { Stream, nyaize } from 'misskey-js';
import type { IChannelConnection, Channels } from 'misskey-js';
import { parseSimple } from 'mfm-js';
import type { MfmSimpleNode } from 'mfm-js';
import type StoreType from 'electron-store';

import { defineOnecommePlugin } from '@/utils/def.js';
import type { OnecommePlugin } from '@/utils/def.js';
import type { SendCommentRequest } from '@/types/onecomme.js';


const defaultState = {
    misskeyHost: null as string | null,
    misskeyToken: null as string | null,
    enableCapture: false,
    captureChannelId: null as string | null,
};

export default defineOnecommePlugin(() => {
    let globalStore: StoreType<typeof defaultState> | null = null;

    let misskeyStream: Stream | null = null;
    let channelConnection: IChannelConnection<Channels['channel']> | null = null;

    function setupChannelConnection(opts: {
        misskeyHost: string;
        misskeyToken: string;
        captureChannelId: string;
        reuseConnection?: boolean;
    }) {
        if (!globalStore) return;
        const { misskeyHost, misskeyToken, captureChannelId, reuseConnection = true } = opts;

        if (!reuseConnection) {
            if (channelConnection != null) {
                channelConnection.dispose();
            }
            if (misskeyStream != null) {
                misskeyStream.close();
            }
        }

        misskeyStream = new Stream(misskeyHost, { token: misskeyToken });
        misskeyStream.once('_connected_', () => {
            channelConnection = misskeyStream!.useChannel('channel', { channelId: captureChannelId });
            channelConnection.on('note', async (note) => {
                if (note.text == null) return;
                
                function toString(node: MfmSimpleNode[], enableNyaize = false): string[] {
                    return node.map(n => {
                        switch (n.type) {
                            case 'text': {
				                let text = n.props.text.replace(/(\r\n|\n|\r)/g, '\n');
                                if (enableNyaize) {
                                    text = nyaize(text);
                                }
                                return text.replace(/\n/g, ' ');
                            }

                            case 'emojiCode': {
                                return `:${n.props.name}:`;
                            }

                            case 'unicodeEmoji': {
                                return n.props.emoji;
                            }

                            case 'plain': {
                                return toString(n.children, false);
                            }
                        }
                    }).flat(Infinity) as string[];
                }

                const noteText = toString(parseSimple(note.text), note.user.isCat).join('');
                const userName = note.user.name != null ? toString(parseSimple(note.user.name)).join('') : note.user.host != null ? `@${note.user.username}@${note.user.host}` : `@${note.user.username}`;

                await fetch('http://localhost:11180/api/comments', {
                    method: 'POST',
                    body: JSON.stringify({
                        service: {
                            id: 'net.misskey-hub.onecomme-misskey',
                        },
                        comment: {
                            id: `misskey-${note.id}`,
                            service: 'external',
                            name: userName,
                            url: note.url ?? note.uri ?? `${misskeyHost}/notes/${note.id}`,
                            color: { r: 128, g: 128, b: 128 },
                            data: {
                                id: `misskey-${note.id}`,
                                userId: note.userId,
                                liveId: note.id,
                                name: userName,
                                screenName: note.user.name != null ? userName : undefined,
                                isOwner: false,
                                isSupporter: false,
                                displayName: userName,
                                nickname: note.user.name != null ? userName : undefined,
                                hasGift: false,
                                profileImage: note.user.avatarUrl,
                                timestamp: note.createdAt,
                                comment: noteText,
                            },
                        },
                    } satisfies SendCommentRequest),
                });
            });
        });
    }

    const plugin: OnecommePlugin<typeof defaultState> = {
        //#region Meta
        name: 'Misskey連携プラグイン',
        uid: 'net.misskey-hub.onecomme',
        version: _VERSION_,
        permissions: ['comments'],
        defaultState,
        //#endregion

        init: (api) => {
            const { store } = api;
            globalStore = store;
            
            const misskeyHost = store.get('misskeyHost');
            const misskeyToken = store.get('misskeyToken');
            const enableCapture = store.get('enableCapture');
            const captureChannelId = store.get('captureChannelId');

            if (misskeyHost && misskeyToken && enableCapture && captureChannelId) {
                setupChannelConnection({
                    misskeyHost,
                    misskeyToken,
                    captureChannelId,
                    reuseConnection: false,
                });
            }
        },
        destroy: () => {
            if (channelConnection) {
                channelConnection.dispose();
            }
            if (misskeyStream) {
                misskeyStream.close();
            }
        },
    };

    return plugin;
});
