import { defineConfig } from 'tsdown';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// バージョンはルートの package.json のものを使う
const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf-8'));

export default defineConfig({
    entry: './src/plugin.ts',
    // わんコメのプラグインフォルダに置く成果物はルートの dist にまとめる（uiのビルドより先に実行する）
    outDir: '../../dist',
    clean: true,
    deps: {
        onlyBundle: false,
    },
    tsconfig: 'tsconfig.json',
    minify: true,
    sourcemap: false,
    dts: false,
    format: ['cjs'],
    outExtensions: (ctx) => ctx.format === 'es' ? { js: '.mjs', dts: '.d.ts' } : { js: '.js' },
    platform: 'node',
    define: {
        '_VERSION_': JSON.stringify(packageJson.version),
    },
});
