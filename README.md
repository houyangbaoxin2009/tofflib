# tofflib —— 用 tie 语言的办公工具库

> TIE Office Toolkit：一套用 [tie 语言](https://github.com/houyangbaoxin2009/tie) 编写的**办公场景**工具库。
> 让纯函数、零 unsafe、命名空间组织的 tie 代码，直接生成 Word 文档、公式、绘图与日常办公文本。

## 定位

tofflib 的使命是把 **tie 用作办公脚本**：
写 `.tie` 文件，用 `tiec` 编译运行，一键产出 docx/OOXML 文档骨架、Word 公式（OMML）、
原生绘图（VML）的 **XML 字符串**，以及对齐文本表格、CSV、待办清单等办公文本。

每个模块都是 `type tie<class>` 的库文件（编译为静态库 `.a`），纯函数、零 unsafe、
零外部运行时依赖，只依赖 tie 底座原语（`str_len`/`str_char`/`len`/`table` +
`string_builder`）。循环拼接统一走 StringBuilder（O(n)），碎片拼装用 `+`。

> 对外推荐入口是门面 `src/tofflib.tie`：把文档写成 **tdoc 文档源**（`tie:data`），
> 由门面装载成扁平块流，再渲染成 **docx / xlsx / pptx / pdf** 四份产物。
> 底层 XML 生成器（`docx`/`omml`/`vml`/`ooxml`/`xlsx`/`pptx`）与 PDF 引擎（`pdf`/`pdf_asm`/`pdf_ttf`）
> 保留为内部/高级用法：它们多数只产字符串，由上层负责写盘。

## 模块清单

| 模块            | 命名空间       | 职责                                                        | 编译产物      |
| --------------- | ----------- | --------------------------------------------------------- | --------- |
| `office/docx.tie` | `docx`      | Word 文档骨架：段落/run/字体、标题/列表/分页/页码、表格，组装成 OOXML 文档正文 XML  | `docx.a`  |
| `xml/omml.tie`  | `omml`      | Word 公式：OMML 结构生成器（分数/上下标/定界符/n-ary 求和积分）        | `omml.a`  |
| `xml/vml.tie`   | `vml`       | Word 原生绘图：VML 形状组/矩形+文本框/带箭头直线                    | `vml.a`   |
| `office/officeutil.tie` | `officeutil` | 日常办公：日期时间、CSV/对齐表格文本、待办清单、编号列表                | `officeutil.a` |
| `xml/ooxml.tie` | `ooxml`     | 端到端 docx 打包：OOXML 包装配 + 纯 tie ZIP 写入器（store 免压缩）     | `ooxml.a`  |
| `office/xlsx.tie` | `xlsx`      | Excel 电子表格：SpreadsheetML 装配（单元格/冻结行/列宽/多 sheet）     | `xlsx.a`  |
| `office/pptx.tie` | `pptx`      | PowerPoint 演示：PresentationML 装配（主题/母版/布局/幻灯片/关系）    | `pptx.a`  |
| `src/doc/td.tie`    | `td`    | tie:data 文档源解析器（值/数组/表/转义/错误定位）                 | `td.a`    |
| `src/doc/model.tie` | `doc`   | 扁平块流模型：构建器 + 校验（tdoc v2 协议）                       | `model.a` |
| `src/doc/load.tie`  | `doc`   | td 文档源 → 块流装载（表格/列表/代码/封面/目录）                  | `load.a`  |
| `src/doc/render.tie`| `doc`   | 块流 → docx / xlsx / pptx / pdf 四后端（PDF 只做块流映射，排版委托 pdfdoc） | `render.a`|
| `src/doc/pdfdoc.tie`| `pdfdoc`| 报告排版层：自动换行/分页、标题层级、代码块高亮、目录与页码（PDF 后端复用） | `pdfdoc.a`|
| `src/tofflib.tie`   | `tofflib` | 对外门面：文档构建 + 装载 + 四后端渲染                          | `tofflib.a`|

## 快速开始（门面 + tdoc 源）

```bash
# 编译门面示例（工作目录 = tofflib 根）
tiec examples/hello.tie -o target/hello.exe --no-cache
target/hello.exe        # 装载 examples/hello.tdoc，产出四份产物到 target/

# 需要环境变量指向 trm-lite 运行时
export TIE_TRM_LITE_LIB=F:/Projects/tie-repo/trm-lite/target/trm_lite.a
```

文档源 `examples/hello.tdoc` 是 `tie:data`：

```tie
[
    "title": "tofflib 示例",
    "blocks": [
        ["h1", "第一章 入门"],
        ["p", "这份文档来自 td 文档源。"],
        ["ul", ["第一条", "第二条"]],
        ["tbl", ["能力", "状态"], ["表格", "已支持"], ["代码块", "已支持"]],
        ["code", "tie", "pub func main() -> i64 {\n    return 0\n}"],
        ["page"],
    ],
]
```

代码侧只有三行：

```tie
import "../src/tofflib.tie" as tl
var d: table<string> = []
var err = tl.load_file("examples/hello.tdoc", d)   // 空串 = 成功
tl.pdf("target/hello.pdf", d, "C:/Windows/Fonts/NotoSansSC-VF.ttf", "C:/Windows/Fonts/consola.ttf")
```

## 稳定性边界

`tofflib` 命名空间（`src/tofflib.tie`）是对外稳定契约。`doc/*` 与各模块命名空间
（`docx`、`pdf`、`pdf_asm`、`pdf_ttf`、`ooxml`、`xlsx`、`pptx`、`omml`、`vml`、
`officeutil`）属内部实现：tie 无 `private`，只能靠命名空间约定与门面收口。外部代码
只调 `tofflib.*`；内部跨模块改签名时须同步更新门面与 `examples/probe.tie`。

## 快速开始（底层模块）

```bash
# 编译单个模块（class 库 → 静态库）
tiec src/docx.tie          # → docx.a
tiec src/omml.tie          # → omml.a
tiec src/vml.tie           # → vml.a
tiec src/officeutil.tie    # → officeutil.a
tiec src/ooxml.tie         # → ooxml.a

# 冒烟验证：编译并运行 probe
tiec examples\probe.tie -o examples\probe.exe
examples\probe.exe      # 打印 OK 断言 + 组装示例，exit 0 即通过

# 端到端：生成真实 .docx（标题/列表/表格/分页/页码）
tiec examples\gen_docx.tie -o examples\gen_docx.exe
examples\gen_docx.exe   # → demo.docx，双击可用 Word 打开
```

写一个带格式的文档骨架（逻辑程序）：

```tie
type tie<logic>
import "./docx.tie" as dx
import "./officeutil.tie" as ou

func main() {
    var doc = dx.root_open() +
        dx.paragraph_runs([dx.run_font("周报", "宋体", 22, true)]) +
        dx.tbl([[ou.fmt_date(2026,8,30), "进行中"]], [], 3000) +
        dx.root_close()
    file_write("out.xml", doc)
    println("已生成文档正文 XML")
}
```

> 注意：`paragraph(txt)` 接收的是**纯文本**（内部自动 run + 转义）；要插入已组装的
> 格式 run，用 `paragraph_runs([...])`，不要把 `run_font(...)` 的输出再塞进 `paragraph()`。
> `link()`/`page_break()` 等返回**完整段落**的块，不可再包进 `para_ex()`/`para_center()`
> （否则出现 `<w:p><w:p>` 嵌套，Word 拒绝打开）。

## 真机验证（Microsoft Office COM）

用本机 Office（Word/Excel COM）打开了 tofflib 生成的真实文件：

| 文件 | 来源 | Word | Excel |
| ---- | ---- | ---- | ----- |
| `demo.docx`（列表/表格/代码块/链接/分节） | `gen_docx.tie`（门面） | ✅ | - |

真机验证发现并修复：① `toc()`/`caption()` 的域占位文本曾漏包 `<w:r>`
（`<w:t>` 直接挂 `<w:p>` 下，schema 违规，Word 拒开）——现已包裹；② 示例中用
`para_ex()` 包 `link()` 造成段落嵌套——用法已修正。
pptx 说明：PowerPoint COM 打开仍报 `0x80070570`（文件损坏），微软 PowerPoint
对 PresentationML 包要求严格；本机环境以结构校验（ZipFile + XML well-formed）为准，
**待 LibreOffice 真机复核**（ODF 后端落地后一起验证）。docx/xlsx 已通过微软
Office COM 真机验证。
LibreOffice 未安装（需管理员权限，UAC 未批准）；本机以 Office COM 做真机校验，
ODF 后端落地后再装 LibreOffice 验证 ODF。

## 各模块公开接口

### docx（`docx.tie`）

| 函数            | 签名                                                                            | 说明                          |
| ------------ | ----------------------------------------------------------------------------- | --------------------------- |
| `escape`     | `escape(txt: string) -> string`                                                | XML 转义 `&` `<` `>`            |
| `run`        | `run(txt: string) -> string`                                                   | 单个文本 run `<w:r><w:t>`        |
| `run_font`   | `run_font(txt, font: string, size_half_points: i64, bold: bool) -> string`      | 带格式 run（字体/字号/加粗）回用            |
| `paragraph`  | `paragraph(txt: string) -> string`                                             | 单 run 段落 `<w:p>`              |
| `paragraph_runs` | `paragraph_runs(runs_table: table<string>) -> string`                         | 多 run 组装一个段落                 |
| `heading`    | `heading(txt: string, level: i64) -> string`                                  | 标题段落（引用内置样式 Heading1..9）       |
| `bullet`     | `bullet(txt: string, level: i64) -> string`                                   | 无序列表项（numId=1，ilvl 层级）        |
| `number`     | `number(txt: string, level: i64) -> string`                                   | 有序列表项（numId=2）               |
| `bullets`    | `bullets(txts: table<string>, level: i64) -> string`                          | 整组无序列表（多行拼接）                 |
| `numbers`    | `numbers(txts: table<string>, level: i64) -> string`                          | 整组有序列表（多行拼接）                 |
| `page_break` | `page_break() -> string`                                                      | 分页符段落 `<w:br w:type="page"/>`  |
| `page_field` | `page_field() -> string`                                                      | 页码域 run 序列（PAGE，入页眉/页脚）        |
| `header_para`| `header_para(children: table<string>) -> string`                              | 页眉部件内容 `<w:hdr>`（供 ooxml 装配）    |
| `footer_para`| `footer_para(children: table<string>) -> string`                              | 页脚部件内容 `<w:ftr>`                |
| `para_center`| `para_center(children: table<string>) -> string`                              | 居中段落（如页脚页码）                   |
| `para_right` | `para_right(children: table<string>) -> string`                               | 右对齐段落                         |
| `para_ex`    | `para_ex(children: table<string>, align: string, before, after, left_indent: i64) -> string` | 通用段落（对齐/段前段后/左缩进）       |
| `link`       | `link(txt, url, tooltip: string) -> string`                                  | 超链接（HYPERLINK 域，无需 rels）       |
| `run_color`  | `run_color(txt: string, hex_color: string) -> string`                        | 带前景色 run（`w:color`）              |
| `theme`      | `theme(name: string) -> string`                                              | Office 默认主题色（accent1-6/dark1-2/light1-2） |
| `sect_a4`    | `sect_a4() -> string`                                                         | 节属性：A4 纵向 + 常用边距              |
| `sect_page`  | `sect_page(pg_w_twips, pg_h_twips, top, right, bottom, left: i64) -> string`  | 自定义页面宽高与边距（twips）            |
| `tbl`        | `tbl(rows: table<table<string>>, header: table<string>, col_width_twips: i64) -> string` | 组装表格（默认全单线边框 + 可加粗表头）   |
| `tbl_borders`| `tbl_borders(sz: i64, color: string) -> string`                               | 自定义表格边框（线宽/颜色）               |
| `tbl_full`   | `tbl_full(rows, header: table<table<string>>, grid_widths_twips: table<i64>, tbl_width_twips: i64) -> string` | 高级表格：tblGrid 列宽、tblHeader 跨页重复，单元格用 tc 系列片段 |
| `tc`         | `tc(txt: string, span: i64, shade: string, align: string) -> string`         | 单元格（合并 span / 底纹 shade / 水平对齐）  |
| `tchead`     | `tchead(txt: string, span: i64, shade: string, align: string) -> string`     | 加粗单元格（表头常用）                   |
| `tc_w`       | `tc_w(txt: string, w_twips: i64) -> string`                                  | 定宽单元格（tcW，精确列宽）              |
| `toc`        | `toc(levels_from, levels_to: i64, placeholder: string) -> string`           | 自动目录（fldSimple TOC 域，收录 Heading 层级） |
| `caption`    | `caption(txt, seq_label: string) -> string`                                 | 题注（文本 + SEQ 自动编号域）           |
| `xref`       | `xref(bookmark_name, placeholder: string) -> string`                        | 交叉引用域（REF，指向书签）             |
| `bookmark_start` | `bookmark_start(name: string, id: i64) -> string`                        | 书签开始（锚点供 xref 引用）            |
| `bookmark_end`   | `bookmark_end(id: i64) -> string`                                        | 书签结束                        |
| `root_open`  | `root_open() -> string`                                                       | 文档根打开（`<w:document><w:body>`） |
| `root_close` | `root_close() -> string`                                                      | 文档根关闭                        |

### omml（`omml.tie`）

| 函数         | 签名                                                                        | 说明                             |
| ---------- | ------------------------------------------------------------------------- | ------------------------------ |
| `escape`   | `escape(txt: string) -> string`                                            | XML 转义                         |
| `r`        | `r(txt: string) -> string`                                                 | 数学文本 run `<m:r><m:t>`          |
| `raw`      | `raw(frag: string) -> string`                                              | 原样片段（转不转义由调用方决定）               |
| `inline`   | `inline(parts: table<string>) -> string`                                   | 行内公式 `<m:oMath>`              |
| `omath_para` | `omath_para(parts: table<string>) -> string`                              | 整段公式 `<m:oMathPara>`           |
| `frac`     | `frac(numerator: string, den: string) -> string`                          | 分数 `<m:f><m:num><m:den>`        |
| `ssub`     | `ssub(base: string, sub: string) -> string`                                 | 下标 `<m:sSub>`                  |
| `ssup`     | `ssup(base: string, sup: string) -> string`                                 | 上标 `<m:sSup>`                  |
| `ssubsup`  | `ssubsup(base, sub, sup: string) -> string`                               | 同时上下标 `<m:sSubSup>`           |
| `delimit`  | `delimit(inner: string, beg: string, end: string) -> string`               | 定界符（括号包裹）`<m:d>`              |
| `nary`     | `nary(op, sub, sup, inner: string) -> string`                             | 通用 n-ary 算子（∑ ∫ ∏ 等）          |
| `sum`      | `sum(sub, sup, inner: string) -> string`                                  | 求和快捷 `∑`                       |
| `prod`     | `prod(sub, sup, inner: string) -> string`                                 | 连乘快捷 `∏`                       |
| `integral` | `integral(sub, sup, inner: string) -> string`                             | 积分快捷 `∫`                       |
| `lim`      | `lim(sub: string, inner: string) -> string`                               | 极限 `lim`（下标在算子下方）              |
| `sqrt`     | `sqrt(inner: string) -> string`                                           | 平方根（度数隐藏）                     |
| `root`     | `root(deg: string, inner: string) -> string`                              | n 次根 `<m:rad>`                 |
| `binom`    | `binom(top: string, bottom: string) -> string`                            | 组合数（无横线堆叠，配合 `delimit` 加括号）   |
| `matrix`   | `matrix(rows: table<table<string>>) -> string`                            | 矩阵 `<m:m>`（列居中，自动列数）          |
| `bar`      | `bar(inner: string) -> string`                                            | 上划线（共轭/均值）`<m:bar>`          |

### vml（`vml.tie`）

| 函数       | 签名                                                                         | 说明                                |
| -------- | -------------------------------------------------------------------------- | --------------------------------- |
| `escape` | `escape(txt: string) -> string`                                             | XML 转义                            |
| `group`  | `group(children: table<string>, w: i64, h: i64) -> string`                | 形状组 `<v:group>`（coordorigin/coordsize） |
| `rect`   | `rect(x, y, w, h: i64, txt: string) -> string`                            | 矩形+居中文本（含 `v:textbox`）          |
| `line`   | `line(x1, y1, x2, y2: i64, arrow: string, stroke_w: i64) -> string`       | 直线（`arrow` 可选 `classic/open/block` 端箭头） |
| `textbox` | `textbox(x, y, w, h: i64, txt: string) -> string`                         | 独立文本框（Word 文本框形状）                |

### officeutil（`officeutil.tie`）

| 函数        | 签名                                                                          | 说明                             |
| --------- | --------------------------------------------------------------------------- | ------------------------------ |
| `pad2`    | `pad2(v: i64) -> string`                                                     | 两位补零 `09`                      |
| `fmt_date` | `fmt_date(y, m, d: i64) -> string`                                           | `YYYY-MM-DD`                    |
| `fmt_datetime` | `fmt_datetime(y, m, d, h, mi, s: i64) -> string`                            | `YYYY-MM-DD HH:MM:SS`           |
| `csv_cell` | `csv_cell(c: string, sep: string) -> string`                                 | 单个单元格 CSV 转义（括引翻倍）            |
| `csv_line` | `csv_line(cells: table<string>, sep: string) -> string`                     | 一行 CSV                         |
| `csv_text` | `csv_text(rows: table<table<string>>, sep: string) -> string`               | 二维 → CSV 全文                    |
| `render_table` | `render_table(headers: table<string>, rows: table<table<string>>, col_sep: string, pad: i64) -> string` | 列对齐文本表格（列宽按码点） |
| `todo`     | `todo(title: string, items: table<string>) -> string`                       | Markdown 复选框清单 `- [ ]`          |
| `todo_done` | `todo_done(title: string, items: table<string>) -> string`                  | 勾选版清单 `- [x]`                  |
| `list_items` | `list_items(title: string, items: table<string>) -> string`                 | 数字编号列表 `1. `                  |

> 复用约定：`import "./docx.tie" as dx` 后即用 `dx.xxx(...)` 前缀调用（`import` 别名是唯一入口）。
> 命名约定：`text`、`num`、`table` 是 tie 语言关键字，故函数/参数命名中避开（见各模块头注释）。

### ooxml（`ooxml.tie`）

| 函数          | 签名                                                                         | 说明                                      |
| ----------- | -------------------------------------------------------------------------- | --------------------------------------- |
| `crc32`     | `crc32(s: string) -> i64`                                                   | PKZIP 标准 CRC32（查表法，二进制安全）             |
| `zip_store` | `zip_store(names: table<string>, datas: table<string>) -> string`         | 最小 ZIP 容器（store 不压缩；本地头+中央目录+EOCD）   |
| `docx_parts`| `docx_parts(body_xml: string, footer_page: bool) -> (names, datas: table<string>)` | 装配全部 OOXML 部件（styles/numbering/可选页脚）  |
| `docx_parts_hbf` | `docx_parts_hbf(body_xml, header_xml, footer_xml: string) -> (names, datas: table<string>)` | 装配含页眉/页脚的部件（header1/footer1 按需）   |
| `write_docx`| `write_docx(path: string, body_xml: string, footer_page: bool) -> bool`   | 正文 XML → 真实 .docx 文件（字节表写入，二进制安全）    |
| `write_docx_hbf` | `write_docx_hbf(path, body_xml, header_xml, footer_xml: string) -> bool` | 正文 + 页眉/页脚部件 → .docx 文件             |

> 正文约定：`body_xml` 为 `<w:body>` 内部内容块拼接（段落/表格/列表等），**不含**
> 末尾 `<w:sectPr>`——装配器统一追加末节（A4 或带页眉/页脚引用）；正文中插
> `dx.sect_page(...)` 即产生分节（Word 自动换新页）。
>
> `header_xml`/`footer_xml` 由 `dx.header_para([...])` / `dx.footer_para([...])` 生成；
> 传空串则不带对应部件。`footer_page=true` 等价于默认居中页码页脚
> （`footer_para([page_field()])`）。
>
> `zip_store` 使用 store 方法（不压缩），Office/解压工具均兼容；写盘用底座
> `byte_write`（`file_write` 按 C 字符串在首个 NUL 截断，**不可用于二进制**）。

## PDF 后端（体积与构建开销）

PDF 由 `pdf.tie`（绘制 API）+ `pdf_ttf.tie`（TrueType 解析、GID 排版、子集化）+ `pdf_asm.tie`（对象装配、ToUnicode、xref）三部分组成，输出为纯 tie 实现、无第三方依赖。

体积处理：

* **字体子集嵌入**：只把实际用到的字形（含 `.notdef`、按轮廓闭包补入的组件）写回成新的 sfnt，`loca` 统一为 long 格式，表目录与校验和重算；未用字形占用的 `glyf`/`loca` 空间不再进入 PDF。
* **内容流 Flate 压缩**：页面内容流按页压缩后共享开关（`/Filter /FlateDecode`），压缩结果在 `save()` 内建缓存，避免二次压缩。压缩走 `zlib.compress_fast`——固定 Huffman + 4 KiB 有界回溯 + 命中 32 字节提前停止，牺牲约 2% 体积换取压缩耗时减半。
* **ToUnicode 兼容表意字**：同一个 GID 有多种码点时优先选常规汉字，其次康熙部首/兼容表意字，保证 PDF 文本可复制、可检索。

参考数据（本机、`tie-spec` 77 页 A4 中文规范）：

| 项目 | 优化前 | 优化后 |
| --- | --- | --- |
| PDF 体积 | 19,327,234 B | 828,158 B（23.3×） |
| 构建耗时 | 3.17 s | 2.4 s |
| 峰值工作集 | 1,075.8 MB | 486 MB |

构建耗时包含 1.36 MB 内容流的纯 tie deflate（快速路径约 0.9 s）；体积与内存收益远大于这部分开销。输出对同一输入逐字节确定（SHA-256 前缀 `ff2456f5`）。

## 工程结构

```
tofflib/
├── src/
│   ├── tofflib.tie      # 门面（对外稳定入口）
│   ├── doc/             # tdoc v2：td 解析 / 块流模型 / 装载 / 四后端渲染 / 报告排版
│   │   ├── td.tie
│   │   ├── model.tie
│   │   ├── load.tie
│   │   ├── render.tie
│   │   └── pdfdoc.tie   # 排版层（原 tie-spec 内嵌实现，现已归位）
│   ├── office/          # Word / Excel / PowerPoint 装配（内部）
│   │   ├── docx.tie
│   │   ├── xlsx.tie
│   │   ├── pptx.tie
│   │   └── officeutil.tie
│   ├── xml/             # OOXML 容器与 Word 方言（内部）
│   │   ├── ooxml.tie
│   │   ├── omml.tie
│   │   └── vml.tie
│   └── pdf/             # PDF 底层（内部）
│       ├── pdf.tie
│       ├── pdf_asm.tie
│       └── pdf_ttf.tie
├── examples/
│   ├── hello.tie        # 门面示例：tdoc → 四份产物
│   ├── hello.tdoc       # td 文档源
│   └── probe.tie        # 内部模块冒烟验证
├── target/              # 构建产物（不入库）
├── LICENSE              # Tie Public License v2.3
└── README.md
```

## 许可证

tofflib 依据项目根目录 [LICENSE](LICENSE)（Tie Public License v2.3）发布。