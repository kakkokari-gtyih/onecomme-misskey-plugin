import { defineConfig } from 'tsdown';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
    entry: 'src/plugin.ts',
    clean: true,
    deps: {
        onlyBundle: false,
    },
    tsconfig: true,
    minify: true,
    sourcemap: false,
    dts: false,
    format: ['cjs'],
    outExtensions: (ctx) => ctx.format === 'es' ? { js: '.mjs', dts: '.d.ts' } : { js: '.js' },
    platform: 'node',
    define: {
        '_VERSION_': JSON.stringify(packageJson.version),
    },
    copy: [
        './assets',
    ],
});
