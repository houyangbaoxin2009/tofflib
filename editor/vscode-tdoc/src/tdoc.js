'use strict';
// tdoc 文档源的语言服务核心：分词、解析、结构校验、大纲、折叠。
// 纯函数，不依赖 vscode，便于用 node 直接测试（见 test/test.js）。
//
// 协议来源：tofflib/src/doc/model.tie 的块流定义与 src/doc/load.tie 的装载规则。

/** 块定义：arity 为 token 个数（含块名），null 表示按内容校验。 */


// tmath 符号表：短码 → 字形与全名（与 tmath.tie 的符号表同步）
const TMATH_SYMBOLS = {
    "a": ["α", "alpha"], "b": ["β", "beta"], "g": ["γ", "gamma"], "d": ["δ", "delta"],
    "e": ["ε", "epsilon"], "z": ["ζ", "zeta"], "h": ["η", "eta"], "th": ["θ", "theta"],
    "i": ["ι", "iota"], "k": ["κ", "kappa"], "l": ["λ", "lambda"], "m": ["μ", "mu"],
    "n": ["ν", "nu"], "x": ["ξ", "xi"], "o": ["ο", "omicron"], "p": ["π", "pi"],
    "r": ["ρ", "rho"], "s": ["σ", "sigma"], "t": ["τ", "tau"], "u": ["υ", "upsilon"],
    "f": ["φ", "phi"], "ch": ["χ", "chi"], "ps": ["ψ", "psi"], "w": ["ω", "omega"],
    "A": ["Α", "Alpha"], "B": ["Β", "Beta"], "G": ["Γ", "Gamma"], "D": ["Δ", "Delta"],
    "E": ["Ε", "Epsilon"], "Z": ["Ζ", "Zeta"], "H": ["Η", "Eta"], "TH": ["Θ", "Theta"],
    "I": ["Ι", "Iota"], "K": ["Κ", "Kappa"], "L": ["Λ", "Lambda"], "M": ["Μ", "Mu"],
    "N": ["Ν", "Nu"], "X": ["Ξ", "Xi"], "O": ["Ο", "Omicron"], "P": ["Π", "Pi"],
    "R": ["Ρ", "Rho"], "S": ["Σ", "sum"], "F": ["Φ", "Phi"], "PS": ["Ψ", "Psi"],
    "W": ["Ω", "Omega"], "Q": ["Θ", "Theta"],
    "sum": ["∑", "sum"], "prod": ["∏", "prod"], "int": ["∫", "int"], "oint": ["∮", "oint"],
    "lim": ["lim", "lim"],
    "le": ["≤", "le"], "ge": ["≥", "ge"], "ne": ["≠", "ne"], "approx": ["≈", "approx"],
    "equiv": ["≡", "equiv"], "to": ["→", "to"], "in": ["∈", "in"], "notin": ["∉", "notin"],
    "subset": ["⊂", "subset"], "supset": ["⊃", "supset"], "cup": ["∪", "cup"],
    "cap": ["∩", "cap"], "perp": ["⊥", "perp"], "parallel": ["∥", "parallel"],
    "therefore": ["∴", "therefore"], "because": ["∵", "because"],
    "oo": ["∞", "infty"], "infty": ["∞", "infty"], "partial": ["∂", "partial"],
    "nabla": ["∇", "nabla"], "forall": ["∀", "forall"], "exists": ["∃", "exists"],
    "pm": ["±", "pm"], "mp": ["∓", "mp"], "times": ["×", "times"], "cdot": ["·", "cdot"],
    "cdots": ["⋯", "cdots"], "ldots": ["…", "ldots"], "emptyset": ["∅", "emptyset"],
    "angle": ["∠", "angle"], "degree": ["°", "degree"], "prime": ["′", "prime"]
};

// ---------- tmath 公式文本的轻量校验（编辑器侧，不做完整解析） ----------

const TMATH_CODES = new Set([
    "a", "b", "g", "d", "e", "z", "h", "th", "i", "k", "l", "m", "n", "x", "o", "p",
    "r", "s", "t", "u", "f", "ch", "ps", "w",
    "A", "B", "G", "D", "TH", "L", "X", "P", "S", "F", "PS", "W",
    "sum", "prod", "int", "oint", "lim",
    "le", "ge", "ne", "approx", "equiv", "to", "in", "notin", "subset", "supset",
    "cup", "cap", "perp", "parallel", "therefore", "because",
    "oo", "infty", "partial", "nabla", "forall", "exists", "pm", "mp", "times",
    "cdot", "cdots", "ldots", "emptyset", "angle", "degree", "prime"
]);

function isTmathOperandStart(c) {
    return /[0-9a-zA-Z@"]/.test(c) || c.charCodeAt(0) > 127;
}

const TMATH_BIG = new Set(["sum", "prod", "int", "oint", "lim", "S"]);

function checkMathText(src, base, out, knownCodes) {
    // 轻量检查只覆盖确定性的错误：括号/绝对值配对、未知 @ 短码、
    // 公式以运算符开头/结尾。「缺操作数/裸并置」交给 tie 端的 tmath 解析器判定，
    // 编辑器侧的状态机推断容易误报（大运算符作用体、函数调用都长得像并置）。
    const n = src.length;
    const stack = [];
    let i = 0;
    let seenOperand = false;
    let lastWasOp = false;
    while (i < n) {
        const c = src[i];
        if (c === " " || c === "\t" || c === "\n" || c === "\r") { i += 1; continue; }
        if (c === "/") {
            if (lastWasOp) out.push(diag("公式以运算符开头", base + i, base + i + (src[i + 1] === "/" ? 2 : 1)));
            if (src[i + 1] === "/") { i += 2; } else { i += 1; }
            lastWasOp = true;
            continue;
        }
        if (c === "+" || c === "-" || c === "*" || c === "=" || c === "<" || c === ">" || c === "^" || c === "_" || c === "," || c === ";") {
            if (!seenOperand) out.push(diag("公式以运算符开头", base + i, base + i + 1));
            if ((c === "<" || c === ">") && src[i + 1] === "=") i += 1;
            if (c === "-" && src[i + 1] === ">") i += 1;
            i += 1;
            lastWasOp = true;
            continue;
        }
        if (c === "(" || c === "[") {
            stack.push({ ch: c, at: base + i });
            i += 1;
            lastWasOp = false;
            continue;
        }
        if (c === ")" || c === "]") {
            const want = c === ")" ? "(" : "[";
            const top = stack.pop();
            if (!top || top.ch !== want) {
                out.push(diag(`多余的 ${c}`, base + i, base + i + 1));
            }
            i += 1;
            lastWasOp = false;
            seenOperand = true;
            continue;
        }
        if (c === "|") {
            const top = stack[stack.length - 1];
            if (top && top.ch === "|") {
                stack.pop();
                lastWasOp = false;
                seenOperand = true;
            } else {
                stack.push({ ch: "|", at: base + i });
                lastWasOp = false;
            }
            i += 1;
            continue;
        }
        if (c === "@") {
            let j = i + 1;
            while (j < n && /[0-9a-zA-Z]/.test(src[j])) j += 1;
            const code = src.slice(i + 1, j);
            if (!TMATH_CODES.has(code) && !(knownCodes && knownCodes[code])) {
                out.push(diag(`未知符号短码 @${code}`, base + i, base + j));
            }
            i = j;
            seenOperand = true;
            lastWasOp = false;
            continue;
        }
        if (isTmathOperandStart(c)) {
            let j = i;
            while (j < n && isTmathOperandStart(src[j])) j += 1;
            i = j;
            seenOperand = true;
            lastWasOp = false;
            continue;
        }
        out.push(diag(`无法识别的字符 '${c}'`, base + i, base + i + 1));
        i += 1;
    }
    while (stack.length) {
        const t = stack.pop();
        out.push(diag(t.ch === "|" ? "绝对值缺少收尾 |" : `缺少 ${t.ch === "(" ? ")" : "]"}`, t.at, t.at + 1));
    }
    if (lastWasOp) {
        out.push(diag("公式以运算符结尾", base + Math.max(0, n - 1), base + n));
    }
}

const BLOCKS = {
    doc: { arity: [2, 2], doc: '文档头：`["doc", "标题"]`，必须是首块且只出现一次。' },
    include: { arity: [2, 2], doc: '包含另一个文档片段：`["include", "ch09.tdoc"]`。装载期展开，相对当前文件解析，禁环，最多 16 层；被包含文件是 blocks 数组或含 blocks 的文档表。' },
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
    mathsym: { arity: [4, 4], doc: '声明公式符号：`["mathsym", "R", "ℝ", "mathbb{R}"]`（短码、字形、LaTeX 名）。声明后 @R 在全文可用。' },
    mathfn: { arity: [2, 2], doc: '声明直立函数名：`["mathfn", "erf"]`。声明后 erf(x) 按已知函数排版，不再视为未知。' },
    math: { arity: [2, 2], doc: '公式：`["math", "sum_(i=1)^n a_i"]`。语法见 tmath：`@a` 短码、`/` 分式、`//` 行内斜线、大运算符只吃乘性项。docx 出 OMML，PDF 暂以纯文本退化。' },
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
            let total = 0;
            widths.items.forEach((w) => {
                if (w.kind !== 'number' || !Number.isFinite(w.value) || w.value < 0) {
                    out.push(diag('列宽必须是非负整数（twips）', w.start, w.end));
                } else {
                    total += w.value;
                }
            });
            if (total > 9020) {
                out.push(diag(`列宽合计 ${total} twips 超过版心（451pt = 9020 twips），表格会被截断`,
                    widths.start, widths.end, 'warning'));
            }
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
        return { diagnostics, symbols, folds, blocks: 0, imgs: [] };
    }
    if (root.kind !== 'map') {
        diagnostics.push(diag('文档根必须是表：`["title": …, "blocks": [ … ]]`', root.start, root.end));
        return { diagnostics, symbols, folds, blocks: 0 };
    }
    const title = root.entries.find((e) => e.key === 'title');
    const blocksEntry = root.entries.find((e) => e.key === 'blocks');
    if (!title) diagnostics.push(diag('缺少 "title": "文档标题"', root.start, root.end, 'warning'));
    if (!blocksEntry || !blocksEntry.value || blocksEntry.value.kind !== 'array') {
        diagnostics.push(diag('缺少 "blocks": [ … ] 数组', root.start, root.end));
        return { diagnostics, symbols, folds, blocks: 0 };
    }
    const blocks = blocksEntry.value;
    const seen = Object.create(null);
    checkBlocks(blocks.items, diagnostics, seen);

    // mathsym/mathfn：收集声明（编辑器侧符号表扩展）
    const declared = {};
    blocks.items.forEach((blk) => {
        if (!blk || blk.kind !== "array" || blk.items.length < 2) return;
        const head = blk.items[0];
        if (!head || head.kind !== "string") return;
        if (head.value === "mathsym" && blk.items.length >= 2) {
            const cd = blk.items[1];
            if (cd && cd.kind === "string") declared[cd.value] = true;
        }
    });

    // math 块：公式文本做轻量校验
    blocks.items.forEach((blk) => {
        if (!blk || blk.kind !== "array" || blk.items.length < 2) return;
        const head = blk.items[0];
        const textNode = blk.items[1];
        if (!head || head.kind !== "string" || head.value !== "math") return;
        if (!textNode || textNode.kind !== "string") return;
        const before = textNode.value;
        const mathDiags = [];
        checkMathText(before, textNode.start + 1, mathDiags, declared);
        mathDiags.forEach((d) => diagnostics.push(d));
    });

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
    return { diagnostics, symbols, folds, blocks: blocks.items.length, imgs: imgPaths(blocks.items), declared };
}

/**
 * 只重排缩进：按「开括号所在行的缩进 + 4」对齐，字符串内部（含代码块）逐字保留。
 * 这样 `["ul", [` 这种把两个括号写在一行的写法也只多缩一级，符合现有文档的风格。
 * @param {string} text
 * @param {number} [unit]
 * @returns {string}
 */
function reindent(text, unit) {
    const step = unit || 4;
    const lines = text.split('\n');
    const stack = [];
    const out = [];
    let inStr = false;
    for (const line of lines) {
        if (inStr) {
            out.push(line);
            inStr = scanInto(line, 0, stack, step, true);
            continue;
        }
        const trimmed = line.trim();
        if (!trimmed) {
            out.push('');
            continue;
        }
        let lead = 0;
        while (lead < trimmed.length && (trimmed[lead] === ']' || trimmed[lead] === '}')) {
            lead += 1;
            stack.pop();
        }
        const indent = stack.length ? stack[stack.length - 1] + step : 0;
        out.push(' '.repeat(indent) + trimmed);
        inStr = scanInto(trimmed, lead, stack, step, false, indent);
    }
    return out.join('\n');
}

/**
 * 扫描一行里剩余部分：开括号入栈（记录本行缩进），闭括号出栈；返回行末是否在字符串内。
 * @param {string} line
 * @param {number} from
 * @param {number[]} stack
 * @param {number} step
 * @param {boolean} startInStr
 * @param {number} [indent]
 */
function scanInto(line, from, stack, step, startInStr, indent) {
    let inStr = startInStr;
    const myIndent = indent === undefined ? (stack.length ? stack[stack.length - 1] + step : 0) : indent;
    for (let i = from; i < line.length; i += 1) {
        const c = line[i];
        if (inStr) {
            if (c === '\\') {
                const e = line[i + 1];
                if (e === undefined) break;      // 字符串延续到下一行
                i += 1;
                continue;
            }
            if (c === '"') inStr = false;
            continue;
        }
        if (c === '/' && line[i + 1] === '/') break;
        if (c === '"') {
            inStr = true;
            continue;
        }
        if (c === '[' || c === '{') {
            stack.push(myIndent);
        } else if (c === ']' || c === '}') {
            stack.pop();
        }
    }
    return inStr;
}


/** 判断某个偏移是否落在字符串里（写代码块的 here-doc 也算）。 */
function stateAt(text, offset) {
    const { tokens } = tokenize(text);
    for (const t of tokens) {
        if (t.type === 'string' && offset > t.start && offset < t.end) return { inString: true };
    }
    return { inString: false };
}

/**
 * 重排章节号：只处理已有编号的标题（h1「第 N 章」、h2/h3「N.M…」），
 * 连同「见 9.2」「参见 5.10」这类引用一起改写。没有编号的标题不动。
 * @param {string} text
 * @returns {{text: string, changes: number}}
 */
function renumber(text) {
    const { root } = parse(text);
    if (!root || root.kind !== 'map') return { text, changes: 0 };
    const be = root.entries.find((e) => e.key === 'blocks');
    if (!be || !be.value || be.value.kind !== 'array') return { text, changes: 0 };
    const blocks = be.value.items;
    const edits = [];
    const map = new Map();
    let h1 = 0;
    let h2 = 0;
    let h3 = 0;
    let hits = 0;

    for (const blk of blocks) {
        if (!blk || blk.kind !== 'array' || blk.items.length < 2) continue;
        const k = blk.items[0];
        const t = blk.items[1];
        if (!k || k.kind !== 'string' || !t || t.kind !== 'string') continue;
        if (!/^h[123]$/.test(k.value)) continue;
        const cur = t.value;
        let m = null;
        let target = '';
        let oldLabel = '';
        let newLabel = '';
        if (k.value === 'h1') {
            m = /^第\s*(\d+)\s*章(\s*)/.exec(cur);
            h1 += 1; h2 = 0; h3 = 0;
            if (!m) continue;
            target = `第 ${h1} 章` + m[2];
            oldLabel = `第 ${m[1]} 章`;
            newLabel = `第 ${h1} 章`;
        } else if (k.value === 'h2') {
            m = /^(\d+(?:\.\d+)*)(\s+)/.exec(cur);
            if (!m || h1 === 0) continue;
            h2 += 1; h3 = 0;
            target = `${h1}.${h2}` + m[2];
            oldLabel = m[1];
            newLabel = `${h1}.${h2}`;
        } else {
            m = /^(\d+(?:\.\d+)*)(\s+)/.exec(cur);
            if (!m || h1 === 0) continue;
            h3 += 1;
            target = `${h1}.${h2}.${h3}` + m[2];
            oldLabel = m[1];
            newLabel = `${h1}.${h2}.${h3}`;
        }
        hits += 1;
        if (oldLabel !== newLabel) map.set(oldLabel, newLabel);
        if (target !== m[0]) {
            edits.push({ start: t.start + 1, end: t.start + 1 + m[0].length, text: target });
        }
    }
    if (!map.size && !edits.length) return { text, changes: 0 };

    // 引用：见 / 参见 + 旧编号
    const fixRefs = (node) => {
        if (!node || node.kind !== 'string') return;
        const v = node.value;
        const re = /(见|参见)\s*(\d+(?:\.\d+)*)/g;
        let mm;
        while ((mm = re.exec(v)) !== null) {
            const to = map.get(mm[2]);
            if (to) {
                const start = node.start + 1 + mm.index + mm[1].length;
                const end = start + (mm[0].length - mm[1].length);
                edits.push({ start, end, text: /\s/.test(mm[0].slice(mm[1].length)) ? ` ${to}` : to });
            }
        }
    };
    for (const blk of blocks) {
        if (!blk || blk.kind !== 'array' || !blk.items.length) continue;
        const head = blk.items[0];
        if (!head || head.kind !== 'string') continue;
        const kind = head.value;
        if (/^(p|note|quote|cap)$/.test(kind)) {
            fixRefs(blk.items[1]);
        } else if (kind === 'ul' || kind === 'ol') {
            const arr = blk.items[1];
            if (arr && arr.kind === 'array') arr.items.forEach(fixRefs);
        } else if (kind === 'tbl' || kind === 'tblw') {
            blk.items.slice(1, kind === 'tblw' ? -1 : undefined).forEach((row) => {
                if (row && row.kind === 'array') row.items.forEach(fixRefs);
            });
        }
    }
    if (!edits.length) return { text, changes: hits };
    edits.sort((a, b) => b.start - a.start);
    let out = text;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return { text: out, changes: edits.length };
}


/** tdoc 字符串转义（换行只允许出现在代码块里）。 */
function escapeText(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
}

/** 行内标记 → para 的 run 列表；没有标记时返回 null（用 p）。 */
function inlineRuns(s) {
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    const runs = [];
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
        if (m.index > last) runs.push(s.slice(last, m.index));
        const t = m[0];
        if (t.startsWith('**')) runs.push('b|' + t.slice(2, -2));
        else if (t.startsWith('`')) runs.push('m|' + t.slice(1, -1));
        else if (t.startsWith('[')) {
            const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t);
            runs.push('link|' + mm[1] + '|' + mm[2]);
        } else runs.push('i|' + t.slice(1, -1));
        last = m.index + t.length;
    }
    if (last < s.length) runs.push(s.slice(last));
    if (runs.length === 1 && !/^[bim]|link\|/.test(runs[0])) return null;
    return runs;
}

/**
 * Markdown → tdoc（单向转换，不引入新格式）。
 * 覆盖：标题、段落、行内强调/代码/链接、列表、引用、代码围栏、管道表格、图片、分隔线。
 * @param {string} md
 * @param {string} [fallbackTitle]
 * @returns {{title: string, text: string}}
 */
function mdToTdoc(md, fallbackTitle) {
    const src = md.replace(/\r\n/g, '\n');
    let lines = src.split('\n');
    // 去掉 YAML front matter
    if (lines[0] === '---') {
        const end = lines.indexOf('---', 1);
        if (end > 0) lines = lines.slice(end + 1);
    }
    const blocks = [];
    let title = '';
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i += 1; continue; }
        // 代码围栏
        const fence = /^```(\w*)\s*$/.exec(line);
        if (fence) {
            const lang = fence[1] || 'tie';
            i += 1;
            const buf = [];
            while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i += 1; }
            i += 1;
            blocks.push({ k: 'code', lang, body: buf.join('\n') });
            continue;
        }
        // 标题
        const h = /^(#{1,3})\s+(.*)$/.exec(line);
        if (h) {
            const lv = h[1].length;
            const text = h[2].trim();
            if (lv === 1 && !title) title = text;
            blocks.push({ k: 'h' + lv, text });
            i += 1;
            continue;
        }
        // 分隔线
        if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { blocks.push({ k: 'hr' }); i += 1; continue; }
        // 图片（独占一行）
        const img = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
        if (img) { blocks.push({ k: 'img', src: img[2], alt: img[1] }); i += 1; continue; }
        // 管道表格：表头 + 分隔行
        if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
            const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
            const head = cells(line);
            i += 2;
            const rows = [];
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
            blocks.push({ k: 'tblw', head, rows });
            continue;
        }
        // 引用
        if (/^\s*>\s?/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                buf.push(lines[i].replace(/^\s*>\s?/, ''));
                i += 1;
            }
            blocks.push({ k: 'quote', text: buf.join(' ') });
            continue;
        }
        // 列表
        const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
        const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
        if (ul || ol) {
            const items = [];
            const isUl = Boolean(ul);
            while (i < lines.length) {
                const m2 = isUl ? /^\s*[-*+]\s+(.*)$/.exec(lines[i]) : /^\s*\d+\.\s+(.*)$/.exec(lines[i]);
                if (!m2) break;
                items.push(m2[1].trim());
                i += 1;
            }
            blocks.push({ k: isUl ? 'ul' : 'ol', items });
            continue;
        }
        // 段落：合并到空行/下一个块
        const buf = [line.trim()];
        i += 1;
        while (i < lines.length) {
            const l = lines[i];
            if (!l.trim()) break;
            if (/^(#{1,3})\s|^```|^\s*[-*+]\s|^\s*\d+\.\s|^\s*>|^\s*\|/.test(l)) break;
            if (/^\s*!\[/.test(l) || /^\s*(---+|\*\*\*+|___+)\s*$/.test(l)) break;
            buf.push(l.trim());
            i += 1;
        }
        const text = buf.join(' ');
        const runs = inlineRuns(text);
        if (runs) blocks.push({ k: 'para', runs });
        else blocks.push({ k: 'p', text });
    }

    const esc = (x) => escapeText(x);
    const out = [];
    out.push('// 由 Markdown 转换（单向；改稿请以本文件为准）');
    out.push('[');
    out.push(`    "title": "${esc(title || fallbackTitle || '未命名文档')}",`);
    out.push('    "blocks": [');
    for (const b of blocks) {
        if (b.k === 'p' || b.k === 'quote') out.push(`        ["${b.k}", "${esc(b.text)}"],`);
        else if (/^h[1-3]$/.test(b.k)) out.push(`        ["${b.k}", "${esc(b.text)}"],`);
        else if (b.k === 'ul' || b.k === 'ol') {
            out.push(`        ["${b.k}", [` + b.items.map((x) => `"${esc(x)}"`).join(', ') + ']],');
        } else if (b.k === 'para') {
            out.push('        ["para", ' + b.runs.map((x) => `"${esc(x)}"`).join(', ') + '],');
        } else if (b.k === 'code') {
            out.push(`        ["code", "${b.lang}", "`);
            out.push(b.body);
            out.push('"],');
        } else if (b.k === 'tblw') {
            const cols = b.head.length;
            const base = Math.floor(9020 / cols);
            const widths = new Array(cols).fill(base);
            widths[cols - 1] = 9020 - base * (cols - 1);
            out.push('        ["tblw",');
            out.push('            [' + b.head.map((x) => `"${esc(x)}"`).join(', ') + '],');
            b.rows.forEach((r) => {
                const cells = r.slice(0, cols);
                while (cells.length < cols) cells.push('');
                out.push('            [' + cells.map((x) => `"${esc(x)}"`).join(', ') + '],');
            });
            out.push('            [' + widths.join(', ') + ']],');
        } else if (b.k === 'img') {
            out.push(`        ["img", "${esc(b.src)}", 0, "${esc(b.alt)}"],`);
        } else if (b.k === 'hr') {
            out.push('        ["hr"],');
        }
    }
    out.push('    ],');
    out.push(']');
    return { title: title || fallbackTitle || '未命名文档', text: out.join('\n') + '\n' };
}

/** 光标处（或其前）的 @ 符号查询：返回 {code, glyph, name, start, end} 或 null。 */
function mathCodeAt(src, offset) {
    const end = Math.min(offset, src.length);
    let start = end;
    while (start > 0 && /[0-9a-zA-Z]/.test(src[start - 1])) start -= 1;
    if (start === 0 || src[start - 1] !== "@") return null;
    const code = src.slice(start, end);
    const info = TMATH_SYMBOLS[code];
    if (!info) return null;
    return { code, glyph: info[0], name: info[1], start: start - 1, end };
}

/** img 块的路径列表（供存在性检查）。 */
function imgPaths(blocks) {
    const out = [];
    blocks.forEach((blk) => {
        if (!blk || blk.kind !== "array" || blk.items.length < 2) return;
        const head = blk.items[0];
        const p = blk.items[1];
        if (!head || head.kind !== "string" || head.value !== "img") return;
        if (!p || p.kind !== "string") return;
        out.push({ path: p.value, start: p.start, end: p.end });
    });
    return out;
}

module.exports = { BLOCKS, KIND_LIST, tokenize, parse, analyze, reindent, stateAt, renumber, mdToTdoc, TMATH_SYMBOLS, mathCodeAt, imgPaths };
