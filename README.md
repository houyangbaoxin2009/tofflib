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

> **本库只负责把结构"生成"成 XML/文本字符串**。若需进一步把字符串写成文件，
> 直接用等语言底座原语 `file_write(path, content)` 即可（tofflib 不引入额外依赖）。

## 模块清单

| 模块            | 命名空间       | 职责                                                        | 编译产物      |
| --------------- | ----------- | --------------------------------------------------------- | --------- |
| `docx.tie`      | `docx`      | Word 文档骨架：段落/run/字体、表格，组装成 OOXML 文档正文 XML      | `docx.a`  |
| `omml.tie`      | `omml`      | Word 公式：OMML 结构生成器（分数/上下标/定界符/n-ary 求和积分）        | `omml.a`  |
| `vml.tie`       | `vml`       | Word 原生绘图：VML 形状组/矩形+文本框/带箭头直线                    | `vml.a`   |
| `officeutil.tie` | `officeutil` | 日常办公：日期时间、CSV/对齐表格文本、待办清单、编号列表                | `officeutil.a` |

## 快速开始

```bash
# 编译单个模块（class 库 → 静态库）
tiec docx.tie          # → docx.a
tiec omml.tie          # → omml.a
tiec vml.tie           # → vml.a
tiec officeutil.tie    # → officeutil.a

# 冒烟验证：编译并运行 probe
tiec examples\probe.tie -o examples\probe.exe
examples\probe.exe      # 打印 OK 断言 + 组装示例，exit 0 即通过
```

写一个带格式的文档骨架（逻辑程序）：

```tie
type tie<logic>
import "./docx.tie" as dx
import "./officeutil.tie" as ou

func main() {
    var doc = dx.root_open() +
        dx.paragraph(dx.run_font("周报", "宋体", 22, true)) +
        dx.tbl([[ou.fmt_date(2026,8,30), "进行中"]], [], 3000) +
        dx.root_close()
    file_write("out.xml", doc)
    println("已生成文档正文 XML")
}
```

## 各模块公开接口

### docx（`docx.tie`）

| 函数                    | 签名                                                                            | 说明                          |
| --------------------- | ----------------------------------------------------------------------------- | --------------------------- |
| `escape`              | `escape(txt: string) -> string`                                                | XML 转义 `&` `<` `>`            |
| `run`                 | `run(txt: string) -> string`                                                   | 单个文本 run `<w:r><w:t>`        |
| `run_font`            | `run_font(txt, font: string, size_half_points: i64, bold: bool) -> string`      | 带格式 run（字体/字号/加粗）回用            |
| `paragraph`           | `paragraph(txt: string) -> string`                                             | 单 run 段落 `<w:p>`              |
| `paragraph_runs`      | `paragraph_runs(runs_table: table<string>) -> string`                         | 多 run 组装一个段落                 |
| `root_open`           | `root_open() -> string`                                                        | 文档根打开（`<w:document><w:body>`） |
| `root_close`          | `root_close() -> string`                                                       | 文档根关闭                        |
| `tbl`                 | `tbl(rows: table<table<string>>, header: table<string>, col_width_twips: i64) -> string` | 组装表格，可选加粗表头               |

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
| `delimit`  | `delimit(inner: string, beg: string, end: string) -> string`               | 定界符（括号包裹）`<m:d>`              |
| `nary`     | `nary(op, sub, sup, inner: string) -> string`                             | 求和/积分等 `∑ ∫ ∏` 算子 `<m:nary>`    |

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

## 工程结构

```
tofflib/
├── docx.tie          # Word 文档骨架
├── omml.tie          # Word 公式 OMML
├── vml.tie           # Word 绘图 VML
├── officeutil.tie     # 办公小工具
├── examples/
│   └── probe.tie     # 冒烟验证（导入全模块 + 断言）
├── .gitignore
├── LICENSE           # 自定义宽松许可 v1.1
└── README.md
```

## 许可证

版权所有 (c) houyangbaoxin2009，依据项目根目录 [LICENSE](LICENSE)（自定义宽松许可 v1.1）发布。