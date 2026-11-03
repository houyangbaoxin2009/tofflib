'use strict';
// 核心分析器的冒烟测试：node test/test.js [某个 .tdoc 路径]
// 不依赖 vscode，可在任何装有 node 的机器上跑。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../src/tdoc.js');

let failed = 0;
function check(name, fn) {
    try {
        fn();
        console.log('ok   ' + name);
    } catch (e) {
        failed += 1;
        console.log('FAIL ' + name + ' :: ' + e.message);
    }
}

check('最小文档无诊断', () => {
    const text = '[\n  "title": "t",\n  "blocks": [\n    ["h1", "标题"],\n    ["p", "正文"],\n  ],\n]\n';
    const r = core.analyze(text);
    assert.strictEqual(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
    assert.strictEqual(r.symbols.length, 1);
});

check('未知块', () => {
    const r = core.analyze('["title": "t", "blocks": [["hx", "x"]]]');
    assert.ok(r.diagnostics.some((d) => /未知块/.test(d.message)));
});

check('块参数个数', () => {
    const r = core.analyze('["title": "t", "blocks": [["h1"]]]');
    assert.ok(r.diagnostics.some((d) => /需要 2 个元素/.test(d.message)));
});

check('字符串未闭合', () => {
    const r = core.analyze('["title": "t", "blocks": [["p", "abc]]');
    assert.ok(r.diagnostics.some((d) => /未闭合/.test(d.message)));
});

check('表格列数不一致', () => {
    const r = core.analyze('["title": "t", "blocks": [["tbl", ["a", "b"], ["1"]]]]');
    assert.ok(r.diagnostics.some((d) => /列/.test(d.message)));
});

check('tblw 列宽个数', () => {
    const r = core.analyze('["title": "t", "blocks": [["tblw", ["a", "b"], ["1", "2"], [3000]]]]');
    assert.ok(r.diagnostics.some((d) => /列宽/.test(d.message)));
});

check('here-doc 代码块保留缩进', () => {
    const text = '["title": "t", "blocks": [["code", "tie", "\nfunc f() {\n    return 1\n}\n"]]]';
    const r = core.analyze(text);
    assert.strictEqual(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
});

check('列宽合计超版心', () => {
    const r = core.analyze('["title": "t", "blocks": [["tblw", ["a", "b"], ["1", "2"], [9000, 9000]]]]');
    assert.ok(r.diagnostics.some((d) => /版心/.test(d.message)));
});

check('重排缩进幂等', () => {
    const text = '[\n "title": "t",\n "blocks": [\n ["h1", "A"],\n ["ul", [\n "x",\n "y",\n ]],\n ],\n]\n';
    const once = core.reindent(text);
    assert.strictEqual(core.reindent(once), once);
    assert.ok(once.includes('        ["h1", "A"],'));
});

check('缩进不碰代码块内容', () => {
    const text = '[\n    "title": "t",\n    "blocks": [\n        ["code", "tie", "\nfunc f() {\n    return 1\n}\n"],\n    ],\n]\n';
    assert.strictEqual(core.reindent(text), text);
});

check('Markdown 转换', () => {
    const md = '# 章\n\n**粗** 与 `码`\n\n- 甲\n\n```tie\nfunc f() {}\n```\n';
    const r = core.mdToTdoc(md, 't');
    assert.ok(r.text.includes('["h1", "章"]'), r.text);
    assert.ok(r.text.includes('["para"'), r.text);
    assert.ok(r.text.includes('["code", "tie", "'), r.text);
    assert.ok(core.analyze(r.text).diagnostics.length === 0);
});

check('重排章节号（含引用）', () => {
    const text = '[\n  "title": "t",\n  "blocks": [\n    ["h1", "第 1 章  A"],\n    ["h2", "1.1  B"],\n    ["p", "见 3.7"],\n    ["h1", "第 3 章  C"],\n    ["h2", "3.7  D"],\n  ],\n]\n';
    const r = core.renumber(text);
    assert.ok(r.text.includes('"第 2 章  C"'), r.text);
    assert.ok(r.text.includes('"2.1  D"'), r.text);
    assert.ok(r.text.includes('见 2.1'), r.text);
});

check('大纲层级', () => {
    const text = '["title": "t", "blocks": [["h1", "A"], ["h2", "B"], ["h1", "C"]]]';
    const r = core.analyze(text);
    assert.deepStrictEqual(r.symbols.map((s) => s.level + s.name), ['1A', '2B', '1C']);
});

// 可选：对真实文档做一次全量校验
const real = process.argv[2];
if (real) {
    check('真实文档：' + path.basename(real), () => {
        const text = fs.readFileSync(real, 'utf8');
        const r = core.analyze(text);
        assert.strictEqual(r.diagnostics.length, 0,
            r.diagnostics.slice(0, 3).map((d) => d.message).join(' | '));
        assert.ok(r.symbols.length > 0);
    });
}

if (failed) {
    console.error(`\n${failed} 项失败`);
    process.exit(1);
}
console.log('\n全部通过');
