# jisilu-deck 性能修复 Handoff

## 目标

消除插件在 Win10 弱机上刷新可转债列表时的主线程长任务（卡顿 5–6 秒、鼠标冻结、浏览器“暂时失去响应”）。

## 根因

- `src/content/main.js`：`setInterval(scan, 1000)` 每秒对约 540 行全量扫描，同步执行大量 DOM 查询。
- `src/content/page-adapter.js`：`setStyle` 用字符串比较判断样式是否变化，但浏览器会把 hex 颜色规范化成 `rgb()`，导致每轮重复写入。
- 页面刷新时站点 Vue 全量挂载与插件注入竞争主线程，弱机上表现为卡顿。

## 已完成的修复

1. `page-adapter.js`：`setStyle` 增加隐藏属性缓存，仅在值实际变化时写入。
2. `page-adapter.js`：`findMainTable` 与 `ensureFilterGroup` 增加缓存 + `isConnected` / 可见性校验，表格或筛选组未失效时不再重查文档。
3. `page-adapter.js`：`applyLocalFilter` 在筛选保持关闭时跳过整轮行遍历；`ensureButton` 新增 `forceFull` 参数，已同步行（`data-jd-state=1`）在非强制模式下返回 `{ fast: true }` 跳过。
4. `main.js`：引入 `SCAN_BUDGET_MS = 8` 分帧预算、`resume` 断点续扫（`setTimeout(..., 0)`），单次扫描不再一次同步处理全部行。
5. `main.js`：引入 `dirtyAll` 位，存储变化后下一轮全量同步，完成后恢复增量快扫。
6. `main.js`：SPA 对账循环从 1s 降到 5s，且仅在表格出现后执行。
7. `page-adapter.js`：样式缓存同时记录请求值和浏览器规范化后的实际值；清除颜色也经过统一缓存路径，QDII 移出后再次加入可恢复名称红色。
8. `page-adapter.js`：缓存表格命中前重新校验目标行结构，缓存筛选组命中前校验可见性，避免 SPA 原地改写或保留隐藏节点后复用失效对象。
9. `main.js`：存储快照变化时取消旧续扫并从首行重启全量同步，避免断点前的行保留旧状态。

## 测试

- `node --test`：44/44 通过（原 34 + 新增 10）。
- 新增测试覆盖：样式幂等、QDII 名称颜色重新加入恢复、表格定位缓存及原地改写失效、筛选关闭跳过、筛选组缓存、已同步行快路径、确定性分帧预算、存储变化重启续扫、全量/增量切换、对账降频。
- `git diff --check` 通过。

## 阻塞项

- 散帅已在 `chrome://extensions` 重新加载当前未打包扩展。随后两次运行可转债 E2E：第一次创建 session 等待扩展连接超时；第二次创建 `dtiz` 后页面工具 RPC 超时，均未进入功能断言。`bsk logs` 显示浏览器连接在执行期间断开并出现 `BrowserSinkClosed`，属于 browser-skill 连接故障；按 Skill 规则停止重试，QDII E2E 未运行。
- 脚本停止 `dtiz` 的命令超时；随后 `bsk session list --json` 返回 `[]`，但散帅现场确认 Chrome 仍显示 BrowserSkill 控制状态。当前 `bsk status` 为浏览器连接 1、活动 session 0，属于无法通过 session ID 管理的 Chrome 端孤儿窗口或调试附加状态，浏览器收尾未完成。
- browser-skill 自动启动的 daemon 未手动管理；该 Skill 明确禁止 Agent 手动启停 daemon。Chrome 顶部调试提示未能现场确认，浏览器收尾不能视为完全确认。
- 性能前后数据尚未采集（需人工在 Win10 或 macOS 上重新加载未打包扩展后测量）。

## 下一步

1. 在真实 Chrome 重新加载未打包扩展，打开集思录可转债列表页，用 Chrome 任务管理器观察刷新后的主线程 CPU。
2. 确认无卡顿后，更新 `ROADMAP.md` 验证基线。
3. 若确认无误，再升级版本并发布（当前源码与发布包仍是 `0.4.1`，性能修复未包含在发布包中）。
