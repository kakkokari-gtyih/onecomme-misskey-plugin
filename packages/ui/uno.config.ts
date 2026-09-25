import { defineConfig } from 'unocss';
import presetWind3 from '@unocss/preset-wind3';

export default defineConfig({
    presets: [
        presetWind3({ dark: 'media' }),
    ],
    theme: {
        colors: {
            accent: '#86b300',
            danger: '#d9534f',
            warning: '#e0a800',

            // ライト/ダークで切り替わる色は preflight のCSS変数で定義する
            canvas: 'var(--c-canvas)',
            panel: 'var(--c-panel)',
            fg: 'var(--c-fg)',
            muted: 'var(--c-muted)',
            line: 'var(--c-line)',
        },
    },
    preflights: [{
        getCSS: () => `
            :root {
                --c-canvas: #f4f5f7;
                --c-panel: #ffffff;
                --c-fg: #1f2328;
                --c-muted: #6b7280;
                --c-line: #dfe2e6;
                color-scheme: light;
            }
            @media (prefers-color-scheme: dark) {
                :root {
                    --c-canvas: #17191c;
                    --c-panel: #22252a;
                    --c-fg: #e6e8eb;
                    --c-muted: #9aa1ab;
                    --c-line: #363a41;
                    color-scheme: dark;
                }
            }
        `,
    }],
    shortcuts: {
        'card': 'bg-panel border border-line rounded-xl p-4 mb-4',
        'card-title': 'text-base font-bold mb-3',
        'field-label': 'block font-bold mb-1',
        'note': 'block text-xs text-muted mt-1',
        'input': 'w-full px-2.5 py-2 border border-line rounded-lg bg-canvas text-fg outline-none focus:ring-2 focus:ring-accent',
        'btn': 'inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full border border-line bg-panel text-fg px-4 py-1.5 text-sm cursor-pointer transition-colors enabled:hover:border-accent disabled:opacity-50 disabled:cursor-default',
        'btn-primary': 'btn bg-accent border-accent text-white font-bold',
        'btn-sm': 'px-2.5 py-0.5 text-xs',
    },
});
