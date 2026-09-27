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

## 结构自检

生成后 `build.exe` 会**读回产物**校验 xref 结构：`startxref` 必须指向 `xref`，
且交叉引用表里每个条目偏移处的字节必须是 `N 0 obj`。任何一处偏差都会让整份
文档打不开，而这类偏差是纯算术产物、肉眼无法从文件上发现——所以自检是构建
的一部分，不是可选项。

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
