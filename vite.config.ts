import { defineConfig } from 'vite';

// На GitHub Pages сайт живе за адресою /<repo>/, тому base задається через
// змінну середовища у workflow. Локально та з власним доменом — корінь.
export default defineConfig({
    base: process.env.VITE_BASE ?? '/',
    build: {
        target: 'es2022',
        sourcemap: true,
        rollupOptions: {
            output: {
                /*
                 * Редактор виноситься окремо від решти.
                 *
                 * CodeMirror важить більше, ніж увесь інший код разом. Якщо
                 * лишити його в головному файлі, сторінка почне показувати
                 * Лілку лише після того, як завантажиться редактор — а він
                 * потрібен на секунду пізніше.
                 */
                manualChunks: {
                    editor: [
                        'codemirror',
                        '@codemirror/view',
                        '@codemirror/state',
                        '@codemirror/language',
                        '@codemirror/commands',
                        '@codemirror/autocomplete',
                        '@codemirror/legacy-modes/mode/lua',
                    ],
                },
            },
        },
    },
    // Воркер оголошений як { type: 'module' }, тож і збиратися має модулем:
    // типовий для Vite формат iife з таким оголошенням не узгоджується.
    worker: {
        format: 'es',
    },
    server: {
        // Ті самі заголовки, які на Pages підставляє coi-serviceworker.
        // Локально їх краще мати справжніми, щоб не ловити різницю поведінки.
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
});
