import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';

// バージョンはルートの package.json のものを使う
const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf-8'));

export default defineConfig({
    // `/plugins/{uid}/ui/` 以下で配信するため相対パス
    base: './',
    plugins: [
        vue(),
        UnoCSS(),
    ],
    resolve: {
        alias: {
            '@/': resolve(import.meta.dirname, 'src') + '/',
        },
    },
    build: {
        outDir: resolve(import.meta.dirname, '../../dist/ui'),
        emptyOutDir: true,
    },
    define: {
        '_VERSION_': JSON.stringify(packageJson.version),
    },
    server: {
        // 開発時は起動中のわんコメのプラグインAPIにプロキシする
        proxy: {
            '/api': 'http://127.0.0.1:11180',
        },
    },
});
