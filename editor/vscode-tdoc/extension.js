'use strict';
// tdoc 文档源支持：诊断、补全、大纲、折叠、悬停、插入块、新建文档、PDF 预览。
// 语言服务逻辑在 src/tdoc.js（纯函数，可单测）；本文件只做 VS Code 接线。

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const core = require('./src/tdoc.js');

/** 诊断集合（整个工作区共用，按文档 URI 覆盖）。 */
let diagnostics;
/** 输出通道：编译/渲染日志。 */
let channel;
/** 变更防抖：每个文档一个定时器。 */
const timers = new Map();

/** 块补全项的骨架（用于插入完整块）。 */
const SNIPPETS = {
    h1: '["h1", "${1:标题}"]',
    h2: '["h2", "${1:标题}"]',
    h3: '["h3", "${1:标题}"]',
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

/** 偏移 → 位置（按文档行起点表）。 */
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

/** 重新分析并刷新诊断。 */
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

/** 大纲：h1/h2/h3 按层级嵌套。 */
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

/** 折叠：跨行的数组/表。 */
function buildFolds(document) {
    const result = core.analyze(document.getText());
    const starts = lineStartsOf(document.getText());
    const folds = [];
    for (const f of result.folds) {
        const a = offsetToPosition(starts, f.start).line;
        const b = offsetToPosition(starts, f.end).line;
        if (b > a) folds.push(new vscode.FoldingRange(a, b, vscode.FoldingRangeKind.Region));
    }
    return folds;
}

/** 补全：块名与骨架。 */
function provideCompletion(document, position) {
    const line = document.lineAt(position.line).text;
    const before = line.slice(0, position.character);
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

/** 悬停：块名说明。 */
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

/** 插入块：快速选择 → 插入骨架。 */
async function insertBlock() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'tdoc') {
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

/** 新建文档：最小可渲染骨架。 */
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

/** 读取配置并提供默认值。 */
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

/** 预览：渲染当前文档为 PDF 并打开。 */
async function preview() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'tdoc') {
        void vscode.window.showInformationMessage('请在 tdoc 文档中使用「预览 PDF」。');
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
        const out = path.join(os.tmpdir(), 'tdoc-preview', `${path.basename(editor.document.fileName, '.tdoc')}.pdf`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const env = Object.assign({}, process.env, {
            TDOC_IN: editor.document.uri.fsPath,
            TDOC_OUT: out,
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

function activate(context) {
    diagnostics = vscode.languages.createDiagnosticCollection('tdoc');
    channel = vscode.window.createOutputChannel('tdoc');
    context.subscriptions.push(diagnostics, channel);

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refresh));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId !== 'tdoc') return;
        if (readConfig().onSave) void preview();
    }));

    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
        { language: 'tdoc' }, { provideDocumentSymbols: buildSymbols }));
    context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(
        { language: 'tdoc' }, { provideFoldingRanges: buildFolds }));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
        { language: 'tdoc' }, { provideCompletionItems: provideCompletion }, '[', '"', ','));
    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'tdoc' }, { provideHover }));

    context.subscriptions.push(vscode.commands.registerCommand('tdoc.insertBlock', insertBlock));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.newDocument', newDocument));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.previewPdf', preview));
    context.subscriptions.push(vscode.commands.registerCommand('tdoc.validate', () => {
        const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
        if (doc && doc.languageId === 'tdoc') refresh(doc);
    }));

    vscode.workspace.textDocuments.forEach(refresh);
}

function deactivate() {
    if (diagnostics) diagnostics.dispose();
    if (channel) channel.dispose();
}

module.exports = { activate, deactivate };
