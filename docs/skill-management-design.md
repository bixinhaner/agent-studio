# Skill 选择器与管理后台设计基线

状态：最终设计基线
更新时间：2026-07-22

本文档和 `docs/assets/skill-management-design/` 中的效果图共同构成 Skill 展示、选择和管理体验的唯一实现基线。`temp/skill-picker-scope-redesign*` 中的早期方案仅是探索过程，不得作为实现兼容层或产品降级方案。

## 用户目标

- Portal 用户能快速找到 Skill，并理解其用途、可见范围和使用方式。
- 管理员能配置 Skill 的稳定原名、可本地化展示内容、Portal 快捷入口和发布状态。
- 系统承担来源合并、语言选择和字段回退，用户不需要理解 Skill 包或运行时绑定结构。

## Portal 最终动线

1. 打开 Skill 选择器后直接进入目录，不经过任务类型或推荐任务层。
2. 顶部以小面积展示最近使用的 Skill。
3. 通过“全部 / 我的 / 团队 / 平台”切换可见范围。
4. 卡片以本地化用途名为主标题，以 Skill 原名为等宽字体副标题，并展示本地化释义。
5. 选择 Skill 后在详情区渐进展示适用情况、使用方法、示例问题和数据范围。
6. “创建 Skill”是目录页快捷按钮；点击后定位并展开配置了 `create_skill` 快捷标识的普通 Skill，不启动独立创建流程。
7. 输入框只显示 Skill 原名；鼠标悬停或键盘聚焦时展示本地化用途名、释义和范围。
8. 移动端使用列表到详情的两层抽屉动线，保持同一信息架构。

### Portal 效果图

- [中文目录与创建入口](assets/skill-management-design/portal/01-zh-catalog-create-shortcut.png)
- [创建入口定位 Skill](assets/skill-management-design/portal/02-zh-create-shortcut-selected.png)
- [输入框 Skill 悬浮说明](assets/skill-management-design/portal/03-zh-composer-tooltip.png)
- [英文目录与详情](assets/skill-management-design/portal/04-en-catalog-selected.png)
- [移动端目录](assets/skill-management-design/portal/05-mobile-zh-catalog-shortcut.png)
- [移动端 Skill 详情](assets/skill-management-design/portal/06-mobile-zh-shortcut-detail.png)

## Admin 最终动线

1. Skill 管理列表直接展示原名、用途名、范围、来源、语言完整度和发布状态。
2. 基础信息页锁定 Skill 原名，配置默认语言、图标、排序和快捷入口。
3. 多语言页按 locale 配置用途名、释义、适用情况、使用方法、示例问题和数据范围，并实时预览 Portal。
4. 未配置的翻译逐字段标明回退来源；管理员预览可显示回退标记，Portal 正式界面不显示管理标记。
5. 发布前展示字段差异、影响范围、语言完整度和回退风险。缺失非默认语言允许发布，但必须明确提示实际用户体验。

### Admin 效果图

- [Skill 管理列表](assets/skill-management-design/admin/01-skill-catalog.png)
- [基础信息](assets/skill-management-design/admin/02-base-settings.png)
- [简体中文内容编辑](assets/skill-management-design/admin/03-zh-cn-content-editor.png)
- [英文缺失与语言回退](assets/skill-management-design/admin/04-en-us-fallback-state.png)
- [发布检查](assets/skill-management-design/admin/05-publish-review.png)

## 字段职责

| 字段 | 规则 |
|---|---|
| Skill 原名 | 来自 `SKILL.md` frontmatter `name` 或托管 Skill 的 `skillName`；不可翻译，Portal 输入框也只显示此值 |
| 用途名 | 可本地化；作为目录卡片和详情主标题 |
| 一句话释义 | 可本地化；说明 Skill 帮用户完成什么 |
| 适用情况 | 可本地化列表 |
| 使用方法 | 可本地化有序列表 |
| 示例问题 | 可本地化列表；点击后填入输入框 |
| 数据范围 | 可本地化；说明会使用哪些用户数据或上下文 |
| 图标、排序、快捷标识 | 非本地化展示配置 |
| 可见范围 | 由 Skill 的 owner、organization、scope 和 system 来源计算，不由展示文案配置 |

必要的语言回退顺序是最终方案的一部分，不属于旧方案保底：上下文覆盖 → 组织语言 → 平台语言 → 默认语言 → Skill 自带 description → Skill 原名。

## 与当前迭代的冲突结论

以下旧实现与最终方案冲突，正式落地时直接删除，不保留双轨逻辑、隐藏开关或前端 fallback：

| 冲突 | 当前位置 | 最终处理 |
|---|---|---|
| 任务入口、任务推荐、任务详情两层选择 | `agent-ui/src/features/portal/workbench/SkillPicker.tsx` | 删除 `tasks` 视图、任务聚合与推荐排序，目录成为唯一入口 |
| 分类筛选“推荐 / 数据 / 报表 / 创作” | `SkillPicker.tsx`、`skill-presentation.ts` | 删除分类模型，改为“全部 / 我的 / 团队 / 平台”范围筛选 |
| `taskId`、`taskLabel`、`taskDescription`、`taskOrder`、`taskIconKey` | 前后端 presentation 类型与编辑器 | 从 API、类型、编辑器、测试中删除 |
| `category`、`categoryLabel`、`categoryOrder`、`recommendationRank` | 前后端 presentation 类型与编辑器 | 从 API、类型、编辑器、测试中删除 |
| `PRESENTATION_BY_SKILL` 中硬编码中文展示文案 | `agent-api/src/portal/skill-presentation.ts` | 迁移为持久化的可本地化数据后删除，不作为运行时兜底 |
| 单语言 `bindingPayload.presentation` 编辑器 | `PortalSkillPresentationEditor.tsx` | 替换为基础信息与 locale 内容分离的管理体验 |
| 输入框已选 Skill 显示用途名和图标 | `PortalSelectedSkillBar` | 改为只显示 Skill 原名；用途名、释义和范围通过 hover/focus 浮层展示 |
| 最近使用最多只显示两项并依赖任务字段 | `SkillPicker.tsx` | 改为独立最近使用数据，小面积横向展示，不依赖任务模型 |
| `skill-creator` 名称判断或专用流程 | 未来实现需避免 | 使用非本地化快捷标识 `create_skill` 定位普通 Skill |

## 实现边界

- 不读取旧任务字段来决定新目录行为。
- 不在前端写死任何 Skill 的用途名、释义、示例或语言文案。
- 不同时维护旧选择器和新目录选择器；迁移完成后删除旧组件分支和样式。
- 可以保留数据库迁移期的只读数据迁移脚本，但迁移脚本不能进入运行时回退链。
- 通用界面文案进入应用级 i18n；每个 Skill 的展示内容进入 Skill 多语言数据。
- Portal 使用 runtime branding；Admin 使用 `--admin-*` token，两侧不共享主色硬编码。
