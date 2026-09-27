# spec/ —— tie 语言语法规范（文档工程）

用 **tofflib 自身**（纯 tie）生成规范文档：`.tie` 内容 + 渲染层 → PDF。
产物：`tie-spec-2026.pdf`（版本 2026.2）。

## 文件

| 文件 | 职责 |
| --- | --- |
| `../pdf.tie` | PDF 核心装配（对象/页/内容流/文本定位/量宽/底纹/线） |
| `../pdf_ttf.tie` | TrueType 解析（表目录 / head / hhea / hmtx / cmap / 轮廓 / 多槽整形与回退） |
| `../pdf_asm.tie` | 对象编号规划 + xref/trailer + ToUnicode + 字节表落盘 + **六层生成后自检** |
| `pdfdoc.tie` | 排版层：标题/段落/代码块（语法高亮）/表格/清单/提示框/封面/目录；自动换行与分页 |
| `ch01_lex.tie` … `ch16_ref.tie` | 各章内容（16 章） |
| `build.tie` | 构建入口：两遍排版（干跑收页码 → 正式出稿）→ 输出 PDF 并自检 |
| `make.tsh.tie` | 构建脚本（tshell） |
| `speckit.tie` | 早先的 **docx** 版渲染工具（PDF 路线取代后保留作参考） |

## 字体（授权是选型的第一判据）

两款字体均为 **SIL OFL 1.1**：可商用、可嵌入产物、可再分发。

| 槽 | 字体 | 轮廓 | 说明 |
| --- | --- | --- | --- |
| 0 正文 | `NotoSansSC-VF.ttf`（思源系） | glyf | 含完整汉字与符号 |
| 1 代码 | `JetBrainsMono-Regular.ttf` | glyf | 等宽；仅 642 字形、无汉字、缺 `→`，**必须回退到槽 0** |

**不采用** `simhei` / `微软雅黑` / `等线`：它们随 Windows 授权，把字形嵌入对外分发的文档
属于再分发，有法律风险。

**轮廓类型必须匹配嵌入方式**：本库按 CIDFontType2 + FontFile2 嵌入，要求 **TrueType 轮廓**
（`glyf` + `loca`）。名为 `Noto Sans SC (TrueType).otf` 的静态版实际是 **CFF 轮廓**——
按上述方式嵌入会让阅读器把 CFF 当 TrueType 解析、**画出错误的字形**，而结构、GID、
宽度全部"正常"。`font_load` 因此带硬性守卫：缺 `glyf`/`loca` 直接拒绝并给出可操作提示。

## 生成方式（tshell）

```sh
# 在 tofflib 仓库根执行
../tshell/src/tsh_main.exe -f spec/make.tsh.tie
```

手工两步：

```sh
tiec --no-cache spec/build.tie -o spec/build.exe
spec/build.exe
```

> **务必加 `--no-cache`**：编译器有产物缓存，而本目录的源码改动频繁（渲染层与内容均在
> 迭代），旧缓存会让人误判"改完仍失败"。踩过这个坑（连续多轮误以为修复无效）。

## 六层自检（构建的一部分）

生成后 `build.exe` **读回产物**逐层校验。分这么多层是因为每加一层都对应一次真实缺陷：
最初只验 xref 偏移，全部通过而产物是 41 页白纸。

| 层 | 校验内容 | 漏掉会怎样 |
| --- | --- | --- |
| `widths` | 宽度函数与独立参考实现一致 | 换行失效 + 词元重叠（症状完全不同，根因同一个标量） |
| `verify` | `startxref` 指向 `xref`；每条目指向 `N 0 obj` | 文档打不开 |
| `objects` | 每个对象有字典；流的 `/Length` 与实际字节数一致 | 整份空白（内容流缺字典时无法解析） |
| `content` | 内容流 GID 落在字体范围内；`.notdef` 占比不过高 | 错字/缺字 |
| `layout` | 所有文本定位落在页面内 | 内容画到纸外 |
| `outline` | 用到的字形在 `loca` 里真有轮廓 | 文字全空 |

**结构自检不足以保证"看得见"**。本工程的实践中，下列缺陷全部通过了结构层检查：
CFF/TrueType 轮廓错配（字形画错）、缺 `/ToUnicode`（视觉正常但复制/搜索出错）、
`fill_rect` 残留非描边色（近白文字）、宽度错千倍（换行与字距同时失效）。
因此最终验收**必须包含真实渲染**。

## 真实渲染验收

```sh
# 任意 PDF 阅读器打开均可；命令行方式（需 pymupdf，仅用于验收，不参与构建）
python -c "import pymupdf; d=pymupdf.open('spec/tie-spec-2026.pdf'); \
  print(d.page_count, sum(len(d[i].get_text()) for i in range(d.page_count)))"
# 期望：64 页、约 8.6 万字符
python -c "import pymupdf; d=pymupdf.open('spec/tie-spec-2026.pdf'); \
  d[13].get_pixmap(dpi=110).save('p14.png')"     # 渲染任一页目视确认
# 文本可复制/可搜索（依赖 /ToUnicode）
python -c "import pymupdf; d=pymupdf.open('spec/tie-spec-2026.pdf'); \
  print(d[13].get_text()[:60])"
```

## 已知局限

* **字体未子集化**：两字体全量嵌入（17.7MB + 0.14MB），产物约 18MB。按实际用到的
  1075 个字形裁 `glyf` 可降到数百 KB。
* **目录不链接**：目录页码是文本，未加内部跳转链接（需 `/Annots` 与目标页引用）。
* **无书签大纲**：未生成 `/Outlines`，阅读器的侧栏目录为空。
* **正文不可用等宽**：正文与代码分属两槽，正文本身不使用等宽字体（符合预期）。

## 约束（严格遵守）

* **不使用任何外部脚本语言**：构建编排一律用 **tshell**，文档生成一律用 **tofflib 自身**。
* **二进制落盘必须走 `byte_write`**：`file_write` 在 Windows 上遇 NUL 字节截断
  （实测写 4 字节只落 3 字节），而嵌入字体满含 NUL。
* **路径用绝对路径**：tshell 的 `exec_code` 不提供 shell 的复合命令语义。
* **tshell 输出用 ASCII**：tshell 的 `println` 与终端编码不一致时中文显示为乱码。
* **代码示例含花括号时用原始字符串**（`r"..."`）：普通字符串里的 `{` 会被当插值求值。
