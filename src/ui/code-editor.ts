/**
 * Редактор коду на CodeMirror.
 *
 * Раніше тут було звичайне текстове поле з колонкою номерів. Воно працювало,
 * але не допомагало: ані підсвітки, ані підказок, ані способу перейти до рядка
 * з помилки.
 *
 * Автодоповнення береться з `completions.ts`, згенерованого з анотацій
 * прошивки. Тобто підказки описують рівно те, що є в API — разом з
 * українськими поясненнями, і не розходяться з дійсністю при зміні прошивки.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import {
    autocompletion,
    completionKeymap,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { COMPLETIONS } from '../generated/completions.ts';

/**
 * Підсвітка в кольорах середовища.
 *
 * Не готова тема, а власні правила: бірюза й бурштин уже задають характер
 * інтерфейсу, і редактор має бути з ними в родині, а не сам по собі.
 */
const HIGHLIGHT = HighlightStyle.define([
    { tag: tags.keyword, color: '#0e7c86', fontWeight: '600' },
    { tag: tags.controlKeyword, color: '#0e7c86', fontWeight: '600' },
    { tag: tags.string, color: '#0a7d3f' },
    { tag: tags.number, color: '#b5510b' },
    { tag: tags.comment, color: '#8aa79a', fontStyle: 'italic' },
    { tag: tags.function(tags.variableName), color: '#1a5fb4' },
    { tag: tags.operator, color: '#5c7a6e' },
    { tag: tags.bool, color: '#b5510b' },
    { tag: tags.null, color: '#b5510b' },
    { tag: tags.punctuation, color: '#5c7a6e' },
]);

const THEME = EditorView.theme({
    '&': {
        fontSize: '13px',
        backgroundColor: '#fbfdfc',
        border: '1px solid #d5e3dc',
        borderRadius: '10px',
        overflow: 'hidden',
    },
    '&.cm-focused': { outline: 'none', borderColor: '#0e7c86' },
    '.cm-content': {
        fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
        padding: '10px 0',
        caretColor: '#16302a',
    },
    '.cm-gutters': {
        backgroundColor: '#f7f9f8',
        color: '#a9b4af',
        border: 'none',
        borderRight: '1px solid #d5e3dc',
    },
    '.cm-activeLine': { backgroundColor: '#f2f7f4' },
    '.cm-activeLineGutter': { backgroundColor: '#eef4f1', color: '#5c7a6e' },
    '.cm-tooltip': {
        border: '1px solid #c3d4cc',
        borderRadius: '8px',
        backgroundColor: '#ffffff',
        boxShadow: '0 6px 20px rgba(22, 48, 42, 0.14)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: '#e9f4f2',
        color: '#16302a',
    },
    '.cm-completionInfo': {
        borderLeft: '1px solid #e4ede8',
        maxWidth: '260px',
        fontSize: '12px',
        lineHeight: '1.5',
    },
});

/**
 * Підказки з API Лілки.
 *
 * Спрацьовує і на початку слова, і після крапки: `display.` одразу показує
 * усе, що є в цьому просторі імен.
 */
function lilkaCompletions(context: CompletionContext): CompletionResult | null {
    const word = context.matchBefore(/[\w.]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    return {
        from: word.from,
        options: COMPLETIONS.map((item) => ({
            label: item.label,
            type: item.type,
            detail: item.detail,
            info: item.info || undefined,
            apply: item.apply,
        })),
        validFor: /^[\w.]*$/,
    };
}

export interface CodeEditor {
    dom: HTMLElement;
    getValue(): string;
    setValue(text: string): void;
    /** Ставить курсор на рядок — для переходу з повідомлення про помилку. */
    goToLine(line: number): void;
    focus(): void;
}

export function createCodeEditor(options: {
    initial: string;
    onChange: () => void;
    onRun: () => void;
    onSave: () => void;
}): CodeEditor {
    const view = new EditorView({
        state: EditorState.create({
            doc: options.initial,
            extensions: [
                lineNumbers(),
                highlightActiveLine(),
                history(),
                indentUnit.of('    '),
                StreamLanguage.define(lua),
                syntaxHighlighting(HIGHLIGHT),
                THEME,
                autocompletion({ override: [lilkaCompletions], activateOnTyping: true }),
                placeholder('Тут буде програма для Лілки'),
                keymap.of([
                    // Ctrl/Cmd+Enter запускає, Ctrl/Cmd+S зберігає негайно.
                    // Обидві комбінації мусять стояти ПЕРЕД типовими, інакше
                    // браузер перехопить збереження сторінки.
                    {
                        key: 'Mod-Enter',
                        run: () => {
                            options.onRun();
                            return true;
                        },
                    },
                    {
                        key: 'Mod-s',
                        preventDefault: true,
                        run: () => {
                            options.onSave();
                            return true;
                        },
                    },
                    ...completionKeymap,
                    ...historyKeymap,
                    ...defaultKeymap,
                    indentWithTab,
                ]),
                EditorView.lineWrapping,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) options.onChange();
                }),
            ],
        }),
    });

    return {
        dom: view.dom,
        getValue: () => view.state.doc.toString(),
        setValue(text) {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: text },
                selection: { anchor: 0 },
            });
        },
        goToLine(line) {
            const total = view.state.doc.lines;
            const target = view.state.doc.line(Math.min(Math.max(line, 1), total));
            view.dispatch({
                selection: { anchor: target.from },
                scrollIntoView: true,
            });
            view.focus();
        },
        focus: () => view.focus(),
    };
}
