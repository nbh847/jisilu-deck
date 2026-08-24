# jisilu-deck

集思录页面增强 Chrome 插件。在可转债列表现有操作列中增加一个本地自选按钮，把个人自选记录保存在浏览器本机，并用红色转债名称标识已加入状态。

## 当前状态

第一版范围已收敛为行内橙色 `+`／红色 `-`：加入或移出本地自选。文档已经更新，尚未开始编码；当前阶段禁止创建插件代码。

## 已确认边界

- 使用 Chrome Manifest V3。
- 第一版只维护本地自选可转债，不包含持仓功能。
- 不绕过集思录会员权限或访问控制。
- 不请求或抓取需要登录、会员或付费权限才能访问的接口数据。
- 只处理当前页面已经渲染的表格行，不读取行情字段，不批量导出页面内容。
- 与 `kzz-radar` 独立，不共享代码与数据。

## 文档入口

- [`ROADMAP.md`](ROADMAP.md)：当前阶段、已完成事项、待办和验证记录。
- [`docs/product/product-design.md`](docs/product/product-design.md)：第一版产品定义与验收标准。
- [`docs/product/data-rules.md`](docs/product/data-rules.md)：本地自选字段与加减语义。
- [`docs/product/ui-spec.md`](docs/product/ui-spec.md)：橙色 `+`／红色 `-` 的位置、状态和视觉区分。
- [`docs/architecture/implementation-boundaries.md`](docs/architecture/implementation-boundaries.md)：最小权限、页面适配与本地存储边界。
- [`docs/architecture/validation-plan.md`](docs/architecture/validation-plan.md)：进入实现阶段后的手工验收与边界验证计划。
- [`docs/research/README.md`](docs/research/README.md)：实施前必须完成的调研清单与证据要求。
- [`docs/research/2026-08-22-boundary-research.md`](docs/research/2026-08-22-boundary-research.md)：目标页面、服务协议与 Chrome 能力的首轮调研记录。

## 目录结构

```text
.
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── ROADMAP.md
└── docs/
    ├── product/      # 稳定产品定义
    ├── architecture/ # 实施前技术设计
    └── research/     # 页面、数据、条款与平台能力调研
```

插件源码将在产品定义与首轮调研确认后放入 `src/`，当前不创建空代码骨架。
