'use strict';
// tdoc 文档源的语言服务核心：分词、解析、结构校验、大纲、折叠。
// 纯函数，不依赖 vscode，便于用 node 直接测试（见 test/test.js）。
//
// 协议来源：tofflib/src/doc/model.tie 的块流定义与 src/doc/load.tie 的装载规则。

/** 块定义：arity 为 token 个数（含块名），null 表示按内容校验。 */
const BLOCKS = {
    doc: { arity: [2, 2], doc: '文档头：`["doc", "标题"]`，必须是首块且只出现一次。' },
    h1: { arity: [2, 2], doc: '一级标题（进入目录）。' },
    h2: { arity: [2, 2], doc: '二级标题（进入目录）。' },
    h3: { arity: [2, 2], doc: '三级标题（不进入目录，仅作层级）。' },
    h4: { arity: [2, 2], doc: '四级标题（PDF 按三级排）。' },
    h5: { arity: [2, 2], doc: '五级标题。' },
    h6: { arity: [2, 2], doc: '六级标题。' },
    h7: { arity: [2, 2], doc: '七级标题。' },
    h8: { arity: [2, 2], doc: '八级标题。' },
    h9: { arity: [2, 2], doc: '九级标题。' },
    p: { arity: [2, 2], doc: '正文段落。`\\` 续行不影响文本，可按可读宽度折行。' },
    b: { arity: [2, 2], doc: '加粗段落。' },
    center: { arity: [2, 2], doc: '居中段落。' },
    note: { arity: [2, 2], doc: '要点/提示段（带底色）。' },
    ul: { arity: [2, 2], doc: '无序列表：`["ul", ["条目一", "条目二"]]`。' },
    ol: { arity: [2, 2], doc: '有序列表：`["ol", ["第一条", "第二条"]]`。' },
    tbl: { arity: null, doc: '表格：`["tbl", [表头...], [行...], ...]`，各行列数一致。' },
    tblw: { arity: null, doc: '带列宽的表格：`["tblw", [表头...], [行...], ..., [列宽...]]`，列宽单位为 twips（20 twips = 1 pt）。' },
    code: { arity: [3, 3], doc: '代码块：`["code", "tie", "…"]`。here-doc 写法：开引号后换行，内容逐字保留。' },
    link: { arity: [3, 3], doc: '超链接段：`["link", "文本", "https://…"]`。' },
    page: { arity: [1, 1], doc: '分页。' },
    sec: { arity: [2, 2], doc: '分节：新页 + 节标题。' },
    cover: { arity: [3, 3], doc: '封面：`["cover", "标题", "副标题"]`。' },
    toc: { arity: [2, 2], doc: '目录：`["toc", 2]`，深度 1–3。' },
    quote: { arity: [2, 2], doc: '引用块（左侧竖线 + 灰字）。' },
    hr: { arity: [1, 1], doc: '分隔线。' },
    cap: { arity: [2, 2], doc: '题注（表格/图下方的小字说明）。' },
    img: { arity: [3, 4], doc: '图片：`["img", "路径", 宽pt, "题注"]`，宽 0 表示按像素宽。' },
    header: { arity: [2, 2], doc: '页眉（每文档至多一次，`{page}` 为页码占位）。' },
    footer: { arity: [2, 2], doc: '页脚（每文档至多一次）。' },
    note_ref: { arity: [2, 2], doc: '整段脚注锚点，文末按出现顺序编号。' },
    right: { arity: [2, 2], doc: '右对齐段落。' },
    just: { arity: [2, 2], doc: '两端对齐段落。' },
    para: { arity: [2, null], doc: '行内混排：run 前缀 `b|` 加粗、`i|` 斜体、`m|` 等宽、`link|文本|URL`、`fn|脚注`。' }
};

const KIND_LIST = Object.keys(BLOCKS);

/** 分词：返回 token 与词法错误。 */
function tokenize(text) {
    const tokens = [];
    const errors = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
        const ch = text[i];
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
            i += 1;
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i += 1;
            continue;
        }
        if (ch === '"') {
            const start = i;
            i += 1;
            let closed = false;
            while (i < n) {
                const c = text[i];
                if (c === '\\') {
                    const e = text[i + 1];
                    if (e === undefined) break;
                    if (e === '"' || e === '\\' || e === '/' || e === 'n' || e === 'r' || e === 't') {
                        i += 2;
                        continue;
                    }
                    if (e === '\n' || e === '\r') {
                        // 续行：反斜杠 + 换行 + 缩进，都不进入文本
                        i += 2;
                        if (e === '\r' && text[i] === '\n') i += 1;
                        while (i < n && (text[i] === ' ' || text[i] === '\t')) i += 1;
                        continue;
                    }
                    errors.push({ message: `未知转义 \\${e}`, start: i, end: Math.min(i + 2, n) });
                    i += 2;
                    continue;
                }
                if (c === '"') {
                    i += 1;
                    closed = true;
                    break;
                }
                i += 1;
            }
            if (!closed) errors.push({ message: '字符串未闭合', start, end: n });
            tokens.push({ type: 'string', start, end: i, value: text.slice(start + 1, Math.max(start + 1, i - 1)) });
            continue;
        }
        if (ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === ',' || ch === ':') {
            tokens.push({ type: ch, start: i, end: i + 1 });
            i += 1;
            continue;
        }
        if (ch === '-' || (ch >= '0' && ch <= '9')) {
            const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
            if (m) {
                tokens.push({ type: 'number', start: i, end: i + m[0].length, value: Number(m[0]) });
                i += m[0].length;
                continue;
            }
        }
        const lit = /^(true|false|null)\b/.exec(text.slice(i));
        if (lit) {
            const v = lit[0] === 'null' ? null : lit[0] === 'true';
            tokens.push({ type: 'literal', start: i, end: i + lit[0].length, value: v });
            i += lit[0].length;
            continue;
        }
        errors.push({ message: `无法识别的字符 '${ch}'`, start: i, end: i + 1 });
        i += 1;
    }
    return { tokens, errors };
}

/** 解析：返回根节点与语法错误。节点含 start/end（字符偏移）。 */
function parse(text) {
    const { tokens, errors } = tokenize(text);
    let p = 0;

    function node(kind, start, end, extra) {
        return Object.assign({ kind, start, end }, extra || {});
    }

    function parseValue() {
        const t = tokens[p];
        if (!t) return null;
        if (t.type === '[') return parseArrayOrMap();
        if (t.type === 'string' || t.type === 'number' || t.type === 'literal') {
            p += 1;
            return node(t.type, t.start, t.end, { value: t.value });
        }
        return null;
    }

    function parseArrayOrMap() {
        const open = tokens[p];
        p += 1;
        const isMap = tokens[p] && tokens[p].type === 'string' && tokens[p + 1] && tokens[p + 1].type === ':';
        if (isMap) {
            const entries = [];
            while (p < tokens.length && tokens[p].type !== ']') {
                const keyTok = tokens[p];
                if (keyTok.type !== 'string') {
                    errors.push({ message: '表的键必须是字符串', start: keyTok.start, end: keyTok.end });
                    p += 1;
                    continue;
                }
                p += 1;
                if (tokens[p] && tokens[p].type === ':') {
                    p += 1;
                } else {
                    errors.push({ message: '键后缺少冒号', start: keyTok.start, end: keyTok.end });
                }
                const value = parseValue();
                if (!value) {
                    const bad = tokens[p];
                    errors.push({
                        message: '键后缺少值',
                        start: bad ? bad.start : keyTok.end,
                        end: bad ? bad.end : keyTok.end
                    });
                }
                entries.push({ key: keyTok.value, keyStart: keyTok.start, keyEnd: keyTok.end, value });
                if (tokens[p] && tokens[p].type === ',') p += 1;
            }
            const close = tokens[p];
            if (close && close.type === ']') p += 1;
            else errors.push({ message: "缺少 ']'", start: open.start, end: open.end });
            return node('map', open.start, close ? close.end : (tokens[p - 1] || open).end, { entries });
        }
        const items = [];
        while (p < tokens.length && tokens[p].type !== ']') {
            if (tokens[p].type === ',' || tokens[p].type === ':') {
                errors.push({ message: `多余的 '${tokens[p].type}'`, start: tokens[p].start, end: tokens[p].end });
                p += 1;
                continue;
            }
            const v = parseValue();
            if (!v) {
                const bad = tokens[p];
                errors.push({ message: `意外的记号 '${bad.type}'`, start: bad.start, end: bad.end });
                p += 1;
                continue;
            }
            items.push(v);
            if (tokens[p] && tokens[p].type === ',') p += 1;
        }
        const close = tokens[p];
        if (close && close.type === ']') p += 1;
        else errors.push({ message: "缺少 ']'", start: open.start, end: open.end });
        return node('array', open.start, close ? close.end : (tokens[p - 1] || open).end, { items });
    }

    const root = parseValue();
    if (root && p < tokens.length) {
        const t = tokens[p];
        errors.push({ message: `根值之后还有内容（'${t.type}'）`, start: t.start, end: t.end });
    }
    if (!root && tokens.length) {
        const t = tokens[0];
        errors.push({ message: '文档必须是一个值', start: t.start, end: t.end });
    }
    return { root, errors, tokens };
}

function diag(message, start, end, severity) {
    return { message, start, end, severity: severity || 'error' };
}

/** 校验块数组：返回诊断。 */
function checkBlocks(blocks, out, seen) {
    blocks.forEach((blk) => {
        if (!blk || blk.kind !== 'array') {
            out.push(diag('每个块必须是数组：`["h1", "标题"]`', blk ? blk.start : 0, blk ? blk.end : 0));
            return;
        }
        const head = blk.items[0];
        if (!head || head.kind !== 'string') {
            out.push(diag('块的首元素必须是块名（字符串）', blk.start, blk.end));
            return;
        }
        const kind = head.value;
        const def = BLOCKS[kind];
        if (!def) {
            out.push(diag(`未知块 '${kind}'。可用块见补全列表`, head.start, head.end));
            return;
        }
        if (kind === 'doc' && seen.doc) {
            out.push(diag('文档头 doc 只能出现一次', head.start, head.end, 'warning'));
        }
        if (kind === 'doc') seen.doc = true;
        if ((kind === 'header' || kind === 'footer') && seen[kind]) {
            out.push(diag(`${kind} 每文档至多一次`, head.start, head.end, 'warning'));
        }
        seen[kind] = true;

        const argc = blk.items.length;
        if (def.arity) {
            const [lo, hi] = def.arity;
            if (argc < lo || (hi !== null && argc > hi)) {
                const want = hi === null ? `至少 ${lo}` : (lo === hi ? `${lo}` : `${lo}–${hi}`);
                out.push(diag(`${kind} 需要 ${want} 个元素（含块名），实际 ${argc}`, head.start, head.end));
            }
        }
        checkBlockShape(kind, blk, out);
    });
}

function checkBlockShape(kind, blk, out) {
    const items = blk.items;
    const at = (i) => items[i];
    const need = (i) => at(i) && at(i).kind === 'string';

    if (kind === 'ul' || kind === 'ol') {
        const arr = at(1);
        if (!arr || arr.kind !== 'array' || !arr.items.every((x) => x.kind === 'string')) {
            out.push(diag(`${kind} 的第二个元素必须是字符串数组`, blk.start, blk.end));
        }
        return;
    }
    if (kind === 'para') {
        for (let i = 1; i < items.length; i += 1) {
            if (!need(i)) out.push(diag('para 的 run 必须是字符串', items[i].start, items[i].end));
        }
        return;
    }
    if (kind === 'tbl' || kind === 'tblw') {
        const rows = items.slice(1, kind === 'tblw' ? -1 : items.length);
        const widths = kind === 'tblw' ? items[items.length - 1] : null;
        if (rows.length < 1) {
            out.push(diag(`${kind} 至少需要表头与一行数据`, blk.start, blk.end));
            return;
        }
        const cols = rows[0].kind === 'array' ? rows[0].items.length : -1;
        if (cols <= 0) {
            out.push(diag('表头必须是字符串数组', rows[0].start, rows[0].end));
            return;
        }
        rows.forEach((row, i) => {
            if (row.kind !== 'array') {
                out.push(diag(`${kind} 的第 ${i + 1} 个参数必须是数组`, row.start, row.end));
                return;
            }
            if (row.items.length !== cols) {
                out.push(diag(`第 ${i + 1} 行有 ${row.items.length} 列，表头是 ${cols} 列`, row.start, row.end));
            }
        });
        if (kind === 'tblw') {
            if (!widths || widths.kind !== 'array') {
                out.push(diag('tblw 的最后一个参数必须是列宽数组', blk.start, blk.end));
                return;
            }
            if (widths.items.length !== cols) {
                out.push(diag(`列宽有 ${widths.items.length} 项，应等于列数 ${cols}`, widths.start, widths.end));
            }
            widths.items.forEach((w) => {
                if (w.kind !== 'number' || !Number.isFinite(w.value) || w.value < 0) {
                    out.push(diag('列宽必须是非负整数（twips）', w.start, w.end));
                }
            });
        }
        return;
    }
    if (kind === 'img') {
        const w = at(2);
        if (w && (w.kind !== 'number' || w.value < 0)) {
            out.push(diag('img 的宽度必须是非负整数（pt，0 表示按像素）', w.start, w.end));
        }
        return;
    }
    if (kind === 'toc') {
        const d = at(1);
        if (d && (d.kind !== 'number' || d.value < 1 || d.value > 3)) {
            out.push(diag('toc 深度取 1–3', d.start, d.end));
        }
        return;
    }
    if (kind === 'code') {
        if (!need(2)) out.push(diag('code 的第三个元素必须是字符串', blk.start, blk.end));
        return;
    }
    if (kind === 'link') {
        if (!need(1) || !need(2)) out.push(diag('link 需要文本与地址两个字符串', blk.start, blk.end));
        return;
    }
    // 其余块：字符串参数
    const stringKinds = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'p', 'b', 'center',
        'note', 'quote', 'cap', 'sec', 'right', 'just', 'header', 'footer', 'note_ref', 'cover', 'doc']);
    if (stringKinds.has(kind)) {
        for (let i = 1; i < items.length; i += 1) {
            if (!need(i)) {
                out.push(diag(`${kind} 的第 ${i + 1} 个元素必须是字符串`, items[i].start, items[i].end));
            }
        }
    }
}

/**
 * 分析文档：一次解析产出诊断、大纲与折叠范围。
 * @param {string} text
 * @returns {{diagnostics: Array, symbols: Array, folds: Array}}
 */
function analyze(text) {
    const { root, errors } = parse(text);
    const diagnostics = errors.map((e) => diag(e.message, e.start, e.end));
    const symbols = [];
    const folds = [];

    if (!root) {
        return { diagnostics, symbols, folds };
    }
    if (root.kind !== 'map') {
        diagnostics.push(diag('文档根必须是表：`["title": …, "blocks": [ … ]]`', root.start, root.end));
        return { diagnostics, symbols, folds };
    }
    const title = root.entries.find((e) => e.key === 'title');
    const blocksEntry = root.entries.find((e) => e.key === 'blocks');
    if (!title) diagnostics.push(diag('缺少 "title": "文档标题"', root.start, root.end, 'warning'));
    if (!blocksEntry || !blocksEntry.value || blocksEntry.value.kind !== 'array') {
        diagnostics.push(diag('缺少 "blocks": [ … ] 数组', root.start, root.end));
        return { diagnostics, symbols, folds };
    }
    const blocks = blocksEntry.value;
    const seen = Object.create(null);
    checkBlocks(blocks.items, diagnostics, seen);

    // 大纲：h1–h3
    blocks.items.forEach((blk) => {
        if (!blk || blk.kind !== 'array' || !blk.items.length) return;
        const head = blk.items[0];
        const textNode = blk.items[1];
        if (!head || head.kind !== 'string') return;
        const m = /^h([1-3])$/.exec(head.value);
        if (!m || !textNode || textNode.kind !== 'string') return;
        symbols.push({
            level: Number(m[1]),
            name: textNode.value.replace(/\s+/g, ' ').trim() || '(空标题)',
            start: blk.start,
            end: blk.end
        });
    });

    // 折叠：跨行的数组
    const stack = [{ node: blocks }];
    while (stack.length) {
        const cur = stack.pop().node;
        if (cur.kind === 'array' || cur.kind === 'map') {
            const kids = cur.kind === 'array' ? cur.items : cur.entries.map((e) => e.value).filter(Boolean);
            const multiline = text.slice(cur.start, cur.end).includes('\n');
            if (multiline) folds.push({ start: cur.start, end: cur.end });
            kids.forEach((k) => { if (k && (k.kind === 'array' || k.kind === 'map')) stack.push({ node: k }); });
        }
    }
    return { diagnostics, symbols, folds };
}

module.exports = { BLOCKS, KIND_LIST, tokenize, parse, analyze };
