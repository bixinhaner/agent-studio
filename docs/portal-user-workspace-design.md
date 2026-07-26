# Portal 用户工作区最终设计基线

状态：最终设计基线

更新时间：2026-07-26

适用范围：Agent Studio Portal 用户入口

本文档定义 Portal 从“按时间排列会话”演进为“用户工作区”的最终产品、交互和技术基线。实现不得把它解释为新建一套云桌面、IDE 或独立文件管理产品。

核心方案是：

- 方案 1 负责全局导航：左侧展示工作区、文件夹和文件夹内的任务。
- 方案 2 只作为文件夹内容态：点击文件夹后，中间展示文件、最近任务和 Agent 变化。
- 现有 Assistant 负责任务态：点击任务后，中间继续使用现有聊天。
- 现有 Preview Workbench 负责文件态：点击文件后，右侧或移动端全屏展示预览和版本。

## 用户心智

用户只需要理解一句话：

> 文件夹是工作的地方，任务是 Agent 在这个地方做过的一件事，文件是任务使用或产生的结果。

这句话是产品文案、信息架构和技术模型的共同约束。

### 术语

| 用户术语 | 产品含义 | 技术落点 |
|---|---|---|
| 我的工作区 | 用户长期保存文件和任务的私人空间 | `UserWorkspace` |
| 文件夹 | 组织文件、限定 Agent 工作范围 | `WorkspaceNode(kind=folder)` |
| 文件 | 长期存在、可预览和有版本的用户资料 | `WorkspaceNode(kind=file)` |
| 任务 | 用户与 Agent 为完成一个目标产生的会话 | 现有 `Thread` |
| 智能体产出 | Agent 创建或修改的文件智能视图 | `createdByType=agent` 查询 |
| 最近使用 | 最近访问的文件、文件夹和任务智能视图 | 访问事件聚合 |
| 版本 | 同一逻辑文件的一次内容快照 | `WorkspaceFileVersion` |
| 本次变化 | 一次 Agent 执行带来的文件变化集合 | `WorkspaceChangeSet` |
| 回收站 | 可恢复的软删除内容 | `state=trashed` |

“智能体产出”和“最近使用”是智能视图，不是物理文件夹，不复制文件。

## 最终视觉基线

以下 ImageGen 效果图是前端实现的视觉事实来源。实现阶段不得只参考本文文字自行发挥。

1. [桌面端：文件夹主页](assets/portal-user-workspace-design/01-desktop-folder-home.png)
2. [桌面端：任务聊天](assets/portal-user-workspace-design/02-desktop-task-conversation.png)
3. [桌面端：文件预览与版本](assets/portal-user-workspace-design/03-desktop-file-preview-versions.png)
4. [移动端：工作区导航](assets/portal-user-workspace-design/04-mobile-workspace-navigation.png)

桌面效果图统一归一化为 `1440 × 900`；移动端效果图归一化为 `393 × 852`，可以直接作为视觉对比输入。

### 效果图使用规则

- 图 1 是文件夹主页的唯一桌面基线。
- 图 2 是任务聊天与工作区并存的唯一桌面基线。
- 图 3 是文件预览、来源和版本信息的唯一桌面基线。
- 图 4 是移动端导航层级和触控密度的唯一基线。
- 效果图中的橙色只表示 runtime branding 的示例值，实现必须使用 `BrandingProvider` 和 Portal theme token。
- 效果图中的 Office/PDF 图标应使用项目选定的图标库或已有文件类型图标，不允许用 emoji、文本字形或手绘 SVG 代替。
- 效果图没有覆盖的 loading、empty、error、focus、hover、menu 和 confirmation 状态，按 `design.md` 补齐，但不得改变主要布局。

## 信息架构

### 桌面

桌面保留三栏工作台：

| 区域 | 宽度基线 | 职责 |
|---|---:|---|
| Workspace Rail | `264px`，允许在 `240–280px` 内响应 | 文件夹、任务、最近使用、智能体产出、回收站 |
| Main Workbench | 剩余弹性宽度，最小 `560px` | 文件夹主页或现有聊天 |
| Preview Workbench | 默认 `360px`，文件版本态可到 `430px` | 文件预览、来源、版本、本次变化 |

在 `1024–1279px`：

- 左栏保持可折叠。
- 右侧预览改为覆盖式 Drawer。
- 中间聊天不被压缩到小于可读宽度。

在 `<1024px`：

- 不显示三栏并排。
- 使用导航 → 文件夹 → 任务/文件的逐层进入。

### 左侧 Workspace Rail

固定顺序：

1. `新建任务`
2. 全局搜索
3. `最近使用`
4. `智能体产出`
5. `我的工作区`
6. 文件夹树
7. `回收站`

文件夹树规则：

- 左栏不展示文件。
- 仅选中文件夹展开任务子项。
- 默认展示该文件夹最近 5 个未归档任务，超过后显示 `查看全部`。
- 其他文件夹仅显示名称，不预加载任务。
- 文件夹支持展开、重命名、移动和移到回收站。
- 任务支持重命名、移动到文件夹和归档。
- 文件夹与任务不能只靠图标区分，必须使用不同图标和层级缩进。
- 选中态使用 branding soft token，同时保留清晰文字和 focus ring。

### Main Workbench 的两个状态

#### 文件夹主页

选择文件夹但未选择任务时显示：

- breadcrumb
- 文件夹标题
- 文件数、任务数和最近更新时间
- 唯一主操作 `新建任务`
- 次操作 `上传文件`、`新建文件夹`
- 最近一次 Agent 完成状态
- 文件列表
- 最近任务

文件列表桌面使用表格样式，但不使用 Admin Console 的高密度表格：

| 列 | 规则 |
|---|---|
| 名称 | 文件类型图标、名称，文件夹排在文件之前 |
| 修改时间 | 使用用户本地时区和相对时间 |
| 来源 | `我上传`、`Bailey 创建`、`某任务修改` |
| 操作 | hover/focus 后显示，键盘仍可到达 |

双击不是完成核心操作的必要条件。单击文件即可预览，行尾菜单提供重命名、移动、下载、版本和移到回收站。

#### 任务聊天

选择任务时：

- 中间继续使用现有 assistant-ui Thread。
- 顶部增加只读 breadcrumb，表达任务所在文件夹。
- 不增加独立“任务详情页”。
- 文件读取、生成和修改通过现有消息流中的 Action/Artifact 卡片展示。
- Composer 上传文件默认进入任务所属文件夹。
- Agent 运行状态要说明当前动作和文件数量，不展示内部路径。

### Preview Workbench

没有选中文件时显示空状态：

> 选择一个文件查看内容、版本和来源

选中文件时：

- 标题使用文件名。
- 展示来源与用户本地时间。
- 复用现有 DOCX、XLSX、PPTX、PDF、图片、Markdown、HTML 预览。
- 提供下载和更多菜单。
- 版本记录默认折叠或位于预览下方，不抢占主要内容。
- 旧版本提供 `恢复此版本`，当前版本只显示状态。
- 恢复旧版本会创建新版本，不覆盖或删除历史版本。
- 不展示绝对路径、storage key、Thread ID、run ID 或内部错误栈。

## 移动端

移动端不压缩桌面三栏，不做横向多面板。

导航层级：

1. 工作区主页
2. 文件夹主页
3. 任务聊天或文件预览

规则：

- 所有主要触控目标至少 `44px`。
- 顶部 Back 必须恢复上一个文件夹和滚动位置。
- 点击文件夹进入全屏文件夹主页。
- 点击任务进入现有全屏聊天。
- 点击文件进入全屏预览。
- 文件版本从预览页底部 Drawer 打开。
- 上传进度使用不遮挡主任务的底部状态条。
- 文件夹树在移动端降级为列表逐层进入，不保留桌面树缩进。

## 默认进入行为

### 已有用户

- URL 已包含 Thread 时，继续打开原 Thread。
- URL 没有任务定位时，默认打开 `最近使用`，保持当前时间线的查找习惯。
- 左栏同时显示新的工作区入口。
- 用户第一次选择文件夹后，后续恢复最近文件夹上下文。

### 新用户

- 自动创建“我的工作区”，不显示初始化向导。
- 默认显示工作区根目录空状态：

> 这里会保存你上传的文件和 Bailey 的产出。

提供三个动作：

- `上传文件`
- `新建文件夹`
- `让 Bailey 帮我整理`

不自动创建一批无法判断用途的示例文件夹。

## 核心用户流程

### 新建任务

1. 用户在左栏选择文件夹。
2. 点击 `新建任务`。
3. 系统创建 Thread，并自动写入 `workspaceId` 和 `folderId`。
4. 中间进入空聊天。
5. Agent 默认只能访问当前文件夹和用户显式引用的其他文件。

如果用户从 `最近使用` 点击 `新建任务`：

- 使用最近选择的文件夹。
- 没有最近文件夹时放入工作区根目录。
- 不弹出必填文件夹选择框。

### 上传文件

1. 从文件夹主页上传时，保存到当前文件夹。
2. 从任务 Composer 上传时，保存到任务所属文件夹并建立 `input` 绑定。
3. 上传完成后立即出现在文件列表。
4. 同名冲突默认 `保留两份`，使用本地化副本名称。
5. `替换现有文件` 放在显式二级选择中，执行时创建新版本。

首版保留现有单文件 `128 MB` 限制，但新增：

- 工作区总配额。
- 明确的单文件/工作区限制文案。
- 取消上传。
- 每个文件独立进度和失败重试。
- 服务端超时错误提示下一步。

### Agent 读取文件

- 任务启动时把当前文件夹作为默认范围。
- 用户通过 `@文件` 引用工作区其他位置时，增加显式只读输入绑定。
- Agent 消息展示 `已读取 3 个文件`，按需展开名称。
- 不在提示词或 UI 中暴露服务器路径。

### Agent 创建或修改文件

1. Agent 在本次运行的 staging workspace 中工作。
2. 运行结束后系统计算文件 diff。
3. 创建 `WorkspaceChangeSet`。
4. 新建和普通修改生成新文件/版本。
5. 删除、批量移动、越出当前文件夹的变化先等待用户应用。
6. 聊天中显示本次变化摘要。
7. 用户可以预览、应用或撤销。

默认语义：

- “生成修改版”创建同目录新文件。
- “修改此文件”创建同逻辑文件的新版本。
- Agent 不直接覆盖历史版本。

### 移动任务

- 移动任务只改变它的默认工作文件夹和未来产出位置。
- 已存在的工作区文件不会跟随任务自动移动。
- 任务仍通过 `ThreadFileBinding` 找到历史输入和输出。
- 历史任务中尚未落入工作区的 legacy 文件，在第一次移动任务时自动导入目标文件夹。

### 删除和回收

- 删除文件或文件夹默认进入回收站。
- 删除文件夹时，其内容一起隐藏，但 Thread 消息不做硬删除。
- 恢复文件夹时恢复原有层级；父级不存在时恢复到工作区根目录。
- 任务默认动作是 `归档任务`，不是删除。
- 归档任务不删除任何文件。
- 永久删除需要独立确认，并受组织保留策略约束。

## 历史会话迁移后的体验

历史 Thread 不变成文件夹，也不重写聊天消息。

系统新增一个受保护的系统文件夹：

> 未整理的历史任务

迁移行为：

- 所有没有 `folderId` 的现有 Thread 绑定到该系统文件夹。
- `最近使用` 继续按 `updatedAt` 展示现有历史会话。
- 左栏展开“未整理的历史任务”时只展示最近 5 条，中心页可以搜索和分页。
- Thread ID、标题、状态、消息、createdAt、updatedAt、公开分享记录保持不变。
- 已归档 Thread 继续归档。
- 旧深链重定向到带 `folder` 和 `task` 的新 URL。

历史文件采用渐进迁移：

- 已登记附件和 Artifact 建立稳定 file/version 身份，继续显示在任务的“相关文件”。
- 不把所有文件平铺到工作区根目录。
- 用户继续任务或把任务移动到正式文件夹时，相关 legacy 文件自动导入目标文件夹。
- 无法归属到 Thread 的运行目录文件进入 `待整理文件`。
- 迁移只复制和校验，不移动或删除旧目录。
- 单个文件迁移失败时继续走 legacy 只读预览，并后台重试。

不允许未经确认使用 AI 自动分类历史任务。系统可以给出整理建议，但移动必须由用户确认。

## 搜索

首版使用一个搜索框搜索：

- 文件夹名称
- 文件名称
- 任务标题

结果按类型分组，最近使用优先。

首版不做全文内容搜索。后续启用全文搜索时必须明确索引范围、权限过滤和内容更新时间。

搜索、选中文件夹、任务、文件和版本写入 URL：

```text
/portal?view=workspace&folder={folderId}&task={threadId}&file={fileId}&version={versionId}
```

Back 必须恢复：

- 上一个文件夹
- 上一个搜索词
- 文件列表滚动位置
- 任务或文件选择

## 数据模型

现有 `Workspace` 是 Admin/Agent Mode 运行目录目录，不承担用户文件系统语义。新增模型使用 `UserWorkspace`，避免复用冲突。

### UserWorkspace

```text
id
organizationId
securityDomainId
ownerUserId
status
storageRootKey
quotaBytes
usedBytes
createdAt
updatedAt

unique(organizationId, securityDomainId, ownerUserId)
```

一个用户在每个组织和安全域内拥有一个默认工作区。匿名公开分享访问者没有工作区。

### WorkspaceNode

```text
id
workspaceId
parentId
kind                    folder | file
name
normalizedName
storageKey
mimeType
sizeBytes
checksum
state                   active | trashed
trashedAt
originalParentId
createdByType           user | agent | migration
createdByUserId
sourceThreadId
createdAt
updatedAt

unique(workspaceId, parentId, normalizedName, state=active)
```

`storageKey` 是存储适配器内部键，不是用户可见路径。

### WorkspaceFileVersion

```text
id
fileId
versionNo
storageKey
mimeType
sizeBytes
checksum
createdByType
createdByUserId
createdByThreadId
changeType
createdAt

unique(fileId, versionNo)
```

### Thread 变更

```text
workspaceId
folderId
```

迁移期均可为空；迁移完成后 Portal 新建 Thread 必须有值。

### ThreadFileBinding

```text
id
threadId
fileId
versionId
role                    input | context | output
createdAt

unique(threadId, fileId, versionId, role)
```

### WorkspaceChangeSet

```text
id
workspaceId
threadId
runId
status                  pending | applied | partially_applied | reverted | failed
summary
createdAt
appliedAt
revertedAt
```

### WorkspaceChange

```text
id
changeSetId
fileId
kind                    create | update | move | trash
beforeVersionId
afterVersionId
beforeParentId
afterParentId
riskLevel               low | review_required
status
```

### ThreadArtifact 兼容

增加：

```text
workspaceFileId
workspaceFileVersionId
```

迁移期保留 `relativePath`。新代码优先按 file/version 读取，legacy 数据才回退 path。

## API

Workspace API 应从 `agent-api/src/index.ts` 拆到独立 Router、Service 和 Repository。

### 工作区和节点

```text
GET    /api/portal/workspace
GET    /api/portal/workspace/nodes?parent_id=
POST   /api/portal/workspace/folders
POST   /api/portal/workspace/files
PATCH  /api/portal/workspace/nodes/:nodeId
DELETE /api/portal/workspace/nodes/:nodeId
POST   /api/portal/workspace/nodes/:nodeId/restore
GET    /api/portal/workspace/recent
GET    /api/portal/workspace/search?q=
```

### 文件内容和版本

```text
GET  /api/portal/workspace/files/:fileId/content?version_id=
GET  /api/portal/workspace/files/:fileId/versions
POST /api/portal/workspace/files/:fileId/versions/:versionId/restore
```

内容接口只接受稳定 ID，不接受绝对路径。

### 文件夹任务

```text
GET  /api/portal/workspace/folders/:folderId/tasks
POST /api/portal/workspace/folders/:folderId/tasks
```

现有接口调整：

```text
GET  /api/threads?folder_id=
POST /api/threads
{
  "folder_id": "...",
  "external_id": "...",
  "model": "...",
  "reasoning_effort": "..."
}
```

Thread API 对 Portal 返回：

```json
{
  "id": "thread-id",
  "title": "分析弱覆盖站点",
  "workspace_id": "workspace-id",
  "folder": {
    "id": "folder-id",
    "name": "印尼网络优化"
  }
}
```

不得返回服务器绝对 `workspace`。

### Agent 变化

```text
GET  /api/portal/workspace/changesets/:changeSetId
POST /api/portal/workspace/changesets/:changeSetId/apply
POST /api/portal/workspace/changesets/:changeSetId/revert
```

SSE 事件使用稳定身份：

```json
{
  "type": "workspace_change_set",
  "change_set_id": "...",
  "thread_id": "...",
  "summary": "新建 2 个文件",
  "changes": [
    {
      "file_id": "...",
      "after_version_id": "...",
      "kind": "create"
    }
  ]
}
```

## 存储与 Agent 运行时

当前用户运行目录随 Agent Mode 分裂。目标架构拆成：

```text
用户长期数据：
organization / security-domain / user / workspace

Agent 内部运行：
organization / security-domain / user / runtime / mode / run
```

### WorkspaceStorage

新增存储抽象：

```text
put
read
stat
copy
move
trash
restore
list
createVersion
```

首版使用 `LocalFsWorkspaceStorage`。数据库只保存 `storageKey`；后续可以增加 Azure Blob 或 S3 实现，不改变用户 API。

### 每次运行

1. 根据 Thread 的 `folderId` 解析允许范围。
2. 将当前文件夹和显式 file binding 物化到 run workspace。
3. 用户文件作为 base，Agent 写入 staging。
4. 运行结束后计算 diff。
5. 将 diff 转换成 `WorkspaceChangeSet`。
6. 低风险 create/update 原子应用。
7. delete、批量 move 和越界变化等待确认。
8. 成功应用后发送 SSE 并更新文件列表。

`.agent-studio`、上传缓存、`AGENTS.md`、Codex 状态、日志和临时文件不进入用户可见文件树。

Usage 仍通过现有 `UsageRecorder.recordCodexUsage()` 记录；工作区改造不能新增旁路计费入口。

## 权限和安全

- 所有 Workspace API 同时校验 organization、securityDomain、owner/member policy。
- 普通成员用户拥有自己的私人工作区。
- 外部组织成员可以拥有工作区，但受组织文件策略约束。
- 匿名公开分享访问者没有工作区浏览能力。
- 公共分享只包含明确批准的文件版本或 Thread Artifact，不分享整个文件夹。
- API 使用 file/node ID，不接受任意绝对路径。
- 文件访问使用 `realpath`、`lstat` 和 no-follow 策略，拒绝 symlink、hardlink、特殊设备文件和路径穿越。
- 写入采用临时文件、校验和、原子 rename。
- 上传支持 MIME/扩展名策略、恶意文件扫描、隔离和 zip bomb/超大预览限制。
- 配额按工作区和组织策略执行。
- 文件读取、下载、移动、删除、恢复、版本恢复写入审计日志。

## 前端实现结构

不要继续把所有状态加入大型 `PortalShell.tsx`。新增：

```text
agent-ui/src/features/portal/workspace/
  api.ts
  types.ts
  WorkspaceProvider.tsx
  WorkspaceRail.tsx
  WorkspaceSmartViews.tsx
  FolderTree.tsx
  FolderTaskList.tsx
  FolderHome.tsx
  WorkspaceBreadcrumb.tsx
  WorkspaceFileList.tsx
  WorkspaceFileMenu.tsx
  WorkspaceEmptyState.tsx
  WorkspaceChangeCard.tsx
  WorkspaceMobileNavigator.tsx
  workspace-route-state.ts
```

复用：

- assistant-ui Thread、Composer 和消息流。
- `PreviewWorkbenchPanel` 的文件格式转换和预览器。
- `RightWorkbenchDrawer` 的 Drawer 能力。
- `BrandingProvider`、Portal AntD theme 和现有 i18n。

替换：

- `SessionRail` → `WorkspaceRail`。
- 日期 Thread Group → 当前文件夹的任务列表。
- `threadId + path` 预览 → `fileId + versionId`。
- Thread attachment path hint → file/version binding。

`useRemoteThreadListRuntime` 继续负责任务切换。Workspace Rail 自己维护文件夹导航，不把整个文件树强塞进 assistant-ui ThreadList。

## 前端效果图复刻和视觉 QA 门槛

任何影响上述页面的前端实现必须执行以下流程：

1. 从本目录效果图选择对应页面作为 source of truth。
2. 多页面、多层级或响应式状态必须分别有 ImageGen 效果图；不得用一张桌面图推断所有状态。
3. 实现使用项目现有组件、runtime branding 和设计 token。
4. 在对应视口捕获浏览器实现：
   - 桌面 `1440 × 900`
   - 移动 `393 × 852`
   - 补充检查 `375`、`768`、`1024`、`1440` 宽度
5. 把 source 和 implementation 合成同一比较输入，不能仅凭记忆或分别查看。
6. 明确检查字体、间距、颜色、图标/图片质量和文案。
7. P0/P1/P2 差异必须修复并重新截图比较。
8. 项目根目录 `design-qa.md` 必须记录每轮差异、修复和证据。
9. 只有 `final result: passed` 才能交付。
10. P3 可以进入后续 polish，但必须列出。

视觉 QA 不是截图存在或构建通过。必须同时验证：

- 文件夹展开、选择和查看全部。
- 文件单击预览。
- 任务切换。
- 上传入口。
- Back/Forward 和深链恢复。
- 移动端逐层返回。
- keyboard focus。
- loading、empty、error 和长文件名。
- 浏览器 console 无新增错误。

## 历史迁移

迁移采用 additive schema 和 dual-read：

### 第 1 步：建模

- 新增 `UserWorkspace`、Workspace Node/Version/ChangeSet 表和 nullable Thread 外键。
- 新接口只读可用。
- 不改变现有 Thread 行为。

### 第 2 步：回填

- 为每个 organization/securityDomain/user 创建工作区。
- 创建 `未整理的历史任务` 系统文件夹。
- 为没有 folderId 的 Thread 回填归属。
- 建立附件和 Artifact 的 file/version 索引。
- 生成 checksum 和冲突报告。

### 第 3 步：双写

- 新上传同时写 WorkspaceFile 和 legacy attachment 元数据。
- 新 Artifact 同时写 file/version 绑定。
- 新 Thread 必须传 folderId。

### 第 4 步：UI 灰度

- 内部用户先启用 Workspace Rail。
- 提供 feature flag 只控制入口，不维护两套长期产品逻辑。
- 对比任务打开率、历史会话查找成功率和上传失败率。

### 第 5 步：切换

- Workspace API 成为主读。
- legacy 路径仅为未迁移内容提供只读 fallback。
- 回填稳定后删除前端日期分组主导航。

### 回滚

- UI 可暂时退回现有 SessionRail。
- 不回滚或删除新表数据。
- Thread ID 和消息未变化，因此回滚不会损坏会话。
- 新文件继续保留；旧 UI 通过 Thread Artifact 兼容入口访问。

## 实施拆分

### PR 1：领域和存储基础

- Prisma 模型和 migration。
- WorkspaceStorage。
- Repository/Service。
- 权限和路径安全测试。
- 不改 Portal 主界面。

### PR 2：历史回填和 Workspace Read API

- 用户工作区自动创建。
- `未整理的历史任务` 回填。
- folder/node/file/version 查询。
- dry-run、checksum 和冲突报告。

### PR 3：Workspace Rail 与文件夹主页

- 严格复刻图 1 和图 4。
- 文件夹、任务、最近使用和搜索。
- 文件夹主页文件列表。
- URL 状态和移动端逐层导航。

### PR 4：任务和预览融合

- 严格复刻图 2 和图 3。
- Thread 创建/移动到文件夹。
- 上传转为 Workspace File。
- 预览按 file/version。
- 保留 legacy fallback。

### PR 5：Agent staging、版本和变化集

- folder scope。
- diff/change set。
- 版本、恢复和撤销。
- 删除/移动 review。
- SSE 更新。

### PR 6：灰度、视觉 QA 和生产迁移

- 浏览器交互验证。
- `design-qa.md` 通过。
- 数据迁移 dry-run。
- 灰度指标和回滚演练。
- 正式切换。

## 验收标准

### 产品

- 老用户可以在 `最近使用` 找到原历史会话。
- 历史会话消息、标题、状态和链接不变。
- 新任务自动归属于当前文件夹。
- 切换 Agent Mode 不会切换用户文件。
- 上传文件会立即出现在当前文件夹。
- 任务归档不会删除文件。
- Agent 修改文件产生版本并可撤销。
- 用户不需要看到或输入服务器路径。

### 权限

- 用户不能读取其他用户或安全域的工作区。
- public-share 不能浏览工作区。
- file ID 不能跨 workspace 使用。
- traversal、symlink、hardlink、特殊文件和 TOCTOU 场景有测试。
- Agent 默认不能访问兄弟文件夹。

### 数据

- 迁移可以重复执行。
- 文件 checksum 一致。
- 重名冲突不覆盖。
- 单文件失败不阻断其他 Thread。
- legacy fallback 有访问和告警记录。

### 前端

- 图 1–4 均有同视口实现截图和视觉对比。
- `design-qa.md` 的 `final result` 为 `passed`。
- `375px`、`768px`、`1024px`、`1440px` 可用。
- 键盘可达、focus 可见。
- 时间跟随用户本地时区。
- empty、loading、error、long content 状态完成。
- runtime branding 未被硬编码颜色替代。

### 监控指标

- 历史任务打开成功率。
- 从进入 Portal 到打开目标任务的时间。
- 文件上传成功率和失败原因。
- 新建任务后首条消息发送率。
- Agent 文件变化的查看、应用和撤销率。
- 文件预览成功率。
- legacy fallback 命中率。
- migration checksum/冲突/失败数量。

## 非目标

首版不实现：

- 云电脑桌面、壁纸、Dock 和窗口系统。
- Terminal 或 IDE。
- 任意服务器目录浏览。
- 桌面同步客户端。
- 实时多人协作编辑。
- 团队共享盘和复杂 ACL。
- 全文内容搜索。
- 自动 AI 分类和移动历史任务。
- 以每个 Thread 一个物理文件夹作为长期架构。

这些能力只有在工作区、版本、权限和迁移稳定后，且有明确用户目标时再单独设计。

## 与当前实现的主要冲突

| 当前实现 | 目标处理 |
|---|---|
| `SessionRail` 展示按日期分组 Thread | 替换为 Workspace Rail，最近使用保留时间线心智 |
| Thread 直接保存绝对 `workspace` | Portal 使用 `workspaceId/folderId`，不返回绝对路径 |
| workspace 按 Agent Mode 分裂 | 用户文件 mode-neutral，运行目录 mode-specific |
| 上传进入 `.agent-studio/uploads/{threadId}` | 上传创建 Workspace File 和 Version |
| Attachment 提示词携带绝对路径 | 改为稳定 file/version binding |
| Artifact 唯一键是 `threadId + relativePath` | 增加 workspace file/version 身份 |
| Preview 依赖 `threadId + path` | 优先 `fileId + versionId`，迁移期 fallback |
| Thread hard delete可能处理运行目录 | 任务归档/删除永不隐式删除工作区文件 |
| path.resolve 前缀判断承担目录安全 | 增加真实路径、no-follow 和存储适配器边界 |

实现时如与本方案冲突，优先保证用户心智、历史数据安全和可撤销性；不要为了复用当前路径模型把内部目录暴露成用户文件系统。
