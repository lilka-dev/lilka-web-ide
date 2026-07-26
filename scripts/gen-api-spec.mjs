#!/usr/bin/env node
/**
 * gen-api-spec.mjs — генератор специфікації Lilka API.
 *
 * Читає LuaLS-анотації з `keira/addons/lualilka/library/*.lua` і перетворює їх
 * на машиночитаний JSON, з якого далі генеруються:
 *   - автодоповнення в редакторі (CodeMirror / Monaco)
 *   - визначення блоків Blockly + генератори Lua/JS
 *   - заглушки та перевірка повноти емулятора
 *
 * Залежностей немає. Потрібен Node >= 18.
 *
 * Використання:
 *   node gen-api-spec.mjs --src ../keira/addons/lualilka/library --out src/generated/lilka-api.json
 *   node gen-api-spec.mjs --fetch --ref main --out src/generated/lilka-api.json
 *   node gen-api-spec.mjs --src ./raw --check        # ненульовий код виходу за наявності помилок
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

const SPEC_VERSION = 1;
const GH_OWNER = 'lilka-dev';
const GH_REPO = 'keira';
const GH_PATH = 'addons/lualilka/library';
const DEFAULT_SRC = 'keira/addons/lualilka/library';

/* ------------------------------------------------------------------ *
 * Аргументи командного рядка
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
    const args = {
        src: null,
        out: 'src/generated/lilka-api.json',
        ref: 'main',
        fetch: false,
        check: false,
        quiet: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--src') args.src = argv[++i];
        else if (a === '--out') args.out = argv[++i];
        else if (a === '--ref') args.ref = argv[++i];
        else if (a === '--fetch') args.fetch = true;
        else if (a === '--check') args.check = true;
        else if (a === '--quiet') args.quiet = true;
        else if (a === '--help' || a === '-h') {
            console.log(
                'usage: gen-api-spec.mjs [--src DIR | --fetch [--ref REF]] [--out FILE] [--check] [--quiet]',
            );
            process.exit(0);
        } else throw new Error(`Невідомий аргумент: ${a}`);
    }
    if (!args.src && !args.fetch) {
        args.src = existsSync(DEFAULT_SRC) ? DEFAULT_SRC : null;
        args.fetch = !args.src;
    }
    return args;
}

/* ------------------------------------------------------------------ *
 * Завантаження вихідних файлів
 * ------------------------------------------------------------------ */

async function loadFromDir(dir) {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.lua')).sort();
    const files = [];
    for (const name of names) {
        files.push({ name, text: await readFile(join(dir, name), 'utf8') });
    }
    return { files, source: { kind: 'dir', path: dir } };
}

async function loadFromGitHub(ref) {
    const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${encodeURIComponent(ref)}`;
    const headers = { Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(api, { headers });
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error(
            'Вичерпано ліміт запитів до GitHub API (60/год без автентифікації).\n' +
                'Варіанти: задати змінну середовища GITHUB_TOKEN або скористатися локальною копією через --src.',
        );
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${api}`);
    const entries = await res.json();
    const luaFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.lua'));
    luaFiles.sort((a, b) => a.name.localeCompare(b.name));

    const files = [];
    for (const entry of luaFiles) {
        const r = await fetch(entry.download_url);
        if (!r.ok) throw new Error(`Не вдалося завантажити ${entry.name}: HTTP ${r.status}`);
        files.push({ name: entry.name, text: await r.text(), sha: entry.sha });
    }
    return {
        files,
        source: { kind: 'github', repo: `${GH_OWNER}/${GH_REPO}`, path: GH_PATH, ref },
    };
}

/* ------------------------------------------------------------------ *
 * Допоміжні функції для тексту документації
 * ------------------------------------------------------------------ */

/** reStructuredText, який трапляється в анотаціях, -> Markdown для тултіпів. */
function rstToMarkdown(text) {
    return text
        .replace(/``([^`]+)``/g, '`$1`')
        .replace(/^\.\.\s+warning::\s*/gim, '> ⚠️ ')
        .replace(/^\.\.\s+note::\s*/gim, '> ℹ️ ')
        .replace(/:ref:`([^`]+)`/g, '`$1`')
        .replace(/^\s*\*\s+/gm, '- ');
}

/** Перше речення / перший абзац — для однорядкових підказок і Blockly-тултіпів. */
function summarize(text) {
    if (!text) return '';
    const firstPara = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    const m = firstPara.match(/^(.+?[.!?…])(\s|$)/u);
    return (m ? m[1] : firstPara).trim();
}

function makeDoc(lines) {
    const raw = lines.join('\n').replace(/\s+$/, '');
    const md = rstToMarkdown(raw);
    return { doc: raw, docMarkdown: md, summary: summarize(md) };
}

/* ------------------------------------------------------------------ *
 * Розбір типів
 * ------------------------------------------------------------------ */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Тип: ідентифікатор + [], |, ?, <>, крапки. Кирилиця сюди не потрапляє — це і є ознака опису. */
const TYPE_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:<[^>]*>)?(?:\[\])*\??$/;

function isTypeToken(tok) {
    if (!tok) return false;
    return tok.split('|').every((part) => TYPE_RE.test(part.trim()));
}

/**
 * Зчитує вираз типу з початку рядка, коректно обробляючи дженерики з пробілами:
 * `table<string, string> Request headers` -> { type: 'table<string, string>', rest: 'Request headers' }
 */
function takeTypeExpr(s) {
    let i = 0;
    let depth = 0;
    while (i < s.length) {
        const ch = s[i];
        if (ch === '<') depth++;
        else if (ch === '>') depth--;
        else if (/\s/.test(ch) && depth === 0) break;
        i++;
    }
    return { type: s.slice(0, i), rest: s.slice(i).trim() };
}

/** Прибирає `?` з типу і повертає ознаку необов'язковості (форма `integer?`). */
function splitOptionalType(type) {
    if (type.endsWith('?')) return { type: type.slice(0, -1), optional: true };
    // `string|nil` теж означає необов'язкове значення
    const optional = type.split('|').some((p) => p.trim() === 'nil');
    return { type, optional };
}

/* ------------------------------------------------------------------ *
 * Розбір блоку анотацій
 * ------------------------------------------------------------------ */

/**
 * Блок — це послідовність рядків, що починаються з `---`.
 * Повертає { docLines, tags: [{tag, rest, line}] }.
 */
function splitBlock(block) {
    const docLines = [];
    const tags = [];
    let usage = null;

    for (const { text, line } of block) {
        const body = text.replace(/^---/, '');
        const tagMatch = body.match(/^@([a-zA-Z]+)\s*(.*)$/);

        if (usage !== null && !tagMatch) {
            // усередині @usage: рядки виду `--- local x = 1`
            usage.push(body.replace(/^ /, ''));
            continue;
        }
        if (tagMatch) {
            usage = null;
            const [, tag, rest] = tagMatch;
            if (tag === 'usage') {
                usage = [];
                tags.push({ tag, rest: usage, line });
            } else {
                tags.push({ tag, rest: rest.trim(), line });
            }
            continue;
        }
        docLines.push(body.replace(/^ /, ''));
    }

    // прибираємо порожні рядки на початку/в кінці опису
    while (docLines.length && !docLines[0].trim()) docLines.shift();
    while (docLines.length && !docLines[docLines.length - 1].trim()) docLines.pop();

    return { docLines, tags };
}

/** `---@param name[?] type[?] опис` */
function parseParamTag(rest) {
    const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*|\.\.\.)(\??)\s+(.*)$/);
    if (!m) return null;
    const [, name, qmark, tail] = m;
    const { type: rawType, rest: doc } = takeTypeExpr(tail);
    if (!rawType) return null;
    const { type, optional } = splitOptionalType(rawType);
    return {
        name,
        type,
        optional: optional || qmark === '?',
        ...makeDoc(doc ? [doc] : []),
    };
}

/**
 * `---@return type [name] [опис]`
 * Підтримує також список типів: `---@return number, number`.
 */
function parseReturnTag(rest) {
    const tokens = rest.split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];

    // Випадок `number, number` — кілька значень, що повертаються
    if (tokens[0].endsWith(',')) {
        const types = [];
        let i = 0;
        while (i < tokens.length) {
            const tok = tokens[i];
            const bare = tok.endsWith(',') ? tok.slice(0, -1) : tok;
            if (!isTypeToken(bare)) break;
            types.push(bare);
            i++;
            if (!tok.endsWith(',')) break;
        }
        if (types.length > 1 && i === tokens.length) {
            return types.map((t) => {
                const { type, optional } = splitOptionalType(t);
                return { type, name: null, optional, ...makeDoc([]) };
            });
        }
    }

    const { type: rawType, rest: tail } = takeTypeExpr(rest.trim());
    const { type, optional } = splitOptionalType(rawType);
    let name = null;
    let docTokens = tail ? tail.split(/\s+/) : [];

    // Другий токен вважаємо іменем, лише якщо це ASCII-ідентифікатор.
    // Українські описи ("статус", "результат запиту") сюди не проходять — і це навмисно.
    if (docTokens.length && IDENT.test(docTokens[0])) {
        name = docTokens[0];
        docTokens = docTokens.slice(1);
    }

    return [{ type, name, optional, ...makeDoc(docTokens.length ? [docTokens.join(' ')] : []) }];
}

/** `---@field name type опис` */
function parseFieldTag(rest) {
    const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)(\??)\s+(.*)$/);
    if (!m) return null;
    const [, name, qmark, tail] = m;
    const { type: rawType, rest: doc } = takeTypeExpr(tail);
    if (!rawType) return null;
    const { type, optional } = splitOptionalType(rawType);
    return {
        name,
        type,
        optional: optional || qmark === '?',
        isConstant: /^[A-Z][A-Z0-9_]*$/.test(name),
        value: null,
        ...makeDoc(doc ? [doc] : []),
    };
}

/** `fun(delta: number, x: integer): boolean` -> { params, returns } */
function parseFunSignature(sig) {
    const m = sig.match(/^fun\s*\(([^)]*)\)\s*(?::\s*(.+))?$/);
    if (!m) return null;
    const [, rawParams, rawReturns] = m;
    const params = rawParams
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
            const pm = p.match(/^([A-Za-z_][A-Za-z0-9_]*|\.\.\.)(\??)\s*:\s*(.+)$/);
            if (!pm) return { name: p, type: 'any', optional: false, ...makeDoc([]) };
            const { type, optional } = splitOptionalType(pm[3].trim());
            return { name: pm[1], type, optional: optional || pm[2] === '?', ...makeDoc([]) };
        });
    const returns = rawReturns
        ? rawReturns.split(',').map((r) => {
              const { type, optional } = splitOptionalType(r.trim());
              return { type, name: null, optional, ...makeDoc([]) };
          })
        : [];
    return { params, returns };
}

function splitArgList(raw) {
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Розбір одного файлу
 * ------------------------------------------------------------------ */

const RE_NAMESPACE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*\}\s*$/;
const RE_FUNCTION = /^function\s+([A-Za-z_][A-Za-z0-9_]*)([.:])([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/;
const RE_CONSTRUCTOR = /^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/;
const RE_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/;

function parseFile(fileName, text, diagnostics) {
    const lines = text.split(/\r?\n/);
    const namespaces = new Map();
    let block = [];

    const warn = (line, message, level = 'warning') =>
        diagnostics.push({ file: fileName, line, level, message });

    const ns = (name) => {
        if (!namespaces.has(name)) {
            namespaces.set(name, {
                name,
                sourceFile: fileName,
                kind: 'module',
                doc: '',
                docMarkdown: '',
                summary: '',
                declared: false,
                constructor: null,
                fields: [],
                functions: [],
                callbacks: [],
            });
        }
        return namespaces.get(name);
    };

    /** Розбирає `@class Name [опис]`. */
    const parseClassTag = (rest) => {
        const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/);
        return m ? { name: m[1], inlineDoc: m[2].trim() } : null;
    };

    /** Застосовує @field-и блоку до простору імен. */
    const applyFields = (target, tags) => {
        for (const f of tags.filter((t) => t.tag === 'field')) {
            const field = parseFieldTag(f.rest);
            if (!field) {
                warn(f.line, `Не вдалося розібрати @field: ${f.rest}`);
                continue;
            }
            const existing = target.fields.find((c) => c.name === field.name);
            if (existing) Object.assign(existing, { ...field, value: existing.value });
            else target.fields.push({ ...field, qualifiedName: `${target.name}.${field.name}`, line: f.line });
        }
    };

    /**
     * Блок, що не прив'язався до оголошення.
     * `---@class HttpRequest` + `@field`-и без `X = {}` — це опис структури (таблиці),
     * яку повертає функція. Такі описи потрібні і автодоповненню, і емулятору.
     */
    const flushBlock = () => {
        if (!block.length) return;
        const { docLines, tags } = splitBlock(block);
        const classTag = tags.find((t) => t.tag === 'class');

        if (classTag) {
            const info = parseClassTag(classTag.rest);
            if (info) {
                const target = ns(info.name);
                target.kind = 'struct';
                const doc = info.inlineDoc ? [info.inlineDoc, ...docLines] : docLines;
                Object.assign(target, makeDoc(doc));
                applyFields(target, tags);
                block = [];
                return;
            }
        }

        const meaningful = tags.filter((t) => t.tag !== 'meta' && t.tag !== 'alias');
        if (meaningful.length) {
            warn(block[0].line, `Блок анотацій не прив'язаний до жодного оголошення (@${meaningful[0].tag})`);
        }
        block = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const lineNo = i + 1;
        const trimmed = raw.trim();

        // Декоративний роздільник `--------` — звичайний коментар, а не анотація.
        // (рівно `---` — це порожній рядок усередині блоку документації, його не чіпаємо)
        if (/^-{4,}$/.test(trimmed)) {
            block = [];
            continue;
        }

        if (trimmed.startsWith('---')) {
            block.push({ text: trimmed, line: lineNo });
            continue;
        }

        // Рядок коментаря з двома дефісами всередині блоку анотацій розриває блок.
        // У keira таке трапляється через одруківку — відновлюємо блок і повідомляємо.
        if (trimmed.startsWith('--')) {
            if (block.length) {
                warn(lineNo, `Коментар із двома дефісами всередині блоку анотацій (має бути "---"): ${trimmed}`);
                block.push({ text: '---' + trimmed.slice(2), line: lineNo });
            }
            continue;
        }

        if (!trimmed) {
            flushBlock();
            continue;
        }

        const parsed = splitBlock(block);
        const { docLines, tags } = parsed;
        const tag = (name) => tags.filter((t) => t.tag === name);
        const usageTag = tag('usage')[0];
        const usage = usageTag ? usageTag.rest.join('\n').replace(/^\n+|\n+$/g, '') : null;
        const classTag = tag('class')[0];

        // --- Оголошення простору імен: `display = {}`
        let m = trimmed.match(RE_NAMESPACE);
        if (m) {
            const info = classTag ? parseClassTag(classTag.rest) : null;
            const target = ns(info ? info.name : m[1]);
            if (target.name !== m[1]) {
                warn(lineNo, `@class ${target.name} не збігається зі змінною ${m[1]}`);
            }
            target.declared = true;
            const doc = info && info.inlineDoc ? [info.inlineDoc, ...docLines] : docLines;
            Object.assign(target, makeDoc(doc));
            applyFields(target, tags);
            // Модуль — це простір імен, названий так само, як файл (display, math, gpio).
            // Решта (Transform, File, alertUI) — класи, які створюються під час виконання.
            target.kind = basename(fileName, '.lua') === target.name ? 'module' : 'class';
            block = [];
            continue;
        }

        // --- Метод або статична функція: `function display.draw_line(...)`
        m = trimmed.match(RE_FUNCTION);
        if (m) {
            const [, owner, sep, fnName, rawArgs] = m;
            const target = ns(owner);
            const argNames = splitArgList(rawArgs);
            const params = [];
            for (const p of tag('param')) {
                const parsedParam = parseParamTag(p.rest);
                if (parsedParam) params.push({ ...parsedParam, line: p.line });
                else warn(p.line, `Не вдалося розібрати @param: ${p.rest}`);
            }
            const returns = tag('return').flatMap((r) => parseReturnTag(r.rest));

            // Звірка анотацій із фактичною сигнатурою — головна перевірка цілісності
            const documented = params.map((p) => p.name);
            for (const argName of argNames) {
                if (!documented.includes(argName)) {
                    warn(lineNo, `${owner}${sep}${fnName}: аргумент "${argName}" не описаний через @param`);
                }
            }
            for (const p of params) {
                if (p.name !== '...' && !argNames.includes(p.name)) {
                    warn(p.line, `${owner}${sep}${fnName}: @param "${p.name}" відсутній у сигнатурі`);
                }
            }
            if (documented.length === argNames.length && documented.join() !== argNames.join()) {
                warn(lineNo, `${owner}${sep}${fnName}: порядок @param не збігається із сигнатурою`);
            }
            if (!docLines.length) {
                warn(lineNo, `${owner}${sep}${fnName}: немає опису`, 'info');
            }

            target.functions.push({
                name: fnName,
                qualifiedName: `${owner}${sep}${fnName}`,
                callStyle: sep === ':' ? 'method' : 'static',
                signature: `${owner}${sep}${fnName}(${argNames.join(', ')})`,
                args: argNames,
                params: params.map(({ line, ...rest }) => rest),
                returns,
                usage,
                line: lineNo,
                ...makeDoc(docLines),
            });
            block = [];
            continue;
        }

        // --- Конструктор: `function alertUI(title, message)`
        m = trimmed.match(RE_CONSTRUCTOR);
        if (m) {
            const [, name, rawArgs] = m;
            const target = ns(name);
            const argNames = splitArgList(rawArgs);
            const params = tag('param')
                .map((p) => parseParamTag(p.rest))
                .filter(Boolean);
            target.kind = 'class';
            target.constructor = {
                name,
                qualifiedName: name,
                callStyle: 'constructor',
                signature: `${name}(${argNames.join(', ')})`,
                args: argNames,
                params,
                returns: tag('return').flatMap((r) => parseReturnTag(r.rest)),
                usage,
                line: lineNo,
                ...makeDoc(docLines),
            };
            block = [];
            continue;
        }

        // --- Константа: `gpio.HIGH = 1`, `state.path = ""`
        m = trimmed.match(RE_ASSIGNMENT);
        if (m) {
            const [, owner, name, rawValue] = m;
            const target = ns(owner);
            const typeTag = tag('type')[0];
            const value = parseLuaLiteral(rawValue);
            const existing = target.fields.find((c) => c.name === name);
            if (existing) {
                existing.value = value;
                if (docLines.length && !existing.doc) Object.assign(existing, makeDoc(docLines));
            } else {
                target.fields.push({
                    name,
                    qualifiedName: `${owner}.${name}`,
                    isConstant: /^[A-Z][A-Z0-9_]*$/.test(name),
                    type: typeTag ? splitOptionalType(typeTag.rest.split(/\s+/)[0]).type : inferType(value),
                    optional: false,
                    value,
                    line: lineNo,
                    ...makeDoc(docLines),
                });
            }
            block = [];
            continue;
        }

        // --- `return display` та інші рядки
        flushBlock();
    }

    flushBlock();
    return namespaces;
}

/** Другий прохід: @alias оголошується без наступного рядка-декларації. */
function parseAliases(fileName, text, namespaces, diagnostics) {
    const lines = text.split(/\r?\n/);
    let block = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('---')) {
            block.push({ text: trimmed, line: i + 1 });
            const aliasMatch = trimmed.match(/^---@alias\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(.+)$/);
            if (aliasMatch) {
                const [, fullName, sig] = aliasMatch;
                const { docLines } = splitBlock(block.slice(0, -1));
                const dot = fullName.lastIndexOf('.');
                const owner = dot > 0 ? fullName.slice(0, dot) : null;
                const short = dot > 0 ? fullName.slice(dot + 1) : fullName;
                const fn = parseFunSignature(sig);
                if (!owner || !namespaces.has(owner)) {
                    if (!fn) continue;
                    diagnostics.push({
                        file: fileName,
                        line: i + 1,
                        level: 'info',
                        message: `@alias ${fullName} не належить жодному оголошеному простору імен`,
                    });
                    continue;
                }
                namespaces.get(owner).callbacks.push({
                    name: short,
                    qualifiedName: fullName,
                    signature: sig,
                    params: fn ? fn.params : [],
                    returns: fn ? fn.returns : [],
                    line: i + 1,
                    ...makeDoc(docLines),
                });
                block = [];
            }
            continue;
        }
        block = [];
    }
}

function parseLuaLiteral(raw) {
    const s = raw.replace(/\s*--.*$/, '').trim();
    if (/^0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+([eE][-+]?\d+)?$/.test(s)) return parseFloat(s);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'nil') return null;
    const str = s.match(/^"(.*)"$|^'(.*)'$/);
    if (str) return str[1] !== undefined ? str[1] : str[2];
    return s;
}

function inferType(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'string';
    return 'any';
}

/* ------------------------------------------------------------------ *
 * Головна функція
 * ------------------------------------------------------------------ */

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const { files, source } = args.src ? await loadFromDir(args.src) : await loadFromGitHub(args.ref);

    const diagnostics = [];
    const allNamespaces = new Map();

    for (const file of files) {
        const parsed = parseFile(file.name, file.text, diagnostics);
        for (const [name, data] of parsed) {
            if (allNamespaces.has(name)) {
                diagnostics.push({
                    file: file.name,
                    line: 0,
                    level: 'error',
                    message: `Простір імен "${name}" оголошено повторно (вперше — у ${allNamespaces.get(name).sourceFile})`,
                });
            }
            allNamespaces.set(name, data);
        }
    }
    for (const file of files) {
        parseAliases(file.name, file.text, allNamespaces, diagnostics);
    }

    const namespaces = [...allNamespaces.values()]
        .map(({ declared, ...rest }) => {
            if (!declared && !rest.constructor && rest.kind !== 'struct') {
                diagnostics.push({
                    file: rest.sourceFile,
                    line: 0,
                    level: 'error',
                    message: `Простір імен "${rest.name}" використовується, але не оголошений через @class`,
                });
            }
            for (const c of rest.fields) {
                if (c.isConstant && c.value === null) {
                    diagnostics.push({
                        file: rest.sourceFile,
                        line: c.line || 0,
                        level: 'info',
                        message: `${c.qualifiedName}: значення відоме лише прошивці — для емулятора його треба задати вручну`,
                    });
                }
            }
            rest.functions.sort((a, b) => a.name.localeCompare(b.name));
            rest.fields.sort((a, b) => a.name.localeCompare(b.name));
            return rest;
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const stats = {
        files: files.length,
        namespaces: namespaces.length,
        functions: namespaces.reduce((n, s) => n + s.functions.length, 0),
        fields: namespaces.reduce((n, s) => n + s.fields.length, 0),
        constants: namespaces.reduce((n, s) => n + s.fields.filter((f) => f.isConstant).length, 0),
        callbacks: namespaces.reduce((n, s) => n + s.callbacks.length, 0),
        constructors: namespaces.filter((s) => s.constructor).length,
    };

    const spec = {
        specVersion: SPEC_VERSION,
        generator: 'gen-api-spec.mjs',
        generatedAt: new Date().toISOString(),
        source,
        stats,
        namespaces,
        diagnostics,
    };

    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(spec, null, 2) + '\n', 'utf8');

    if (!args.quiet) {
        const errors = diagnostics.filter((d) => d.level === 'error');
        const warnings = diagnostics.filter((d) => d.level === 'warning');
        const infos = diagnostics.filter((d) => d.level === 'info');
        console.log(
            `✔ ${args.out}: ${stats.namespaces} просторів імен, ${stats.functions} функцій, ` +
                `${stats.fields} полів (з них ${stats.constants} констант), ${stats.callbacks} колбеків`,
        );
        for (const d of [...errors, ...warnings, ...infos]) {
            const mark = d.level === 'error' ? '✖' : d.level === 'warning' ? '▲' : '·';
            console.log(`  ${mark} ${d.file}:${d.line} ${d.message}`);
        }
        console.log(`  разом: ${errors.length} помилок, ${warnings.length} попереджень, ${infos.length} приміток`);
    }

    if (args.check && diagnostics.some((d) => d.level === 'error' || d.level === 'warning')) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
