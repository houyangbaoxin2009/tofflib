# vscode-tdoc —— tdoc 文档源的编辑器支持

tdoc 是 [tofflib](https://github.com/houyangbaoxin2009/tofflib) 的统一输入格式：把文档写成
`tie:data` 数据（`.tdoc`），由 tofflib 装载成块流，再渲染成 PDF / docx / xlsx / pptx。
本扩展负责「写」这一侧：补全、片段、诊断、大纲、折叠与 PDF 预览。

依赖 [`tie.vscode-tie`](https://github.com/tie-lang/vscode-tie)：td 的底层语法、关键字与
通用片段由它提供，本扩展只加 tdoc 的块语义。

## 功能

| 功能 | 说明 |
| --- | --- |
| 语法高亮 | 块名作关键字着色；标题块单独着色；字符串、转义、注释、数字、布尔 |
| 块补全 | 输入 `["` 后列出全部块名，带用途说明；直接插入整块骨架 |
| 代码片段 | 26 个块各一条（`h1`、`p`、`tblw`、`code`…），代码块按 here-doc 形态展开 |
| 结构诊断 | 括号/引号未闭合、未知块、参数个数、表格列数、列宽个数、`toc` 深度、重复的 `header/footer` |
| 大纲 | `h1`–`h3` 按层级嵌套，直接当文档目录用 |
| 折叠 | 所有跨行的数组与表 |
| 悬停 | 块名上悬停显示协议说明 |
| 插入块 | 右键或命令面板：选块 → 插入骨架 |
| 新建文档 | 生成最小可渲染骨架（封面、目录、一章、一段） |
| PDF 预览 | 调 `tiec` 编译渲染器并出 PDF，用系统阅读器打开 |

## 安装与开发

```sh
# 开发模式（把本目录作为扩展加载）
code --extensionDevelopmentPath=<tofflib>/editor/vscode-tdoc

# 打包
npx @vscode/vsce package
```

`extensionDependencies` 要求先安装 `tie.vscode-tie`。

## 配置

| 配置项 | 说明 |
| --- | --- |
| `tdoc.compile.tiec` | `tiec` 可执行文件路径 |
| `tdoc.compile.trm` | `trm_lite.a` 路径（文档用到表容器时必需），编译渲染器时作为 `TIE_TRM_LITE_LIB` |
| `tdoc.tofflib.root` | tofflib 源码根目录（含 `src/tofflib.tie`）；渲染器写到 `<root>/.vscode-tdoc/` |
| `tdoc.render.bodyFont` | PDF 正文字体（TrueType 轮廓，需含中文），默认 `C:/Windows/Fonts/NotoSansSC-VF.ttf` |
| `tdoc.render.monoFont` | PDF 代码字体；留空回退正文字体 |
| `tdoc.preview.openExternal` | 用系统阅读器打开（默认开） |
| `tdoc.preview.onSave` | 保存时自动预览（默认关） |

## 预览是怎么工作的

1. 把 `render/render.tie` 写到 `<tofflib.root>/.vscode-tdoc/render.tie`（内容变了才重写）；
2. 用 `tiec` 编译成同目录的可执行文件（源比产物新才重编）；
3. 以环境变量传参运行：`TDOC_IN` / `TDOC_OUT` / `TDOC_FONT` / `TDOC_MONO`；
4. 打开产出的 PDF。

因此预览需要：tofflib 源码、`tiec`、`trm_lite.a`（文档用到 `table<T>` 时）、一款带中文的
TrueType 字体。缺什么会在「输出 → tdoc」里说明。

## 数据格式要点

- **结构层**：token 之间的空白、换行、缩进不参与语法，随便排。
- **字符串**：引号内的空白是数据；换行只能来自 `\n` 转义或 here-doc。
- **代码块**：开引号后立即换行，内容**逐字保留**（缩进即排版），收尾引号独占一行：

  ```tie
  ["code", "tie", "
  func main() {
      return 0
  }
  "],
  ```

- **长段落**：用 `\` 续行，换行与续行缩进都不进入文本。

## 块协议速查

| 块 | 形状 |
| --- | --- |
| 文档 | `["title": "…", "blocks": [ … ]]` |
| 标题 | `["h1"…"h9", "文本"]` |
| 段落 | `["p" \| "b" \| "center" \| "note" \| "quote", "文本"]` |
| 列表 | `["ul" \| "ol", ["条目", …]]` |
| 表格 | `["tbl", [表头…], [行…], …]` / `["tblw", [表头…], [行…], …, [列宽…]]` |
| 代码 | `["code", "语言", "文本"]` |
| 结构 | `["page"]`、`["sec", 标题]`、`["cover", 标题, 副标题]`、`["toc", 深度]`、`["hr"]` |
| 其他 | `["cap", 文本]`、`["img", 路径, 宽pt, 题注]`、`["link", 文本, 地址]`、`["para", run…]` |
| 页眉页脚 | `["header" \| "footer", 文本]`、`["note_ref", 文本]` |

完整定义见 `tofflib/src/doc/model.tie` 与 `src/doc/load.tie`。

## 测试

```sh
node test/test.js [某个 .tdoc]
```

核心分析器（`src/tdoc.js`）不依赖 vscode，可直接在 node 下跑。

## 已知限制

- 预览只产出 PDF；docx/xlsx/pptx 走 tofflib 的其它后端，不在本扩展里。
- 诊断是**结构级**：不检查图片文件是否存在、字体是否缺字、渲染期才暴露的问题。
- 表格列宽单位是 twips（20 twips = 1 pt），与 docx 的 `dxa` 一致。
