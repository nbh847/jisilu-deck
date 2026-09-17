# jisilu-deck Roadmap

## 当前版本

`0.4.1` 已完成并通过验收；取消可转债加入本地自选后的名称标红，其他行为保持不变。

## 进行中

- 可转债长列表性能修复：已完成 8ms 分帧扫描、增量快扫、表格与筛选组缓存、幂等样式写入和 5 秒低频全量对账，并修复 QDII 名称颜色缓存、存储变化沿用旧断点、SPA 原地改写表格后的缓存失效问题；单元测试 44/44 通过。真实 Chrome 验收部分完成：QDII 32/32 通过，可转债首次 47/48 且唯一失败为待购入口同一行布局断言，重试又遇到 bsk RPC 超时；540 行弱机性能前后对照仍待完成。

## 已完成

- 项目验证纪律增加任务收尾约束：浏览器及相关工具任务结束前必须停止会话、关闭窗口、归还标签页、恢复测试数据、停止本任务启动的 daemon、清理临时状态并复核；Chrome 顶部仍显示 BrowserSkill 调试提示时不得视为完成，无法清理的残留必须显式报告。
- `0.4.1` 取消可转债加入本地自选后的名称标红；本地 `+`／`-`、待购、筛选和 QDII 行为保持不变。
- Manifest V3 扩展骨架和最小权限配置。
- 基于 `chrome.storage.local` 的本地自选存储。
- 操作列行内 `+`／`-` 按钮和名称状态标记。
- 页面刷新、表格重渲染、跨标签页和浏览器重启后的状态恢复。
- 页面结构失效保护、重复注入保护和存储错误反馈。
- 产品边界、数据规则、页面适配和验证文档。
- MIT License 和公开安装说明。
- README 明确说明免费账号 10 项站内自选限制、本地清单方案及不触碰会员权限的边界。
- README 增加脱敏后的操作列截图，说明原站按钮与新增本地自选按钮的位置关系。
- 修复从封闭基金等数据板块切回可转债后本地按钮消失：内容脚本在 `/data/*` 与 `/web/data/cb/*` 保持监听，无可转债表格时不写 DOM；回归单测 17/17 通过，真实 Chrome 中「可转债 → 封闭基金 → 可转债」验收通过。
- `0.2.0` 增加顶部“仅看本地自选”按钮：位于原站筛选组之后、“显示已拉黑”之前；开启后只显示站内当前结果与本地自选的交集，关闭后恢复。
- 本地筛选支持关闭态白底灰字、开启态橙底白字，筛选开启期间的本地自选增删、排序重渲染和页面刷新状态均已覆盖。
- 产品、交互、数据边界、页面适配和验证文档已同步到 `0.2.0`。
- `0.3.0` 完成 QDII 欧美市场、商品、亚洲市场三套独立本地自选：分类存储、当前可见表识别、行内按钮、原生复选框筛选和三套筛选状态均已实现。
- 修复 QDII 扫描在欧美表后中止：不再对只读 `dataset` 整体赋值，商品表与亚洲表均可正常注入。
- QDII 操作列最小宽度从 `42px` 增至 `46px`，站内按钮与本地按钮间距从 `2px` 增至 `6px`，两个红色 `-` 可清楚分辨且不覆盖“基金公司”列。
- QDII 真实 Chrome E2E 29/29 通过，覆盖三表独立加入、移出、筛选、刷新恢复、市场切换、按钮间距和测试数据清理。
- 修复 QDII 站内自选切换后本地按钮消失：页面适配同时识别 `addOwnedQd(...)` 与 `delOwnedQd(...)`，站内脚本整体重写操作单元格后会自动补回本地按钮；真实 Chrome 检查 16 条站内已自选记录均正常。
- `0.4.0` 完成 [Goal 001：可转债待购清单与组合筛选](goals/001-cb-purchase-queue.md)：待购从属状态、名称旁灰色 `+`／橙色“待购”、直接清除和顶部互斥组合筛选均已实现并通过真实页面验收。

## 验证基线

- 2026-09-17 14:15：提交前复核当前性能修复；`node --test` 44/44 通过，`git diff --check` 通过，`tools/e2e-cb-list.js` 与 `tools/e2e-qdii.js` 语法检查通过。真实 540 行弱机性能前后对照仍待完成，本次验证不改变该验收边界。
- 2026-09-14 22:03：继续按 browser-skill CLI `0.2.1` 做真实验收；因 `bsk` 无法访问 `chrome://extensions`，本轮未能重新加载当前未打包扩展，E2E 结果不能单独证明工作区源码已被浏览器加载。QDII E2E `32/32` 通过；可转债首次 `47/48`，唯一失败为“待购标记紧跟名称且保持同一行”，重试在同一断言失败后又遇到 bsk RPC 超时，结果 `32/35`。重试产生的测试记录 `123285`、`110077` 已定向清理，原有 `127061`、`110081` 未改变；最终 `bsk session list --json` 返回 `[]`。当前 30 行可转债页面采集到 1 个筛选组、30 个本地按钮；连续 8 秒 `PerformanceObserver` 未捕获 Long Task（`0` 个、`0ms`），导航 `DOMContentLoaded` 约 `464.5ms`，该结果不等同于 540 行弱机前后对照。
- 2026-09-14 21:24：按散帅要求撤回当前工作区未提交的 Playwright 迁移，恢复 `AGENTS.md`、`CLAUDE.md`、README、验证设计和两套 E2E 到 browser-skill／bsk；移除 `tools/playwright-cdp.js`。保留可转债长列表性能修复及其测试、性能架构文档和 `handoff.md`；`node --test` 44/44、两个 E2E 脚本语法检查、`git diff --check` 均通过。
- 2026-09-14 21:00：按散帅要求使用 browser-skill CLI `0.2.1` 重新检查集思录可转债列表页：启动隔离 session `mdxu` 后导航 `https://www.jisilu.cn/web/data/cb/list`，`bsk observe` 显示页面标题「列表 - 可转债 - 集思录」、数量 `30/30` 条，插件的“仅看本地自选”“仅看待购”筛选和行内“加入本地自选”按钮均已渲染；未点击或修改页面数据。关闭任务标签页后 session 自动移除；`bsk session list --json` 返回 `[]`、`active sessions = 0`，现场只读检查无残留 Agent Window 或任务标签页。本轮未启动新的 daemon，既有 PID `8817` 保持运行。
- 2026-09-14 16:08：接手复验，`node --test` 44/44 通过，`git diff --check` 通过。真实 Chrome 可转债 E2E 首次在 session 创建阶段超时（6 项静态检查通过）；唯一一次重试创建 `mucw` 后，初始空白页 `snapshot` 超时，随后 `session stop mucw` 也超时。两次均未导航到目标页面、未执行网页功能断言或修改测试数据；QDII 与性能前后测量未执行。日志新增 16:06:08 断连、16:06:42 握手首帧超时、16:06:49 重连，以及 16:07:54 用户关闭 Agent Window 后移除 `mucw`。最终 `bsk doctor` 全部通过、session 列表为 `[]`；Chrome 顶部调试提示仍待现场确认，不能认定浏览器收尾全部完成。现有 daemon PID 8817 为本轮开始前已运行，未手动启停。
- 2026-09-14 15:49：散帅现场确认 Chrome 仍显示 BrowserSkill 控制状态。`bsk status` 同时显示浏览器连接为 1，但 `active sessions = 0`，`bsk session list --json` 返回 `[]`；说明 `dtiz` 停止超时后留下了无法通过 session ID 管理的 Chrome 端孤儿窗口或调试附加状态，不能将空 session 列表视为清理完成。受 browser-skill 规则限制，不猜测 session ID、不手动管理 daemon，等待散帅关闭可见 Agent Window 并确认顶部提示是否消失。
- 2026-09-14 15:46：散帅已在 `chrome://extensions` 重新加载未打包扩展。随后两次运行 `node tools/e2e-cb-list.js`：第一次创建 session 等待扩展连接超时；第二次创建 `dtiz` 后页面工具 RPC 超时，功能断言均未开始，静态前置检查分别为 6/7、6/8。`bsk logs` 显示浏览器连接在执行期间断开并出现 `BrowserSinkClosed`，属于 browser-skill 连接故障，不能据此判断插件功能通过或失败；按 Skill 规则停止重试，QDII E2E 未运行。脚本停止 `dtiz` 的命令超时，随后 `bsk session list --json` 虽返回 `[]`，但不能证明 Chrome 端状态已清理。
- 2026-09-14 15:32：`node --test`，44/44 通过；覆盖分帧续扫、存储变化从首行重启全量同步、样式写入幂等、QDII 移出后重新加入恢复名称红色、表格与筛选组缓存及缓存失效路径。`git diff --check` 通过。
- 2026-09-14 15:32：尝试按 browser-skill 生命周期重新加载扩展并执行真实 Chrome E2E；`bsk doctor` 确认 CLI、协议和 1 个浏览器连接正常，但 `chrome://extensions` 导航被 CDP 拒绝并返回 `Detached while handling command`，未能重新加载当前源码，故未运行无效的旧扩展 E2E。已停止本次 session `pswp`，`bsk session list --json` 返回 `[]`；受 browser-skill 规则限制未手动管理其自动启动的 daemon，Chrome 顶部调试提示未能现场确认。
- 2026-09-14 13:28：`node --test`，34/34 通过；发布打包前复跑确认 `0.4.1` 基线，源码与 `35a2917` 提交一致且工作区无未提交改动。
- 2026-09-14 13:28：`release/jisilu-deck-v0.4.1.zip` 已生成并校验：包含 6 个必要运行与说明文件，Manifest 版本为 `0.4.1`，包内文件与当前源码一致，SHA-256 为 `08aba7b3ab68d983d9e7274ce21239ebc52725f0676a2716094530162564ae59`。
- 2026-09-14 13:28：`release/jisilu-deck-v0.4.1-release-notes.md` 已生成，Release Title 为 `jisilu-deck v0.4.1`；GitHub tag、Release 与附件尚未创建或上传。
- 2026-09-11 12:30：按标准 browser-skill 生命周期在单一 session 中创建两个可转债标签页，逐一关闭后停止 session；`bsk session list --json` 返回 `[]`，散帅现场确认任务标签页、Agent Window 和 Chrome 顶部 BrowserSkill 调试提示均已消失。
- 2026-09-11 12:09：检查项目级 `AGENTS.md` 收尾约束与 `ROADMAP.md` 状态记录，并运行 `git diff --check`，确认规则覆盖会话、Agent Window、借用标签页、测试数据、任务启动的 daemon、Chrome 调试提示、临时状态及无法清理时的报告要求。
- 2026-09-11 12:00：`node --test`，34/34 通过；新增可转债名称保持原色且 QDII 名称继续标红的回归覆盖。
- 2026-09-11 12:00：使用 browser-skill CLI `0.2.1` 运行 `node tools/e2e-cb-list.js`，48/48 通过；确认 Manifest 版本为 `0.4.1`、加入及刷新后转债名称保持页面原色，并完成筛选、排序重渲染、SPA 往返和 Agent Window 重建回归；截图为 `/tmp/jd-bsk-e2e.png`，测试数据已恢复，Agent Window 已关闭。
- 2026-09-07：`node --test`，33/33 通过；覆盖待购从属约束、幂等加入、直接清除、本地自选级联清理、写入失败原子性、名称旁入口、双筛选互斥、跨标签页同步和 QDII 回归。
- 2026-09-07：可转债真实 Chrome E2E 48/48 通过，覆盖待购切换、名称同行布局、双筛选、刷新、排序重渲染、SPA 往返、Agent Window 重建和测试数据恢复；截图为 `/tmp/jd-bsk-e2e.png`。
- 2026-09-07：两轮调试失败产生的“洪城转债”“严牌转债”测试记录已准确识别并清理，原有“万讯转债”“闻泰转债”本地自选未改动；所有 browser-skill Agent Window 已关闭。
- 2026-09-07：QDII 真实 Chrome E2E 32/32 通过；确认三张表均无待购入口，欧美与亚洲可用数据完成加入、筛选、刷新和清理，商品表在游客状态无数据行时验证筛选控件和功能边界；截图为 `/tmp/jd-bsk-qdii-e2e.png`，测试数据已恢复。
- `release/jisilu-deck-v0.4.0.zip` 已生成并校验：包含 6 个必要运行与说明文件，Manifest 版本为 `0.4.0`，包内文件与当前源码一致，SHA-256 为 `09b80572deb4d1ad2bf25070e5209510fd7465fa9aecd131a3ad5b05e6c136dc`。
- `release/jisilu-deck-v0.4.0-release-notes.md` 已生成，Release Title 为 `jisilu-deck v0.4.0`；GitHub tag、Release 与附件尚未创建或上传。
- `0.2.0` 单元测试基线：`node --test`，20/20 通过。
- `0.3.0` 单元测试：`node --test`，28/28 通过。
- QDII 真实页面 E2E：`node tools/e2e-qdii.js`，30/30 通过；测试数据已恢复，截图为 `/tmp/jd-bsk-qdii-e2e.png`，Agent Window 已关闭。
- `release/jisilu-deck-v0.3.0.zip` 已生成并校验：包含 6 个必要运行与说明文件，Manifest 版本为 `0.3.0`，包内文件与当前源码一致，SHA-256 为 `dd7ea6bc2fd7990bf9e49fadfd7a491e09da0131904fb507289cc8782e7425ac`。
- `release/jisilu-deck-v0.3.0-release-notes.md` 已生成，Release Title 为 `jisilu-deck v0.3.0`；GitHub tag、Release 与附件尚未创建或上传。
- 真实页面 E2E：`node tools/e2e-cb-list.js`，36/36 通过；测试数据已恢复，Agent Window 已关闭。
- 真实 Chrome 手工验收：散帅确认“仅看本地自选”功能正常。
- 真实 Chrome 分类切换：重新加载扩展后，「可转债 → 封闭基金 → 可转债」返回时本地按钮自动恢复。
- 已覆盖行内按钮注入、顶部筛选按钮位置与状态、筛选交集、加入／移出联动、关闭恢复、刷新、排序重渲染、Agent Window 重建和测试数据清理。
- `release/jisilu-deck-v0.2.0.zip` 已生成并校验：包含 6 个必要运行与说明文件，Manifest 版本为 `0.2.0`，包内文件与当前源码一致，SHA-256 为 `2f91b942d4e72a68dd2efae8776f4b503fd72fc5ffebf7fbe6e4aeb7eae32089`。
- `release/jisilu-deck-v0.2.0-release-notes.md` 已生成，Release Title 为 `jisilu-deck v0.2.0`；GitHub tag、Release 与附件尚未创建或上传。
- Release 发布包：`release/jisilu-deck-v0.1.0.zip` 已生成，包含 6 个必要运行与说明文件，Manifest 版本检查为 `0.1.0`；`release/` 已设置为 Git 忽略目录。

## 已知限制

- 支持可转债列表与 QDII 欧美市场、商品、亚洲市场三张目标表；其他集思录数据表不处理。
- 数据只保存在当前浏览器，不支持云同步。
- 不提供批量管理、导入导出、备注、持仓或独立管理页面。
- 页面适配依赖目标站点的 DOM 结构和图标字体，站点改版后可能失效。

## 后续方向

根据实际使用反馈和公开 issue 决定后续改动；不预设管理界面、成交记录或持仓能力。
