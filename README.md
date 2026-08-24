# jisilu-deck

集思录页面增强 Chrome 插件。在可转债列表现有操作列中增加一个本地自选按钮，把个人自选记录保存在浏览器本机，并用红色转债名称标识已加入状态。

## 当前状态

第一版完成并验收（2026-08-24）：单元测试 11/11；Playwright 真实页面 E2E 29/29；browser-skill 驱动真实 Chrome（登录态、311 行全量视图）实测加入／刷新持久化／移出恢复全部通过。扩展已在散帅 Chrome 中以未打包方式加载使用。

## 已确认边界

- 使用 Chrome Manifest V3。
- 第一版只维护本地自选可转债，不包含持仓功能。
- 不绕过集思录会员权限或访问控制。
- 不请求或抓取需要登录、会员或付费权限才能访问的接口数据。
- 只处理当前页面已经渲染的表格行，不读取行情字段，不批量导出页面内容。
- 与 `kzz-radar` 独立，不共享代码与数据。

## 模块结构

```text
.
├── manifest.json            # MV3：仅 storage 权限，仅匹配目标页
├── src/content/
│   ├── watchlist-store.js   # 本地自选存储层（chrome.storage.local，唯一键 bondCode）
│   ├── page-adapter.js      # 页面适配层（选择器、注入、状态样式；页面改版只改这里）
│   └── main.js              # 主逻辑（初始化、点击处理、表格重渲染监听、跨标签同步）
├── test/
│   └── watchlist-store.test.js  # 存储层单元测试（node:test，零依赖）
└── tools/
    └── e2e-cb-list.js           # 真实页面 E2E 验收（需 playwright 环境）
```

## 开发与验证

- 单元测试：`node --test`（仓库根目录执行）。
- E2E 验收：在有 playwright 的目录运行，例如
  `cd <playwright-skill 目录> && node run.js /Users/mac/workspace/jisilu-deck/tools/e2e-cb-list.js`
  （路径可用环境变量 `JD_EXT_PATH` 覆盖；脚本会读写 `/tmp/jd-e2e-profile` 用户数据目录。）
- 手工验收：Chrome 打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本仓库目录 → 打开 `https://www.jisilu.cn/web/data/cb/list`。

## 文档入口

- [`ROADMAP.md`](ROADMAP.md)：当前阶段、已完成事项、待办和验证记录。
- [`docs/product/product-design.md`](docs/product/product-design.md)：第一版产品定义与验收标准。
- [`docs/product/data-rules.md`](docs/product/data-rules.md)：本地自选字段与加减语义。
- [`docs/product/ui-spec.md`](docs/product/ui-spec.md)：橙色 `+`／红色 `-` 的位置、状态和视觉区分。
- [`docs/architecture/implementation-boundaries.md`](docs/architecture/implementation-boundaries.md)：最小权限、页面适配与本地存储边界。
- [`docs/architecture/validation-plan.md`](docs/architecture/validation-plan.md)：验收与边界验证计划。
- [`docs/research/README.md`](docs/research/README.md)：实施前必须完成的调研清单与证据要求。
- [`docs/research/2026-08-22-boundary-research.md`](docs/research/2026-08-22-boundary-research.md)：目标页面、服务协议与 Chrome 能力的首轮调研记录。
- [`docs/research/2026-08-24-cb-list-dom-structure.md`](docs/research/2026-08-24-cb-list-dom-structure.md)：目标页 DOM 结构、选择器与失效条件（页面适配依据）。
