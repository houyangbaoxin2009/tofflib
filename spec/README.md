# spec/ —— tie 语言语法规范（文档工程）

用 **tofflib 自身**（纯 tie）生成规范文档：`.tie` 内容 + 渲染层 → PDF。
产物：`tie-spec-2026.pdf`。

## 文件

| 文件 | 职责 |
| --- | --- |
| `../pdf.tie` | PDF 核心装配（对象/页/内容流/文本定位/量宽/底纹/线） |
| `../pdf_ttf.tie` | TrueType 解析（表目录 / head / hhea / hmtx / cmap / glyph 宽） |
| `../pdf_asm.tie` | 对象编号规划 + xref/trailer + 字节表落盘 + **生成后结构自检** |
| `pdfdoc.tie` | 排版层：标题/段落/代码块/表格/清单/提示框 → PDF 页（自动换行与分页） |
| `ch01_lex.tie` … `ch16_ref.tie` | 各章内容（16 章） |
| `build.tie` | 构建入口：装配全部章节 → 输出 PDF 并自检 |
| `make.tsh.tie` | 构建脚本（tshell） |
| `speckit.tie` | 早先的 **docx** 版渲染工具（PDF 路线取代后保留作参考） |

## 生成方式（tshell）

```sh
# 在 tofflib 仓库根执行
../tshell/src/tsh_main.exe -f spec/make.tsh.tie
```

脚本会依次：编译 `build.tie` → 运行生成 PDF → 报告自检结论。
也可以手工两步：

```sh
tiec spec/build.tie -o spec/build.exe
spec/build.exe
```

## 五层自检（构建的一部分，不是可选项）

生成后 `build.exe` **读回产物**并逐层校验。分层的原因来自一次教训：
第一版只有「xref 偏移」一层，**全部通过，而产物是 41 页白纸**。

| 层 | 校验内容 | 漏掉会怎样 |
| --- | --- | --- |
| `verify` | `startxref` 指向 `xref`；每个条目指向 `N 0 obj` | 文档打不开 |
| `objects` | 每个对象是合法对象（有字典）；流的 `/Length` 与实际字节数一致 | **整份空白**——内容流缺字典时阅读器无法解析 |
| `content` | 内容流里的 GID 解回后落在字体范围内；`.notdef` 占比不过高 | 文字错字/缺字 |
| `layout` | 所有文本定位落在页面内 | 内容画到纸外 |
| `outline` | 用到的字形在 `loca` 里真有轮廓 | 文字全空 |

**这些层次缺一不可，且它们各自都可能出错**——本工程落地过程中，第 2、3、5 层
的自检**自己**都有过 bug（详见各函数的 RCA 注释）。因此最终验收还必须包含
**真实渲染**：用任意 PDF 阅读器打开，确认可见。

## 真实渲染验收

```sh
# 任意阅读器打开均可；命令行方式（需 pymupdf，仅用于验收，不参与构建）
python -c "import pymupdf; d=pymupdf.open('spec/tie-spec-2026.pdf'); \
  print(d.page_count, sum(len(d[i].get_text()) for i in range(d.page_count)))"
# 期望：41 页、约 3.4 万字符；并渲染任一页出图目视确认
```

## 已知待改进

* **字体未子集化**：当前嵌入 `simhei.ttf` 全量（约 9.7MB），故产物约 9.9MB。
  按用到的字符裁 `glyf` 表可降到数百 KB。
* **代码块非等宽字体**：正文与代码共用同一款字体，代码的字符间距不等宽
  （缩进对齐仍正确，因为 ASCII 字符宽度一致）。引入第二款等宽字体需把
  字体状态改为按索引的多实例（`pdf_ttf.tie` 目前是单字体全局状态）。
* **目录页码未回填**：目录项列出章节，页码列为空——回填需要两遍排版。

## 约束（严格遵守）

* **不使用任何外部脚本语言**：构建编排一律用 **tshell**，文档生成一律用
  **tofflib 自身**。
* **二进制落盘必须走 `byte_write`**：`file_write` 在 Windows 上遇 NUL 字节截断
  （实测写 4 字节只落 3 字节），而嵌入字体满含 NUL。
* **路径用绝对路径**：tshell 的 `exec_code` 不提供 shell 的复合命令语义，
  不能用切换工作目录的方式定位产物。
* **tshell 输出用 ASCII**：tshell 的 `println` 与终端编码不一致时中文显示为乱码，
  而构建脚本的输出是给人看的。
