# design.md - agent-studio

这是 `agent-studio` 的项目级设计约束文档。它从 Vercel `design.md` 和 Web Interface Guidelines 中提取适合本项目的部分，用于约束 AI Agent 控制台、管理后台、开发者工具和公开入口的 UI/UX。它可以借鉴 Geist，但不能变成 Vercel 品牌复刻。

参考来源：

- Vercel Geist design system: https://vercel.com/design.md
- Vercel Web Interface Guidelines: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
- App 基础样式：`agent-ui/src/styles.css`
- Admin token：`agent-ui/src/features/admin/admin-console.css`
- Runtime branding：`agent-ui/src/features/branding/`
- Portal theme：`agent-ui/src/features/portal/workbench/theme.ts`

## 产品判断

`agent-studio` 是 AI 工作控制台。用户的目标是配置能力、审计对话、查看 usage、管理访问、调试集成、控制风险。界面应该精确、冷静、技术感强、响应快。

设计优先级：

1. 操作清晰优先于装饰效果。
2. 可品牌化优先于硬编码 Vercel 身份。
3. Geist 式层级和克制优先于 ERP 式密度。
4. Assistant/Admin 工作流优先于营销页结构。
5. 可访问、可深链、可恢复优先于视觉新奇。

从 Vercel 借用的是：中性表面、灰阶信息层级、4px 间距、紧凑圆角、微弱阴影、精确文案、可见 focus、短动效、mono 数据展示。不要照搬 Vercel 的品牌色、Logo 语气或完整视觉身份。

## 设计落点

全局视觉和交互规则应集中在：

| 目标 | 文件 |
|---|---|
| 基础 App CSS | `agent-ui/src/styles.css` |
| Admin CSS variables | `agent-ui/src/features/admin/admin-console.css` |
| Runtime branding | `agent-ui/src/features/branding/runtime.ts` |
| Portal AntD theme | `agent-ui/src/features/portal/workbench/theme.ts` |
| Assistant 交互 | 优先使用 `assistant-ui` 既有模式 |

避免在 feature component 中硬编码颜色、圆角、阴影。优先使用 CSS variables、AntD theme token 和共享 shell class。

## 界面分层

`agent-studio` 至少有两类界面，它们共享可访问性、文案、状态反馈和品牌安全规则，但视觉密度不同。

### Admin Console

适用范围：管理员后台、组织/用户/权限、usage、billing、audit、monitoring、integration、skill/capability 管理、系统设置。

设计目标：

- 让内部用户快速定位问题、比较数据、执行配置和回滚风险。
- 允许高信息密度、表格、筛选、排序、批量操作和多面板布局。
- 优先使用 `agent-ui/src/features/admin/admin-console.css` 的 `--admin-*` token。
- 关键数据使用 mono 展示，例如 token、cost、latency、thread ID、run ID、model、plugin name。
- 表格状态、筛选、tab、分页在需要复盘/分享时进入 URL。

不要做：

- 不要为了视觉留白牺牲审计和排障效率。
- 不要把登录页/公开页的玻璃卡片和大 hero 布局搬进高频管理页面。
- 不要在 admin 页面硬编码 portal 橙色，除非这是明确的跨端品牌决策。

### Portal / Public Surface

适用范围：公开分享页、访问申请页、用户自助入口、portal workbench、邀请/授权相关页面。

设计目标：

- 让外部或低频用户低成本完成单一任务。
- 使用 `BrandingProvider`、runtime branding 和 `PORTAL_ANTD_THEME`，避免硬编码平台身份。
- 信息量逐步展示，默认只暴露用户完成当前任务所需的内容。
- CTA 明确且少，页面要解释下一步会发生什么。
- 表单更少、更大、更明确；移动端触控目标至少 `44px`。

不要做：

- 不要使用 admin 式高密度表格、复杂筛选、内部术语和批量操作。
- 不要暴露本地路径、内部目录、manifest 路径、API token、secret、服务器名或实现细节。
- 不要让 portal 继承 admin console 的排障/审计信息，除非用户角色和业务目标明确需要。

### 共享底线

- 两类界面都必须有 visible focus、语义化按钮/链接、可恢复错误、loading/empty 状态。
- 两类界面都不能只靠颜色表达状态。
- 两类界面都必须尊重 runtime branding 的边界：可品牌化页面用品牌配置，内部 admin 页面用管理后台 token。
- 同一功能同时存在 admin 和 portal 入口时，admin 展示控制与诊断，portal 展示完成任务所需的最小路径。

## 视觉系统

用 Geist 原则解释当前项目 token：

| 角色 | Token | Light | Dark | 用途 |
|---|---|---:|---:|---|
| App 背景 | `--admin-color-bg` | `#f3f4f6` | `#000000` | 控制台背景 |
| 玻璃表面 | `--admin-color-surface` | `rgba(255,255,255,.75)` | `rgba(28,28,30,.75)` | 面板、玻璃卡片 |
| 实体表面 | `--admin-color-surface-solid` | `#ffffff` | `#1c1c1e` | 表格、表单、popover |
| 边框 | `--admin-color-border` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.1)` | 分隔线、卡片边框 |
| 主文本 | `--admin-color-text` | `#111827` | `#f5f5f7` | 主要内容 |
| 次文本 | `--admin-color-subtle` | `#6b7280` | `#86868b` | 元信息、说明 |
| 强调色 | `--admin-color-accent` | `#0066ff` | `#0a84ff` | 主操作、链接、focus 意图 |
| 弱强调 | `--admin-color-accent-soft` | `rgba(0,102,255,.1)` | `rgba(10,132,255,.15)` | 选中、hover 背景 |

状态色规则：

| 状态 | 用途 |
|---|---|
| Blue | 链接、focus、AI/Admin 主操作 |
| Green | 健康、已同步、启用、完成 |
| Amber | 待审、接近限制、需要关注 |
| Red | 失败、阻断、危险操作 |
| Purple/Teal | 仅用于分类，并且必须有文字标签 |

状态不能只靠颜色表达。Chip/Tag 必须有可读文字，必要时配图标。

## 字体

保留当前中英文稳定字体栈：

```css
"PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif
```

代码、ID、模型名、token、费用、时延、日志使用 mono 栈：

```css
ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace
```

字号规则：

| 角色 | 尺寸 | 用途 |
|---|---:|---|
| 页面标题 | `28-42px` | 登录、公开入口、主 landing |
| 区块标题 | `20-24px` | Dashboard、设置向导 |
| 卡片标题 | `16-18px` | Admin panel、配置组 |
| 正文/UI | `14px` | 默认内容 |
| 元信息 | `12-13px` | ID、时间戳、辅助提示 |

Usage、cost、latency、tokens、runs 等可比较数字使用 `font-variant-numeric: tabular-nums`。

## 间距与形状

使用 Vercel 的 4px scale：

| 间距 | 用途 |
|---:|---|
| `4px` | 图标与文字、小间隔 |
| `8px` | 紧凑组、chip 内部 |
| `12px` | 控件组、表格单元格 |
| `16px` | 默认卡片/面板节奏 |
| `24px` | 页面区块、dashboard grid |
| `32px` | 登录/公开卡片 padding |
| `40px` | 大区块分隔 |

圆角策略：

| Token | 值 | 用途 |
|---|---:|---|
| `--admin-radius-sm` | `6px` | 小控件、tag、inline code |
| `--admin-radius-md` | `12px` | 卡片、输入框、表格容器 |
| `--admin-radius-lg` | `16px` | Drawer、Modal、大面板 |
| `--admin-radius-xl` | `24px` | 登录卡片、公开 hero |
| `--admin-radius-full` | `999px` | pill、头像、圆形按钮 |

一个视图不要混用太多圆角族。密集 admin 表格优先 `12px`，登录/公开入口可以使用 `20-24px`。

## 表面与阴影

优先用色调、边框和层级表达结构，阴影保持克制：

| 层级 | Token |
|---|---|
| 小卡片 | `--admin-shadow-sm` |
| Dashboard 卡片、sticky 面板 | `--admin-shadow-md` |
| Modal、Drawer、命令面板 | `--admin-shadow-lg` |

玻璃拟态和渐变只适合登录页、公开分享页、控制台首页这类高层级入口。不要把每个操作面板都做成玻璃卡片，尤其不要牺牲文字对比度。

## 组件

优先使用现有系统：

| 场景 | 使用 |
|---|---|
| Chat / assistant 交互 | `assistant-ui` 既有模式 |
| Admin layout | 现有 admin console shell + CSS variables |
| 表单、表格、弹窗 | Ant Design + 项目 token |
| Runtime brand | `BrandingProvider` + branding runtime |
| Public portal | `PORTAL_ANTD_THEME` + public branding |
| 图标 | `lucide-react` 或 AntD icons |

规则：

- 每个视图只突出一个 primary action。
- 次操作使用 default/ghost/dropdown。
- Icon-only button 必须有 `aria-label`。
- 危险操作使用 red 语义，并必须确认或可撤销。
- 禁用控件如果原因不明显，需要 tooltip/help text。

## AI 与 Assistant UX

Agent 工作流比普通 CRUD 更需要解释和反馈。

规则：

- 展示 AI 当前在做什么、用了什么输入、会改什么输出。
- Streaming/loading 保持布局稳定，避免内容跳动。
- 长 AI 输出支持复制、展开/折叠、安全换行。
- Tool call、plugin run、model、thread ID、cost 使用 mono 展示。
- 高风险 AI 操作先 preview，再 apply。
- 集成失败时说明失败系统、原因和下一步。
- 公开文案不得暴露本地路径、内部目录、manifest 路径、API token、secret 或实现细节。

## 表格、指标与日志

本项目有大量 audit、usage、billing、monitoring、conversation 视图。

规则：

- 数字使用 tabular figures。
- tokens、cost、latency、run count 这类比较字段应可排序。
- 大列表必须分页、虚拟滚动或有界渲染。
- 用户需要复盘/分享时，表格状态进入 URL。
- 空表格说明第一条数据如何产生。
- 日志和 ID 必须安全换行或截断，并提供复制能力。
- 用户生成内容要处理极短、正常、极长三种情况。

## 表单与配置

配置界面要防止不可逆错误。

规则：

- 每个输入需要可见 label 或 accessible label。
- 使用正确的 `type`、`inputMode`、`name`、`autocomplete`。
- API key、domain、email、username、code、ID 禁用 spellcheck。
- 不要阻止粘贴。
- inline validation，提交失败后 focus 第一个错误字段。
- 点击前 submit 保持可用；请求开始后显示进度。
- 脏表单离开页面前提醒。
- secret 字段的 reveal/copy 必须受权限约束。
- 连接测试要说明检查了什么，失败后下一步是什么。

## 导航与状态

用户会跨工具操作，不能丢上下文。

规则：

- 导航用 link，不要在 `div`/`span` 上写点击跳转。
- search、filter、tab、pagination、selected org/project、expanded panel 影响视图时要 deep-link。
- Back 应保留上一个列表/过滤上下文。
- public share 和 access-request route 要能刷新后恢复。
- Settings 页面必须清楚区分 draft、saved、published、runtime state。

## 可访问性

从 Web Interface Guidelines 必须保留的底线：

- Icon-only button 必须有 `aria-label`。
- 装饰图标使用 `aria-hidden="true"`。
- focus 必须通过 `:focus-visible` 可见。
- 禁止移除 outline 后不提供替代 focus。
- 优先使用语义 HTML，而不是先写 ARIA。
- 自定义异步反馈要能被辅助技术感知。
- Modal/Drawer 不应泄露背景滚动和背景交互。
- 图片需要尺寸和 alt，装饰图除外。
- 尊重用户缩放和 `prefers-reduced-motion`。

## 动效

动效只用来解释复杂状态变化。

建议：

- `150ms` 用于 hover、active、focus、selected。
- `200ms` 用于 popover、tooltip、command surface。
- `300ms` 是 Modal、Drawer、route reveal 上限。
- 优先动画 `opacity` 和 `transform`。

禁止：

- `transition: all`
- 装饰性循环 glow
- 用慢 shimmer 掩盖真实进度
- 延迟用户操作的动画

## 文案

文案就是 UI，必须直接、可操作。

规则：

- 按钮文案说明动作和对象，例如 `Create Skill`、`Save API Key`、`Run Sync`。
- 避免 `OK`、`Confirm`、`Continue`、`Submit`。
- 错误信息说明失败原因和下一步。
- 空状态说明数据如何出现。
- loading 文案使用真正省略号：`Syncing…`，不要写 `Syncing...`。
- 不写 `successfully`，直接说变化结果。
- 数量用数字。
- 时间、货币、数量使用 `Intl.DateTimeFormat` 和 `Intl.NumberFormat`。
- 中文 UI 保持短句和动作导向；英文按钮/tab 用 Title Case，helper/toast 用 sentence case。

## 公开与品牌化界面

Runtime branding 是产品能力，不是装饰。

规则：

- 除非品牌配置要求，不要把 Vercel、OpenAI 或 Baicells 视觉身份硬编码进公开页。
- 公开页使用 `BrandingProvider` 提供的品牌值。
- 品牌图片需要 alt 或明确按装饰处理。
- theme color 和 favicon 应跟随 runtime branding。
- `PORTAL_ANTD_THEME` 的橙色只属于 portal surface，不应无意扩散到 admin console。

## 反模式

不要引入：

- Vercel 品牌克隆。
- 已有 CSS variables 时仍硬编码颜色。
- 在 assistant conversation 中使用 ERP 式密集表单。
- 每个 admin panel 都套玻璃拟态。
- 用 emoji 充当功能图标。
- 没有 accessible name 的图标按钮。
- 只靠颜色表达状态。
- `transition: all`。
- 无边界渲染大型 `.map()` 列表。
- 没有 label 的输入框。
- 硬编码日期、数字、货币格式。
- 公开文案泄露 secret、本地路径、token 或内部基础设施。

## UI 变更完成标准

一个 UI 改动完成前必须满足：

- 使用共享 token、CSS variables 或 AntD theme。
- 涉及公开入口时保留 runtime branding。
- 在 375px、768px、1024px、1440px 下可用，或说明例外原因。
- 键盘能到达所有交互控件。
- focus 状态可见。
- empty、loading、error、长内容状态已处理。
- 需要复盘/分享的表格和过滤状态已进入 URL。
- 时间显示跟随用户本地时区。
- 数字和货币使用 locale-aware formatting。
- AI/集成失败状态包含下一步。
- 公开界面不泄露 secret 或实现细节。
- 已运行相关前端检查/测试，或说明未运行原因。
