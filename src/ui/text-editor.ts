/**
 * Редактор текстових файлів: `.txt`, `.json`, `.md`, налаштування тощо.
 *
 * Окреме вікно, а не головний редактор: той прив'язаний до запуску, і
 * «Запустити» спробував би виконати JSON як Lua. Тут те саме CodeMirror у тих
 * самих кольорах, але без підказок API Лілки — у тексті вони лише заважали б.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, indentUnit } from '@codemirror/language';
import { HIGHLIGHT, THEME } from './code-editor.ts';
import { openModal, footerButton } from './modal.ts';
import { isJsonName, jsonProblem } from './text-file.ts';
import { t } from '../i18n/index.ts';

/** Підсвітка за розширенням — лише для форматів, де вона справді допомагає. */
async function languageFor(name: string): Promise<Extension[]> {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (ext === 'json') return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/javascript')).json)];
    if (ext === 'js' || ext === 'mjs') {
        return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/javascript')).javascript)];
    }
    if (ext === 'yaml' || ext === 'yml') return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/yaml')).yaml)];
    if (ext === 'toml') return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml)];
    if (ext === 'ini' || ext === 'cfg' || ext === 'conf') {
        return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties)];
    }
    if (ext === 'xml' || ext === 'html') return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/xml')).xml)];
    if (ext === 'css') return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/css')).css)];
    return [];
}

const BOM = [0xef, 0xbb, 0xbf];

export async function openTextEditor(fileName: string, data: Uint8Array, onSave: (data: Uint8Array) => void): Promise<void> {
    // TextDecoder мовчки з'їдає BOM. Деякі програми на ПК без нього читають
    // файл не в тому кодуванні, тож він повертається при збереженні
    const hadBom = BOM.every((byte, index) => data[index] === byte);
    const original = new TextDecoder().decode(data);
    const language = await languageFor(fileName);
    const json = isJsonName(fileName);

    let saved = original;
    let view: EditorView | null = null;
    const current = () => view?.state.doc.toString() ?? saved;

    const modal = openModal({
        title: t('editors.textTitle'),
        fileName,
        className: 'dialog--text',
        isDirty: () => current() !== saved,
    });

    const status = document.createElement('div');
    status.className = 'texted__status';

    function drawStatus(): void {
        status.textContent = '';
        status.className = 'texted__status';
        const text = current();
        const lines = text === '' ? 0 : text.split('\n').length;
        const info = document.createElement('span');
        info.textContent = t('editors.lines', { n: lines });
        status.append(info);

        if (!json) return;
        const problem = jsonProblem(text);
        const badge = document.createElement(problem?.line ? 'button' : 'span');
        badge.className = problem ? 'texted__json texted__json--bad' : 'texted__json';
        badge.textContent = problem ? t('editors.jsonBad', { error: problem.message }) : t('editors.jsonOk');
        if (problem?.line) {
            const line = problem.line;
            (badge as HTMLButtonElement).type = 'button';
            badge.addEventListener('click', () => goToLine(line));
        }
        status.append(badge);
    }

    function goToLine(line: number): void {
        if (!view) return;
        const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
        view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) });
        view.focus();
    }

    function save(): void {
        const text = current();
        const encoded = new TextEncoder().encode(text);
        const bytes = hadBom ? new Uint8Array([...BOM, ...encoded]) : encoded;
        saved = text;
        onSave(bytes);
        modal.close();
    }

    view = new EditorView({
        parent: modal.body,
        state: EditorState.create({
            doc: original,
            extensions: [
                lineNumbers(),
                highlightActiveLine(),
                history(),
                indentUnit.of(json ? '  ' : '    '),
                ...language,
                syntaxHighlighting(HIGHLIGHT),
                THEME,
                keymap.of([
                    {
                        key: 'Mod-s',
                        preventDefault: true,
                        run: () => {
                            save();
                            return true;
                        },
                    },
                    ...historyKeymap,
                    ...defaultKeymap,
                    indentWithTab,
                ]),
                EditorView.lineWrapping,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) drawStatus();
                }),
            ],
        }),
    });
    view.dom.classList.add('texted__code');

    modal.body.append(status);
    modal.footer.append(
        footerButton(t('files.cancel'), false, modal.requestClose),
        footerButton(t('image.save'), true, save),
    );

    drawStatus();
    view.focus();
}
