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
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatus));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId !== 'tdoc') return;
        if (readConfig().onSave) void renderDoc('pdf');
    }));

    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
        { language: 'tdoc' }, { provideDocumentSymbols: buildSymbols }));
    context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(
        { language: 'tdoc' }, { provideFoldingRanges: buildFolds }));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
        { language: 'tdoc' }, { provideCompletionItems: provideCompletion }, '[', '"', ','));
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
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.validate', () => {
        const editor = activeTdoc();
        if (editor) refresh(editor.document);
    }));

    vscode.workspace.textDocuments.forEach(refresh);
    updateStatus();
}

function deactivate() {
    if (diagnostics) diagnostics.dispose();
    if (channel) channel.dispose();
    if (status) status.dispose();
}

module.exports = { activate, deactivate };
