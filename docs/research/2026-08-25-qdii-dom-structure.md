# QDII 页面 DOM 结构与选择器调研

> 调研日期：2026-08-25；2026-08-26 补充站内已自选状态
> 页面：`https://www.jisilu.cn/data/qdii/#qdiie`、同页 `#qdiia`
> 方法：browser-skill 连接真实 Chrome，只读提取可见结构、表格标识、控件 HTML 与计算尺寸；未读取 Cookie、Token 或接口响应。

## 1. 三张目标表

| 分类 | 页面标题 | 表格 ID | 站内筛选表单 |
| --- | --- | --- | --- |
| `europe` | 欧美指数 | `flex_qdiie` | `qdeSearchForm` |
| `commodity` | 商品 | `flex_qdiic` | `qdcSearchForm` |
| `asia` | 亚洲指数 | `flex_qdiia` | `qdaSearchForm` |

- `#qdiie` 视图同时显示欧美指数和商品两张表。
- 切到 `#qdiia` 后，欧美指数与商品表仍保留在 DOM 中，但操作单元格计算宽度为 `0`；亚洲表可见。
- 页面适配必须同时检查固定表格 ID 与 `getClientRects().length > 0`，不能只按 DOM 是否存在判断。

## 2. 数据行结构

三张表的数据行共同结构：

- 代码：首列 `a[href^="/data/qdii/detail/"]`，文本为 6 位数字。
- 名称：第二列纯文本。
- 操作：末列未自选时为 `a[href*="addOwnedQd"]`，标题为“将【基金名称】添加入自选”；已自选时为 `a[href*="delOwnedQd"]`，标题为“将【基金名称】从自选中删除”。
- 站内图标使用 `span.jisilu-icons`：未自选为 `U+E61E`，已自选为 `U+E61D`。

2026-08-26 真实页面只读取证确认：站内自选操作会整体重写末列，原有插件按钮随之被删除。因此页面适配不能只识别 `addOwnedQd(...)`，还必须识别 `delOwnedQd(...)`，由幂等扫描补回本地按钮。

欧美与亚洲表的操作列是第 21 列，商品表是第 19 列，因此实现必须取末列，不能写死列序号。

## 3. 操作列几何

- 欧美市场操作单元格实测宽约 `27.23px`，商品约 `29.39px`，亚洲约 `27.29px`。
- 单元格内边距均为 `4px`，站内操作锚点宽约 `17px`。
- 原列无法容纳两个图标。插件需要把目标操作单元格最小宽度扩到约 `46px`，并让本地按钮以普通行内元素追加在站内按钮右侧，两个图标之间保留 `6px`；不得溢出覆盖“基金公司”列。

## 4. 筛选控件

每张表标题行都有独立的：

```html
<label style="display:inline;margin-left:10px;">
  <input type="checkbox" name="only_owned" value="y">
  仅看自选
</label>
```

三个站内复选框分别调用 `showQDIIE()`、`showQDIIC()`、`showQDIIA()`。插件本地复选框应作为独立标签插在该标签右侧，不能复用其 `name`、`onclick` 或站内表单提交逻辑。

## 5. 失效条件

以下变化需要重新调研并只修改页面适配层：

- 三张表 ID 改变；
- 代码详情链接不再使用 `/data/qdii/detail/`；
- 操作链接不再包含 `addOwnedQd` 或 `delOwnedQd`；
- 名称不再位于第二列；
- 站内“仅看自选”不再使用 `input[name="only_owned"]`；
- 市场切换不再以隐藏旧表、显示目标表的方式工作。
