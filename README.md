# Misskeyプラグイン for わんコメ

わんコメで、Misskeyの特定のチャンネルのノートをコメントとして表示するプラグインです。

## 使い方

1. `pnpm build` でビルドし、`dist` フォルダの中身をわんコメのプラグインフォルダに設置します
2. わんコメを起動し、プラグインを有効化します
3. 設定ページ `http://localhost:11180/plugins/net.misskey-hub.onecomme/assets/index.html` を開きます
4. Misskeyサーバーを入力してログインします（MiAuth）
5. お気に入りに登録したチャンネルの中からコメント一覧に流すチャンネルを選び、連携を有効にして保存します

ノートは設定画面で選んだわんコメの枠のコメントとして追加されます（未選択の場合は「Misskey」枠を自動で作成します）。

## License

See [LICENSE](./LICENSE) for details.
