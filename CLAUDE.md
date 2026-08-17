# jisilu-deck · Claude Code 项目规则

本文件是 Claude Code 在 `jisilu-deck` 项目内的行为约束。全局规则在 `/Users/mac/.claude/CLAUDE.md`，workspace 规则在 `/Users/mac/workspace/CLAUDE.md`；本文件只补充项目特有约定。冲突时以本文件为准（红线与安全约束除外）。

## 项目身份

- 名称：`jisilu-deck`
- 定位：集思录页面增强 Chrome 插件——浏览集思录时在页面上展示个人当前持仓与自选可转债
- 散帅：bni
- workspace 内路径：`/Users/mac/workspace/jisilu-deck`
- 同级相关项目：`kzz-radar`（可转债研究与决策辅助，两者定位不同，互不归属）；`WhiteHorseWeb`（投资管理系统）

## 启动读取顺序

进入本项目时按顺序读：

1. `/Users/mac/workspace/WORKSPACE.md`
2. 本文件（`CLAUDE.md`）
3. `AGENTS.md`（与 Codex 共用的通用规则源）
4. `ROADMAP.md`
5. 与当前任务直接相关的 `docs/` 文档

## 项目边界（立项时确认）

- **形态**：Chrome 浏览器插件（Manifest V3），作用于集思录网站页面。
- **两类数据**：持仓与自选是两类数据，数据模型与维护方式需分别设计，不得混同。
- **权限红线**：实现不以绕过集思录会员权限或访问控制为目标；不抓取需登录/付费才能访问的接口数据。
- **与 `kzz-radar` 的关系**：独立项目，不共享代码与数据；`kzz-radar` 面向策略研究与决策，本插件面向浏览集思录时的个人数据展示。

## 技术约定

- 代码、命令、变量名、文件名用英文；文档与注释默认中文。
- 新增依赖前先检查项目已有依赖与 Chrome 平台原生能力（storage、sidePanel 等 API）。
- 涉及集思录页面结构的选择器解析逻辑集中在独立模块，页面改版时只改该模块。

## 验证要求

- 插件功能改动后，在 Chrome `chrome://extensions` 加载未打包扩展实测，不只跑单测。
- 每轮验证在 `ROADMAP.md` 记录验证方式与结果。
