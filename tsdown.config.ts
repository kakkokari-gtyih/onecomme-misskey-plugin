import { defineConfig } from 'tsdown';
import { replacePlugin } from 'rolldown/plugins';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
    entry: 'src/plugin.ts',
    dts: false,
    deps: {
        onlyBundle: false,
    },
    sourcemap: false,
    minify: true,
    format: ['cjs', 'esm'],
    outExtensions: (ctx) => {
        switch (ctx.format) {
            case 'cjs':
                return {
                    js: '.js',
                    dts: '.d.ts',
                }
            case 'es':
                return {
                    js: '.mjs',
                    dts: '.d.mts',
                };
            default:
                return {
                    js: '.js',
                    dts: '.d.ts',
                };
        }
    },
    platform: 'node',
    plugins: [
        replacePlugin({
            '_VERSION_': JSON.stringify(packageJson.version),
        }),
    ],
});
