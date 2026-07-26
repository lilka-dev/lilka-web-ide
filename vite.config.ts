import { defineConfig } from 'vite';

// На GitHub Pages сайт живе за адресою /<repo>/, тому base задається через
// змінну середовища у workflow. Локально та з власним доменом — корінь.
export default defineConfig({
    base: process.env.VITE_BASE ?? '/',
    build: {
        target: 'es2022',
        sourcemap: true,
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
