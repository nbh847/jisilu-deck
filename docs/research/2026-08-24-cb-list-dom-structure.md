# 可转债列表页 DOM 结构与选择器调研

> 调研日期：2026-08-24
> 方法：Playwright Chromium 未登录会话打开目标页，等待表格渲染后只读提取结构与计算样式；未点击任何站内按钮，未读取 Cookie、Token 或接口响应。
> 用途：为 `src/content/page-adapter.js` 提供选择器依据；页面改版时先复核本文再改适配模块。

## 1. 目标页与渲染前提

- URL：`https://www.jisilu.cn/web/data/cb/list`，标题「列表 - 可转债 - 集思录」。
- 未登录可渲染主列表，页脚计数「数量 30/30」。
- 页面为 Vue 2 单页应用（scoped attr `data-v-5ccac8d5`），表格由 JS 动态渲染，内容脚本需等待并监听变更。

## 2. 表格整体结构

页面存在多张 `table.jsl-table-body`：

- **主列表表**是文档顺序第一张，且其直接子行 `> tbody > tr` 的 `td[1]` 含 `.jisilu-icons` 操作锚点。数据行 30 条。
- 其余 `jsl-table-body` 是行展开后的「下修信息」明细小表（每行一张，嵌套在主表展开行单元格内，由 JS 动态 append，因此嵌套合法）。**在主表上做 `querySelectorAll('thead th')` 会递归命中这些嵌套表头，首次调研曾因此误读**。
- 主表 `tbody > tr` 共 40 条 = 30 条数据行 + 10 条展开明细行；数据行判定：`td[0]` 含 class `sticky-data`。

祖先链（主表）：`table.jsl-table-body` → `div.jsl-table-body-wrapper` → `div.jsl-table.sticky-header` → … → `div.data-content.auto-content-width`。全部无 id。

## 3. 数据行结构与选择器

以首行（脱敏示例）为准，直接子 `td` 顺序：

| td 序号 | class | 内容 | 关键选择器 |
| --- | --- | --- | --- |
| 0 | `sticky-data`（style `left:0px`） | 行号，`div.cell[name="XXXXXX"]` | 行号格（`name` 属性即债券代码，备用来源） |
| 1 | `sticky-data`（style `left:30px`） | **操作格** | `a[title^="加["] > span.jisilu-icons` |
| 2 | `sticky-data`（style `left:62px`） | 代码 | `a[href^="/data/convert_bond_detail/"]`，文本为 6 位代码 |
| 3 | `sticky-data sticky-separate`（style `left:112px`） | 名称 | `span`（无 class，默认色 `rgb(61,61,61)`，无内联 color） |
| 4+ | 无 sticky | 行情字段（插件不读取） | — |

原站自选按钮（未登录态全表 30 行均为 `+` 态）：

- `<a title="加[示例转债]为自选转债"><span class="jisilu-icons"></span></a>`
- 锚点计算样式：`display:inline`，rect `17×15px`，`color rgb(32,103,152)`，`font-size 13px`，`cursor pointer`，`text-decoration none`。
- 图标 span：rect `13×13px`，字体 `jisilu-iconfont`，文本为空（图标字形）。

操作格样式：宽 `32px`（表头 `<colgroup><col width="32">` 同步锁定），`padding 0 1px`，`position sticky`，`vertical-align middle`，`white-space normal`，`overflow visible`。内容盒宽 30px；原锚点占 1–18px，插件按钮放 18px 起可并列（详见 §5）。

## 4. 与「红色 -」相关的澄清

- 未登录新会话下站内自选为空，全表都是 `+`，**页面上采不到站内红 `-` 的色值**。
- 首次调研发现的 6 个「-」元素是行情列的占位符 `span.color-darkgray.font-style-italic`（`rgb(169,169,169)`），与自选无关。
- 因此本地 `-` 与已选名称红采用自定义常量 `#e74c3c`（ui-spec 只约束「同一红色」，未定值）；橙色 `+` 按 ui-spec 用 `#e67e22`。

## 5. 插件按钮注入方案（依据实测几何）

- 挂载点：操作格 `td[1]` 内追加 `<a class="jd-local-btn" role="button">`，文本 `+`／`-`（普通文本，不用 `jisilu-icons`）。
- 定位：操作格本身 `position:sticky`（已定位），子元素用 `position:absolute; left:18px; top:50%; translateY(-50%); width:13px; height:13px; font-size:13px; text-align:center`。绝对定位不参与表格布局，保证「不扩展 32px 列宽、不覆盖原按钮」。
- 名称标红：设 `td[3] > span` 的内联 `color`，恢复时 `removeProperty('color')` 回落到页面原样式（名称 span 原本无内联色，实测安全）。

## 6. 页面自有状态（只观察不使用）

- `localStorage` 仅见 `data-cb-index`、`data-cb-filters:0`（站内筛选与列设置 key 名），插件数据全部走 `chrome.storage.local`，互不影响。

## 7. 选择器失效条件与复核入口

以下任一变化即视为页面改版，需重新调研并只改 `page-adapter.js`：

- `table.jsl-table-body` 类名或「第一张表 + td[1] 含 `.jisilu-icons`」的主表识别方式失效；
- 数据行 `td` 顺序变化或 `sticky-data` 类消失；
- 操作锚点 `title` 前缀不再是 `加[`；
- 代码格 `href` 前缀不再是 `/data/convert_bond_detail/`；
- 操作列 `<col width="32">` 宽度约定变化。

复核方法：未登录会话打开目标 URL，按本文 §2–§3 逐项比对（可复用 `/tmp` 下 Playwright 脚本思路：等待 `table.jsl-table-body tbody` 出现后提取）。
