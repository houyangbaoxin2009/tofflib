# spec/ —— tie 语言语法规范（文档工程）

用 **tofflib 自身**（纯 tie）生成规范文档：`.tie` 内容 + 渲染层 → PDF。

## 文件

| 文件 | 职责 |
| --- | --- |
| `../../pdf.tie` | PDF 核心装配（对象/页/内容流/文本定位/量宽/底纹/线） |
| `../../pdf_ttf.tie` | TrueType 解析（表目录 / head / hhea / hmtx / cmap / glyph 宽） |
| `../../pdf_asm.tie` | 对象编号规划 + xref/trailer + 字节表落盘 |
| `pdfdoc.tie` | 文档层 API：标题/段落/代码块/表格/清单/提示框 → PDF 页（**待编写**） |
| `ch*.tie` | 规范章节内容（**待编写**） |
| `build.tie` | 构建入口：装配全部章节 → 输出 `tie-spec-2026.pdf`（**待编写**） |
| `make.tsh.tie` | tshell 构建脚本（**待编写**） |
| `speckit.tie` | 早先的 **docx** 版渲染工具（PDF 路线取代后保留作参考） |

## 现状

* PDF 生成链路**已打通并验证**：嵌入 `simhei.ttf`（CIDFontType2 + Identity-H），
  文本以 2 字节 GID 写入；结构经「`startxref` 指向 `xref` + 每个对象偏移对齐」逐项校验。
* 样品：`pdf_smoke.pdf`（字体全量嵌入，故约 9.7MB）。
* **规范正文内容尚未编写**——这是后续主体工作。

## 生成方式（tshell）

```sh
# 仓库根执行
tiec pdf.tie spec/build.tie -o spec/build.exe
spec/build.exe
```

## 约束（严格遵守）

* 本目录**不使用任何外部脚本语言**——构建编排一律用 **tshell**（`*.tsh.tie`），
  文档生成一律用 **tofflib 自身**。
* 二进制落盘**必须走 `byte_write`**：`file_write` 在 Windows 上遇 NUL 字节截断
  （实测写 4 字节只落 3 字节），而嵌入字体满含 NUL。
