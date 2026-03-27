# Agent Studio Cloud Platform Design

## Background

`agent-studio` 当前实现更接近本地单操作者工作台，而不是企业内部云端平台：

- 后端鉴权使用单一 `Bearer token`，没有用户、组织、角色模型。
- `session` 仅保存在内存中，实例重启后立即丢失。
- `thread`、消息历史、Zendesk 配置保存在本地 `temp/*.json` 文件中。
- 前端直接暴露模型、工作目录、沙箱、审批、联网、附加目录等底层运行参数。
- 目录访问控制依赖全局白名单，而不是按用户、角色、场景动态授权。

这些约束在本地验证阶段可接受，但会直接阻碍云端部署、多用户使用、审计留痕和后续外部扩展。

## Confirmed Scope

### Business scope

- 初期面向同一家公司、同一个钉钉企业内部员工统一使用。
- 未来预留扩展到外部客户/合作方直接使用，但本期不实现多租户产品能力。

### User expectations confirmed in design discussion

- 每个会话拥有独立工作目录。
- 管理员可为不同用户灵活配置可访问目录、skill 组合和 agent 模式。
- 用户不必看到具体底层配置细节。
- 当前散落在前端或本地配置中的能力要迁入管理员后台。
- 用户身份与钉钉账户关联，优先复用 `ReportHub` 中已验证的钉钉实现思路。

## Goals

1. 将系统从“本地工具”升级为“企业内部 Agent 平台”。
2. 建立统一身份与权限体系，替代单 token 鉴权。
3. 建立运行策略层，将用户可见能力与底层运行参数解耦。
4. 建立可持久化的数据模型，支持云端部署与多实例扩缩容。
5. 建立管理员后台，统一管理用户、工作区、skill 包、agent 模式和集成。
6. 为未来扩展到外部客户场景预留组织隔离边界，但不提前实现完整 SaaS 多租户。

## Non-goals

- 本期不实现外部客户自助注册或多租户计费。
- 本期不引入复杂的跨公司协作能力。
- 本期不实现所有集成的自动化编排，只先完成钉钉与现有 Zendesk 能力的后台化和治理化。

## Recommended Product Direction

采用“单租户企业平台化改造”方案，而不是直接把当前结构原样部署到云上。

该方向的核心思想是：

- 员工前台只暴露“被授权的助手能力集合”。
- 管理员后台负责控制人、资源、能力、风险、成本。
- 运行层在每次会话启动时，把后台策略翻译为底层 `workspace`、附加目录、skill、模型、网络与审批配置。

这保留了当前项目已有的聊天与工具调用主链路，同时避免在未来为身份、审计、权限和扩展能力付出指数级返工成本。

## Current Codebase Observations

以下现状决定了改造边界：

- `agent-api/src/config.ts`
  - 使用环境变量维护默认模型、白名单工作目录和单一鉴权 token。
- `agent-api/src/session-store.ts`
  - 使用内存 `Map` 保存 session 状态。
- `agent-api/src/thread-store.ts`
  - 使用本地 JSON 文件保存 thread、messages 和 feedback。
- `agent-api/src/index.ts`
  - 直接暴露文件浏览、工作目录、上传目录、thread/session 管理 API。
- `agent-ui/src/App.tsx`
  - 员工前台承担大量原本应属于后台策略层的运行参数配置。
- `agent-api/src/integrations/zendesk/*`
  - Zendesk 功能已有单独模块边界，但配置仍是本地文件态。

## Target Architecture

### 1. Employee Portal

员工前台面向“使用”而不是“配置”。核心能力：

- 登录并进入个人工作台
- 新建会话
- 选择被授权的 agent 模式
- 选择被授权的项目空间 / 资料集
- 上传附件
- 查看历史会话、生成文件和运行结果

### 2. Admin Console

管理员后台面向“治理”。核心能力：

- 用户与部门管理
- 角色与权限管理
- 工作区和资料集管理
- skill 包管理
- agent 模式管理
- 运行策略模板管理
- 集成中心
- 会话审计与监控

### 3. Runtime Layer

运行层负责把产品层配置转换为实际运行参数：

- 会话初始化
- 资源挂载
- 权限快照生成
- 模型与工具执行
- 文件产物生命周期管理
- 运行日志与审计日志采集

## Core Design Principles

### Principle 1: User-facing resources must be logical, not physical paths

用户看到的是：

- 项目空间
- 资料集
- 助手模式

系统内部再把它们映射到真实目录、仓库或存储前缀。这样可以避免把服务器真实路径暴露给员工，也为未来从本地文件系统迁移到 Git、对象存储或共享存储留出空间。

### Principle 2: Runtime permissions are policy-driven, not manually entered by end users

当前前台允许员工手动输入工作目录、附加目录、联网策略、沙箱模式等参数。这在云端平台中不再合适。

后续应由后台定义：

- 哪些角色可用哪些 mode
- 哪些 role / mode 可访问哪些工作区
- 哪些 skill 包默认或可选启用
- 哪些 run profile 控制网络、审批、搜索、写入等能力

### Principle 3: Session snapshots must be immutable after creation

当一次会话启动时，系统需要把当时生效的权限和运行策略固化为快照，供该 session 使用。这保证：

- 同一会话行为一致
- 审计可追溯
- 复盘可复现

## Identity and Access Model

### Identity source

钉钉是主身份源：

- 用于员工登录
- 用于部门与人员同步
- 用于后续通知和审批通道

平台仍需维护本地用户主表，保存平台角色、状态、授权范围、审计信息。

### Roles

推荐初期角色集：

- `super_admin`
- `admin`
- `team_lead`
- `employee`

### Permission layers

采用两层权限模型：

1. 功能权限
   - 决定用户能否访问后台模块和具体管理操作。
2. 运行权限
   - 决定会话可用的 mode、workspace、knowledge set、skill package 和 run profile。

## Resource Model

### Workspaces

工作区是逻辑资源，不直接等于一个物理目录。它表示一组可被 agent 使用的主工作环境，例如：

- 项目代码库
- 文档目录
- 文件目录
- 混合型知识空间

### Knowledge sets

资料集用于挂载 FAQ、SOP、产品资料、脚本库等辅助知识源。

### Session work directories

每个会话自动创建独立工作目录，用于：

- 上传附件
- 生成文件
- 导出结果
- 临时中间产物

该目录不应承担平台主数据存储职责，只作为会话级工作区。

## Agent Capability Model

### Agent modes

mode 表示场景入口，例如：

- `chat`
- `knowledge_qa`
- `coding`
- `zendesk_assistant`
- `ops_assistant`

### Skill packages

skill package 是 skill 的平台化分组，用于后台控制发布、版本、可见性与授权范围，而不是让用户直接感知底层 skill 文件集合。

### Run profiles

run profile 定义底层执行策略，包括：

- 默认模型
- 推理深度
- 文件权限
- 网络访问
- 搜索模式
- 审批策略
- 上传限制
- 产物保留时间

mode、skill package 和 run profile 需要解耦：

- mode 负责“这个助手是什么场景”
- skill package 负责“这个助手能用哪些能力”
- run profile 负责“这个助手底层怎么运行”

## Admin Console Modules

推荐后台一级导航：

- 总览
- 用户与组织
- 角色与权限
- 工作区
- 资料集
- Agent 模式
- Skill 包
- 运行策略
- 集成中心
- 会话与审计
- 监控与配额
- 系统设置

MVP 阶段优先实现：

- 总览
- 用户与组织
- 工作区
- Agent 模式
- Skill 包
- 运行策略
- 集成中心
- 会话与审计

## Frontend Changes

员工前台需要从“自由配置台”改造成“受控选择台”。

保留：

- 新建会话
- 历史会话
- 模式选择
- 工作区选择
- 文件上传与结果查看

移除或后台化：

- 真实工作目录输入
- 附加目录自由输入
- 沙箱模式手工选择
- 审批策略手工选择
- 网络/搜索底层策略手工选择

## Data Persistence Strategy

### Replace in-memory and JSON stores

以下内容需要迁移到数据库：

- users / departments / roles / policies
- sessions
- threads
- messages
- feedback
- integrations
- settings
- audit logs

### File storage

以下内容需要迁移到对象存储或可共享文件存储：

- 上传附件
- 生成文件
- 会话工作目录中的持久化产物

本地 `temp` 目录仅保留真正临时文件。

## DingTalk Integration

推荐复用 `ReportHub` 中已落地的设计思路：

- 钉钉内免登
- 浏览器 OAuth 登录
- `corp_id / unionid / userid` 映射
- 部门与用户同步
- 回调驱动同步任务

迁移原则：

- 复用设计思路和关键流程
- 按当前 Node/TypeScript 技术栈重新实现
- 避免把 `ReportHub` 的业务域逻辑直接复制到本项目

## Zendesk Integration Direction

当前 Zendesk 模块已经具备较清晰的集成边界，后续重点不是重写，而是：

- 将配置从本地 JSON 迁入统一集成中心
- 为其增加 role / mode / workspace 绑定能力
- 为其增加审计和运行监控能力
- 与统一身份、策略系统打通

## Deployment Direction

推荐部署形态：

- 前端：静态站点或 Node 服务
- 后端：容器化 API 服务
- 数据库：PostgreSQL
- 文件/产物：对象存储或共享存储
- 日志与指标：集中观测方案

不建议继续依赖单实例本地磁盘保存业务关键状态。

## Implementation Phases

### Phase 0: Cloud readiness foundation

- 数据持久化替换内存与 JSON 文件存储
- 文件存储抽象化
- 基础健康检查和日志增强

### Phase 1: Identity and user model

- 钉钉登录
- 用户、部门、角色模型
- 替换单 token 鉴权

### Phase 2: Admin console and policy center

- 管理后台基础版
- 工作区、mode、skill package、run profile 管理
- 集成中心初版

### Phase 3: Runtime resource controls

- session workdir
- workspace / knowledge set / skill package 绑定
- session 权限快照

### Phase 4: Audit, observability, quota

- 审计日志
- 运行监控
- 配额与成本

### Phase 5: Collaboration and business workflows

- 会话分享
- 知识沉淀
- 钉钉通知与审批
- 集成联动增强

### Phase 6: External readiness

- 关键数据表预留 `organization_id`
- scope 边界完善
- 外部身份源扩展准备

## Risks and Mitigations

### Risk 1: Scope explosion

缓解方式：

- 先做单公司、单租户基础平台
- 把多租户作为结构预留，而不是本期交付目标

### Risk 2: Frontend and backend responsibilities remain mixed

缓解方式：

- 明确前台只做授权后的选择与使用
- 明确后台负责策略配置与资源治理

### Risk 3: Runtime behavior drifts with config changes

缓解方式：

- 会话启动时生成快照
- 运行中不实时引用后台变更

### Risk 4: Direct physical path exposure leaks infrastructure details

缓解方式：

- 用逻辑工作区与资料集抽象资源
- 只在后台映射真实路径或存储目标

## Final Recommendation

第一阶段应优先解决三个阻塞点：

1. 持久化与云端部署基础
2. 钉钉登录与用户体系
3. 管理后台与运行策略中心

只有这三项落地后，后续“每会话独立目录、skill 组合、agent mode 分级、资源授权、审计治理”才有稳定基础。
