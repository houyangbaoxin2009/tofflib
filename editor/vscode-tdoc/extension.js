'use strict';
// tdoc 文档源支持：诊断、补全、大纲、折叠、悬停、格式化、插入块、选区转块、
// 新建文档、PDF 预览与多后端导出。
// 语言服务逻辑在 src/tdoc.js（纯函数，可单测）；本文件只做 VS Code 接线。

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const core = require('./src/tdoc.js');

/** 诊断集合（按文档 URI 覆盖）。 */
let diagnostics;
/** 输出通道：编译/渲染日志。 */
let channel;
/** 状态栏：块数与问题数。 */
let status;
/** 变更防抖：每个文档一个定时器。 */
const timers = new Map();

/** 块骨架（插入完整块时用）。 */
const SNIPPETS = {
    h1: '["h1", "${1:标题}"]',
    h2: '["h2", "${1:小节}"]',
    h3: '["h3", "${1:小节}"]',
    p: '["p", "${1:正文}"]',
    note: '["note", "${1:提示}"]',
    ul: '["ul", [\n    "${1:条目一}",\n    "${2:条目二}"\n]]',
    ol: '["ol", [\n    "${1:第一条}",\n    "${2:第二条}"\n]]',
    tblw: '["tblw",\n    ["${1:列一}", "${2:列二}"],\n    ["${3:值}", "${4:值}"],\n    [${5:3000}, ${6:6000}]\n]',
    tbl: '["tbl",\n    ["${1:列一}", "${2:列二}"],\n    ["${3:值}", "${4:值}"]\n]',
    code: '["code", "tie", "\n${1:代码}\n"]',
    quote: '["quote", "${1:引用}"]',
    cap: '["cap", "${1:题注}"]',
    img: '["img", "${1:路径}", ${2:0}, "${3:题注}"]',
    para: '["para", "${1:正文}", "b|${2:加粗}"]',
    link: '["link", "${1:文本}", "${2:https://}"]',
    page: '["page"]',
    sec: '["sec", "${1:节标题}"]',
    hr: '["hr"]',
    header: '["header", "${1:页眉}"]',
    footer: '["footer", "${1:第 {page} 页}"]',
    cover: '["cover", "${1:标题}", "${2:副标题}"]',
    toc: '["toc", ${1:2}]',
    right: '["right", "${1:右对齐}"]',
    just: '["just", "${1:两端对齐}"]',
    b: '["b", "${1:加粗段落}"]',
    center: '["center", "${1:居中段落}"]',
    note_ref: '["note_ref", "${1:脚注}"]'
};

/** 行内混排的 run 前缀。 */
const RUN_PREFIXES = [
    { label: 'b|', detail: '加粗' },
    { label: 'i|', detail: '斜体' },
    { label: 'm|', detail: '等宽' },
    { label: 'link|', detail: '链接（link|文本|URL）' },
    { label: 'fn|', detail: '脚注' }
];

function offsetToPosition(lineStarts, offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return new vscode.Position(lo, offset - lineStarts[lo]);
}

function lineStartsOf(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\n') starts.push(i + 1);
    }
    return starts;
}

function severityOf(s) {
    return s === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
}

function refresh(document) {
    if (!diagnostics || document.languageId !== 'tdoc') return;
    const text = document.getText();
    const result = core.analyze(text);
    const starts = lineStartsOf(text);
    const items = result.diagnostics.map((d) => {
        const range = new vscode.Range(offsetToPosition(starts, d.start), offsetToPosition(starts, d.end));
        const item = new vscode.Diagnostic(range, d.message, severityOf(d.severity));
        item.source = 'tdoc';
        return item;
    });
    const dir = path.dirname(document.uri.fsPath);
    result.imgs.forEach((im) => {
        if (/^https?:/.test(im.path)) return;
        const abs = path.resolve(dir, im.path);
        if (!fs.existsSync(abs)) {
            const range = new vscode.Range(offsetToPosition(starts, im.start), offsetToPosition(starts, im.end));
            const item = new vscode.Diagnostic(range, "图片文件不存在：" + im.path, vscode.DiagnosticSeverity.Warning);
            item.source = "tdoc";
            items.push(item);
        }
    });
    diagnostics.set(document.uri, items);
    updateStatus();
}

function schedule(document) {
    const key = document.uri.toString();
    const old = timers.get(key);
    if (old) clearTimeout(old);
    timers.set(key, setTimeout(() => {
        timers.delete(key);
        refresh(document);
    }, 220));
}

function activeTdoc() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'tdoc') return undefined;
    return editor;
}

/** 状态栏：块数 / 问题数；点击预览。 */
function updateStatus() {
    if (!status) return;
    const editor = activeTdoc();
    if (!editor) {
        status.hide();
        return;
    }
    const r = core.analyze(editor.document.getText());
    status.text = `tdoc · ${r.blocks} 块 · ${r.diagnostics.length} 问题`;
    status.tooltip = '点击预览 PDF';
    status.command = 'tdoc.previewPdf';
    status.show();
}

function buildSymbols(document) {
    const text = document.getText();
    const result = core.analyze(text);
    const starts = lineStartsOf(text);
    const roots = [];
    const stack = [];
    const kindOf = (level) => (level === 1 ? vscode.SymbolKind.Namespace
        : level === 2 ? vscode.SymbolKind.Class : vscode.SymbolKind.Function);
    for (const s of result.symbols) {
        const range = new vscode.Range(offsetToPosition(starts, s.start), offsetToPosition(starts, s.end));
        const sym = new vscode.DocumentSymbol(s.name, '', kindOf(s.level), range, range);
        while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
        if (!stack.length) roots.push(sym);
        else stack[stack.length - 1].sym.children.push(sym);
        stack.push({ level: s.level, sym });
    }
    return roots;
}

function buildFolds(document) {
    const text = document.getText();
    const result = core.analyze(text);
    const starts = lineStartsOf(text);
    const folds = [];
    for (const f of result.folds) {
        const a = offsetToPosition(starts, f.start).line;
        const b = offsetToPosition(starts, f.end).line;
        if (b > a) folds.push(new vscode.FoldingRange(a, b, vscode.FoldingRangeKind.Region));
    }
    return folds;
}

/** 补全：块名、骨架，以及参数位置的取值。 */
function provideCompletion(document, position) {
    const line = document.lineAt(position.line).text;
    const before = line.slice(0, position.character);

    if (/\[\s*"toc"\s*,\s*"?\d*$/.test(before)) {
        return new vscode.CompletionList([1, 2, 3].map((d) => {
            const item = new vscode.CompletionItem(String(d), vscode.CompletionItemKind.Value);
            item.detail = `目录深度 ${d}`;
            return item;
        }), false);
    }
    if (/\[\s*"code"\s*,\s*"?[a-z]*$/.test(before)) {
        const item = new vscode.CompletionItem('tie', vscode.CompletionItemKind.Value);
        item.detail = '代码块语言';
        return new vscode.CompletionList([item], false);
    }
    if (/\[\s*"para".*"[^"]*$/.test(before)) {
        return new vscode.CompletionList(RUN_PREFIXES.map((p) => {
            const item = new vscode.CompletionItem(p.label, vscode.CompletionItemKind.Snippet);
            item.detail = p.detail;
            return item;
        }), false);
    }

    const atMatch = /@([0-9a-zA-Z]*)$/.exec(before);
    if (atMatch) {
        const items = Object.keys(core.TMATH_SYMBOLS).map((code) => {
            const info = core.TMATH_SYMBOLS[code];
            const item = new vscode.CompletionItem(code, vscode.CompletionItemKind.Constant);
            item.detail = info[1];
            item.label = { label: code, description: info[0] };
            item.insertText = code;
            return item;
        });
        return new vscode.CompletionList(items, false);
    }
    const insideKind = /\[\s*"[a-z0-9_]*$/.test(before);
    const items = core.KIND_LIST.map((kind) => {
        const def = core.BLOCKS[kind];
        const item = new vscode.CompletionItem(kind, vscode.CompletionItemKind.Keyword);
        item.detail = 'tdoc 块';
        item.documentation = new vscode.MarkdownString(def.doc);
        if (insideKind) {
            item.insertText = kind;
        } else {
            item.insertText = new vscode.SnippetString(SNIPPETS[kind] || `["${kind}", "\${1}"]`);
            item.kind = vscode.CompletionItemKind.Snippet;
        }
        return item;
    });
    return new vscode.CompletionList(items, false);
}

function provideHover(document, position) {
    const offset = document.offsetAt(position);
    const at = core.mathCodeAt(document.getText(), offset);
    if (at) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${at.glyph}** — \`${at.code}\`\n\n\n短码：\`@${at.code}\`，全名：\`@${at.name}\` 等价`);
        return new vscode.Hover(md, new vscode.Range(document.positionAt(at.start), document.positionAt(at.end)));
    }
    const line = document.lineAt(position.line).text;
    const m = /\[\s*"([a-z0-9_]+)"/.exec(line);
    if (!m) return undefined;
    const start = m.index + m[0].indexOf('"') + 1;
    const end = start + m[1].length;
    if (position.character < start || position.character > end) return undefined;
    const def = core.BLOCKS[m[1]];
    if (!def) return undefined;
    return new vscode.Hover(new vscode.MarkdownString(`**${m[1]}**\n\n${def.doc}`));
}

/** 格式化：只重排缩进，内容逐字保留。 */
function provideFormatting(document) {
    const text = document.getText();
    const next = core.reindent(text);
    if (next === text) return [];
    const full = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
    return [vscode.TextEdit.replace(full, next)];
}

async function insertBlock() {
    const editor = activeTdoc();
    if (!editor) {
        void vscode.window.showInformationMessage('请在 tdoc 文档中使用「插入块」。');
        return;
    }
    const picks = core.KIND_LIST.map((kind) => ({
        label: kind,
        description: core.BLOCKS[kind].doc.replace(/`/g, ''),
        kind: vscode.CompletionItemKind.Keyword
    }));
    const picked = await vscode.window.showQuickPick(picks, { placeHolder: '选择要插入的块' });
    if (!picked) return;
    const snippet = new vscode.SnippetString(SNIPPETS[picked.label] || `["${picked.label}", "\${1}"]`);
    await editor.insertSnippet(snippet);
}

async function newDocument() {
    const doc = await vscode.workspace.openTextDocument({
        language: 'tdoc',
        content: [
            '[',
            '    "title": "未命名文档",',
            '    "blocks": [',
            '        ["cover", "未命名文档", "副标题"],',
            '        ["toc", 2],',
            '        ["h1", "第一章"],',
            '        ["p", "正文。"],',
            '    ],',
            ']',
            ''
        ].join('\n')
    });
    await vscode.window.showTextDocument(doc);
}

/** 选区 → 代码块：自动转义，按 here-doc 形态包裹，保留原有缩进。 */
async function codeFromSelection() {
    const editor = activeTdoc();
    if (!editor) return;
    const sel = editor.selection;
    const text = editor.document.getText(sel);
    if (!text.trim()) {
        void vscode.window.showInformationMessage('先选中一段代码或文本。');
        return;
    }
    const indent = ' '.repeat(editor.document.lineAt(sel.start.line).firstNonWhitespaceCharacterIndex);
    const body = text.replace(/\r\n/g, '\n').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const block = `["code", "tie", "\n${body}\n"],`;
    await editor.edit((b) => b.replace(sel, block));
}

/** 选区 → 带列宽表格：按制表符（没有则逗号）切分，第一行作表头。 */
async function tableFromSelection() {
    const editor = activeTdoc();
    if (!editor) return;
    const sel = editor.selection;
    const text = editor.document.getText(sel);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 1) {
        void vscode.window.showInformationMessage('先选中若干行，用制表符或逗号分列。');
        return;
    }
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.map((l) => l.split(delim).map((c) => c.trim()));
    const cols = Math.max.apply(null, rows.map((r) => r.length));
    if (cols < 2) {
        void vscode.window.showInformationMessage('至少需要两列。');
        return;
    }
    const norm = rows.map((r) => {
        const out = r.slice();
        while (out.length < cols) out.push('');
        return out;
    });
    const base = Math.floor(9020 / cols);
    const widths = new Array(cols).fill(base);
    widths[cols - 1] = 9020 - base * (cols - 1);
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const pad = ' '.repeat(editor.document.lineAt(sel.start.line).firstNonWhitespaceCharacterIndex);
    const linesOut = ['["tblw",'];
    norm.forEach((r) => linesOut.push('    [' + r.map((c) => `"${esc(c)}"`).join(', ') + '],'));
    linesOut.push('    [' + widths.join(', ') + ']');
    linesOut.push('],');
    const block = linesOut.join('\n').replace(/\n/g, '\n' + pad);
    await editor.edit((b) => b.replace(sel, block));
}


/** 正在由扩展改文本：避免自己触发 on-type。 */
let applying = false;

async function replaceWholeLine(doc, lineNo, text, caretCol) {
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    if (!editor) return;
    const line = doc.lineAt(lineNo);
    applying = true;
    await editor.edit((b) => b.replace(line.range, text));
    applying = false;
    const p = new vscode.Position(lineNo, Math.min(caretCol, text.length));
    editor.selection = new vscode.Selection(p, p);
}

/** 行首标记 → 块骨架：`# `、`## `、`- `、`1. `、`> `。 */
async function expandPrefix(doc, pos) {
    const line = doc.lineAt(pos.line).text;
    const before = line.slice(0, pos.character);
    const m = /^(\s*)(#{1,3}|[-*]|\d+\.|>)\s$/.exec(before);
    if (!m) return;
    if (core.stateAt(doc.getText(), doc.offsetAt(new vscode.Position(pos.line, 0))).inString) return;
    const indent = m[1];
    const mark = m[2];
    let body = '';
    let caret = 0;
    if (mark[0] === '#') {
        const lv = mark.length;
        body = `["h${lv}", ""],`;
        caret = indent.length + `["h${lv}", "`.length;
    } else if (mark === '-' || mark === '*') {
        body = '["ul", [""]],';
        caret = indent.length + '["ul", ["'.length;
    } else if (mark === '>') {
        body = '["quote", ""],';
        caret = indent.length + '["quote", "'.length;
    } else {
        body = '["ol", [""]],';
        caret = indent.length + '["ol", ["'.length;
    }
    await replaceWholeLine(doc, pos.line, indent + body, caret);
}

/** 回车后自动续块：段落续段落；``` 转代码块。 */
async function continueBlock(doc, pos) {
    const prevLine = pos.line;
    if (prevLine < 0) return;
    const prev = doc.lineAt(prevLine).text;
    if (core.stateAt(doc.getText(), doc.offsetAt(doc.lineAt(prevLine).range.end)).inString) return;
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    if (!editor) return;

    const fence = /^(\s*)```(\w*)$/.exec(prev);
    if (fence) {
        const lang = fence[2] || 'tie';
        await replaceWholeLine(doc, prevLine, `${fence[1]}["code", "${lang}", "`, fence[0].length);
        return;
    }
    const blk = /^(\s*)\["(p|note|quote|b|center|right|just)", "(.*)"\],\s*$/.exec(prev);
    if (blk && blk[3].length > 0) {
        const text = `${blk[1]}["${blk[2]}", ""],`;
        const caret = blk[1].length + `["${blk[2]}", "`.length;
        applying = true;
        await editor.edit((b) => b.insert(new vscode.Position(prevLine + 1, 0), text));
        applying = false;
        const p = new vscode.Position(prevLine + 1, caret);
        editor.selection = new vscode.Selection(p, p);
        return;
    }
    const item = /^(\s*)"(.*)",\s*$/.exec(prev);
    if (item && item[2].length > 0) {
        // 仅当所在块是 ul/ol 时续条目
        let kind = '';
        for (let i = prevLine - 1; i >= 0 && i > prevLine - 60; i -= 1) {
            const m = /^\s*\["(ul|ol)"/.exec(doc.lineAt(i).text);
            if (m) { kind = m[1]; break; }
            if (/^\s*\["/.test(doc.lineAt(i).text)) break;
        }
        if (!kind) return;
        const text = `${item[1]}"",`;
        applying = true;
        await editor.edit((b) => b.insert(new vscode.Position(prevLine + 1, 0), text));
        applying = false;
        const p = new vscode.Position(prevLine + 1, item[1].length + 1);
        editor.selection = new vscode.Selection(p, p);
    }
}

/** on-type 入口：只认单字符插入，避免与撤销/粘贴打架。 */
function onType(e) {
    if (applying) return;
    const ch = e.contentChanges[0];
    if (!ch || ch.rangeLength !== 0) return;
    if (e.contentChanges.length !== 1) return;
    const cfg = vscode.workspace.getConfiguration('tdoc');
    if (e.document.languageId !== 'tdoc') return;
    if (ch.text === ' ' && cfg.get('typing.autoExpand') !== false) {
        void expandPrefix(e.document, ch.range.start);
    } else if (ch.text === '\n' && cfg.get('typing.autoContinue') !== false) {
        void continueBlock(e.document, ch.range.start);
    }
}

/** 表格内 Tab：跳到同/下一行的下一个字符串。 */
function nextCell() {
    const editor = activeTdoc();
    if (!editor) return;
    const doc = editor.document;
    const pos = editor.selection.active;
    const line = doc.lineAt(pos.line).text;
    const re = /"(?:\\.|[^"\\])*"/g;
    let m;
    while ((m = re.exec(line)) !== null) {
        if (m.index + 1 > pos.character) {
            const p = new vscode.Position(pos.line, m.index + 1);
            editor.selection = new vscode.Selection(p, p);
            return;
        }
    }
    for (let i = pos.line + 1; i < Math.min(doc.lineCount, pos.line + 40); i += 1) {
        const t = doc.lineAt(i).text;
        const mm = /"(?:\\.|[^"\\])*"/.exec(t);
        if (mm) {
            const p = new vscode.Position(i, mm.index + 1);
            editor.selection = new vscode.Selection(p, p);
            return;
        }
    }
}

/** 重排章节号（含「见 N.M」引用）。 */
async function renumberDoc() {
    const editor = activeTdoc();
    if (!editor) return;
    const doc = editor.document;
    const r = core.renumber(doc.getText());
    if (r.text === doc.getText()) {
        void vscode.window.showInformationMessage('没有需要重排的章节号（h1 需写成「第 N 章」，h2/h3 写成「N.M …」）。');
        return;
    }
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    applying = true;
    await editor.edit((b) => b.replace(full, r.text));
    applying = false;
    void vscode.window.showInformationMessage(`已重排 ${r.changes} 处编号或引用。`);
}

/** 维护表格上下文键，供 Tab 键绑定使用。 */
function updateTableContext(editor) {
    let on = false;
    if (editor && editor.document.languageId === 'tdoc') {
        const line = editor.selection.active.line;
        for (let i = line; i >= 0 && i > line - 80; i -= 1) {
            const m = /^\s*\["([a-z0-9_]+)"/.exec(editor.document.lineAt(i).text);
            if (m) {
                on = m[1] === 'tbl' || m[1] === 'tblw';
                break;
            }
        }
    }
    void vscode.commands.executeCommand('setContext', 'tdoc.inTable', on);
}

/** 从 Markdown 导入：单向转换为 tdoc（不引入新格式）。 */
async function importMarkdown() {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Markdown: ['md', 'markdown'] },
        openLabel: '转换为 tdoc'
    });
    if (!picked || !picked.length) return;
    const srcPath = picked[0].fsPath;
    const base = path.basename(srcPath).replace(/\.(md|markdown)$/i, '');
    const md = fs.readFileSync(srcPath, 'utf8');
    const r = core.mdToTdoc(md, base);
    const outPath = path.join(path.dirname(srcPath), base + '.tdoc');
    fs.writeFileSync(outPath, r.text, 'utf8');
    const doc = await vscode.workspace.openTextDocument(outPath);
    await vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage(`已生成 ${path.basename(outPath)}（原文件保留，转换单向）。`);
}

function readConfig() {
    const cfg = vscode.workspace.getConfiguration('tdoc');
    return {
        tiec: String(cfg.get('compile.tiec') || '').trim(),
        trm: String(cfg.get('compile.trm') || '').trim(),
        root: String(cfg.get('tofflib.root') || '').trim(),
        bodyFont: String(cfg.get('render.bodyFont') || '').trim(),
        monoFont: String(cfg.get('render.monoFont') || '').trim(),
        openExternal: cfg.get('preview.openExternal') !== false,
        onSave: cfg.get('preview.onSave') === true
    };
}

function run(cmd, args, opts) {
    return new Promise((resolve) => {
        const child = cp.spawn(cmd, args, Object.assign({ windowsHide: true }, opts || {}));
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('error', (e) => resolve({ code: -1, out, err: err + String(e) }));
        child.on('close', (code) => resolve({ code, out, err }));
    });
}

/** 确保渲染器就绪：写模板、按需编译、返回可执行文件路径。 */
async function ensureRenderer(cfg) {
    const dir = path.join(cfg.root, '.vscode-tdoc');
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, 'render.tie');
    const exe = path.join(dir, process.platform === 'win32' ? 'render.exe' : 'render');
    const template = fs.readFileSync(path.join(__dirname, 'render', 'render.tie'), 'utf8');
    let needWrite = true;
    try {
        needWrite = fs.readFileSync(src, 'utf8') !== template;
    } catch {
        needWrite = true;
    }
    if (needWrite) fs.writeFileSync(src, template, 'utf8');
    let needBuild = needWrite;
    if (!needBuild) {
        try {
            needBuild = fs.statSync(exe).mtimeMs < fs.statSync(src).mtimeMs;
        } catch {
            needBuild = true;
        }
    }
    if (!needBuild) return exe;
    if (!cfg.tiec) {
        throw new Error('未配置 tdoc.compile.tiec（tiec 可执行文件路径）。');
    }
    const env = Object.assign({}, process.env);
    if (cfg.trm) env.TIE_TRM_LITE_LIB = cfg.trm;
    channel.appendLine(`编译渲染器：${cfg.tiec} ${src} -o ${exe}`);
    const r = await run(cfg.tiec, [src, '-o', exe, '-l2', '-t0', '--no-cache'], { env });
    if (r.out) channel.appendLine(r.out.trim());
    if (r.err) channel.appendLine(r.err.trim());
    if (r.code !== 0 || !fs.existsSync(exe)) {
        throw new Error(`渲染器编译失败（退出码 ${r.code}）。详见「输出 → tdoc」。`);
    }
    return exe;
}

/** 渲染当前文档并打开产物。 */
async function renderDoc(backend) {
    const editor = activeTdoc();
    if (!editor) {
        void vscode.window.showInformationMessage('请在 tdoc 文档中执行。');
        return;
    }
    const cfg = readConfig();
    if (!cfg.root) {
        const pick = await vscode.window.showErrorMessage(
            '未配置 tdoc.tofflib.root（tofflib 源码根目录）。', '打开设置');
        if (pick) void vscode.commands.executeCommand('workbench.action.openSettings', 'tdoc.tofflib.root');
        return;
    }
    await editor.document.save();
    try {
        const exe = await ensureRenderer(cfg);
        const out = path.join(os.tmpdir(), 'tdoc-preview',
            `${path.basename(editor.document.fileName, '.tdoc')}.${backend}`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const env = Object.assign({}, process.env, {
            TDOC_IN: editor.document.uri.fsPath,
            TDOC_OUT: out,
            TDOC_BACKEND: backend,
            TDOC_FONT: cfg.bodyFont,
            TDOC_MONO: cfg.monoFont
        });
        const r = await run(exe, [], { env });
        if (r.out) channel.appendLine(r.out.trim());
        if (r.err) channel.appendLine(r.err.trim());
        if (r.code !== 0 || !fs.existsSync(out)) {
            void vscode.window.showErrorMessage(`渲染失败：${(r.out || r.err || '').trim() || '未知原因'}`);
            return;
        }
        const uri = vscode.Uri.file(out);
        if (cfg.openExternal) await vscode.env.openExternal(uri);
        else await vscode.commands.executeCommand('vscode.open', uri);
    } catch (e) {
        void vscode.window.showErrorMessage(String(e && e.message ? e.message : e));
    }
}

async function exportDoc() {
    const picked = await vscode.window.showQuickPick([
        { label: 'pdf', description: '打印用排版（默认）' },
        { label: 'docx', description: 'Word 文档' },
        { label: 'pptx', description: '演示稿' },
        { label: 'xlsx', description: '表格' }
    ], { placeHolder: '导出为哪种格式' });
    if (!picked) return;
    await renderDoc(picked.label);
}

function activate(context) {
    diagnostics = vscode.languages.createDiagnosticCollection('tdoc');
    channel = vscode.window.createOutputChannel('tdoc');
    status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(diagnostics, channel, status);

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refresh));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
        schedule(e.document);
        onType(e);
    }));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((e) => {
        updateStatus();
        updateTableContext(e);
    }));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => updateTableContext(e.textEditor)));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId !== 'tdoc') return;
        if (readConfig().onSave) void renderDoc('pdf');
    }));

    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
        { language: 'tdoc' }, { provideDocumentSymbols: buildSymbols }));
    context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(
        { language: 'tdoc' }, { provideFoldingRanges: buildFolds }));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
        { language: 'tdoc' }, { provideCompletionItems: provideCompletion }, '[', '"', ',', '@'));
    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'tdoc' }, { provideHover }));
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(
        { language: 'tdoc' }, { provideDocumentFormattingEdits: provideFormatting }));

    context.subscriptions.push(vscode.commands.registerCommand('tdoc.insertBlock', insertBlock));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.newDocument', newDocument));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.previewPdf', () => renderDoc('pdf')));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.export', exportDoc));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.codeFromSelection', codeFromSelection));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.tableFromSelection', tableFromSelection));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.reindent', async () => {
        const editor = activeTdoc();
        if (!editor) return;
        const text = editor.document.getText();
        const next = core.reindent(text);
        if (next === text) {
            void vscode.window.showInformationMessage('缩进已经规范。');
            return;
        }
        const full = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
        await editor.edit((b) => b.replace(full, next));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.renumber', renumberDoc));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.importMarkdown', importMarkdown));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.nextCell', nextCell));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.validate', () => {
        const editor = activeTdoc();
        if (editor) refresh(editor.document);
    }));

    vscode.workspace.textDocuments.forEach(refresh);
    updateStatus();
    updateTableContext(vscode.window.activeTextEditor);
}

function deactivate() {
    if (diagnostics) diagnostics.dispose();
    if (channel) channel.dispose();
    if (status) status.dispose();
}

module.exports = { activate, deactivate };
