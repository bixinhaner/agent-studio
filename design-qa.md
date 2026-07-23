# 智能体工作室 Design QA

- 参考图目录：`/Users/like/.codex/generated_images/019f6189-8c98-7f71-9c6b-d54c00590617`
- 实现截图：`temp/agent-config-audit/density-pass-3/01-list.png` 至 `07-create.png`
- 逐页对照：`temp/agent-config-audit/density-pass-3/comparison-density-pass-3.png`
- 访问权限专项截图：`temp/agent-config-audit/access-rework/access-final.png`、`access-add-exception.png`
- 访问权限专项对照：`temp/agent-config-audit/access-rework/access-comparison.png`
- 技能包与技能最终截图：`temp/agent-config-audit/skills-simple-2026-07-15/01-packages.png` 至 `04-add-package.png`
- 技能页视觉收口截图：`temp/agent-config-audit/skills-polish-2026-07-15/01-list.png` 至 `06-content-source.png`
- 技能页同视口对照：`temp/agent-config-audit/skills-polish-2026-07-15/07-reference-comparison.png`
- 新建智能体最终截图：`temp/agent-config-audit/create-flow-polish-2026-07-15/01-start.png` 至 `05-review.png`
- 新建智能体同视口对照：`temp/agent-config-audit/create-flow-polish-2026-07-15/06-comparison.png`
- 验收视口：1672 × 941
- 验收浏览器：用户指定的 Chrome

## 结论

- 已按参考图重新组织信息架构，不再沿用旧前端的单列表单逻辑。
- 详情页统一为“智能体身份头部 + 横向配置层级 + 高密度工作区 + 底部保存反馈”。
- 按用户要求，智能体总览不包含指标卡、待处理侧栏和最近发布；产品中也不再出现版本记录、版本控制、发布版本和回滚入口。
- 没有伪造后端能力：测试页只验证真实可读取的配置完整性，不生成虚假的模型回答；权限、技能、指令和运行策略继续使用既有 API 保存。

## 逐页对照

1. 角色与指令：改为结构化规则块编辑，右侧持续显示生效范围、运行配置与能力摘要，层级与参考图一致。
2. 知识与技能：只保留“技能包 → 技能”两级；技能包列表直接显示实际会进入运行链路的 Codex Skills。
3. 运行与安全：增加运行预设、模型推理、执行边界、平台硬限制和配置预览，关键运行风险在同一屏完成判断。
4. 访问权限：按“默认访问范围 → 允许规则/拒绝例外 → 渠道绑定 → 身份模拟”重构；模拟区只解释当前状态、可见性和规则优先级，不冒充服务端最终鉴权结果。
5. 测试验证：采用三栏验证工作区，左侧选择检查项，中间呈现配置验证，右侧显示检查清单与运行摘要；移除参考图中的发布/版本流程。
6. 新建智能体：重构为“选择起点 → 定义用途 → 配置能力 → 验证并创建”四步大抽屉，复杂参数渐进展示。

## 第二轮逐图修正

- P1 开关宽度：定位为 `Switch` 作为 Grid 子项被默认拉伸。普通开关固定为 36 × 20px，小开关固定为 28 × 16px；概览、指令、运行、权限和新建抽屉均已重新截图确认。
- P2 首屏密度：收紧实体头部、Tab、卡片 padding、预设卡和配置行，使运行配置预览重新进入 1672 × 941 首屏。
- P2 实体头部：状态标签移到智能体名称旁，恢复参考图“身份信息集中在左、动作集中在右”的结构。
- P2 角色与指令：补充规则合并提示条，统一规则组、规则行和小开关尺寸。
- P2 访问权限：补充默认发现、精细授权和冲突顺序三个真实决策层级；新增访问规则不再直接插入空白表单行。
- P2 新建智能体：第二步补充模板起点、角色目标与回答原则、结果摘要，使信息量和参考图一致，并保持运行策略与技能在下一步渐进展示。

## 第三轮字体与密度修正

- P1 字体比例：详情正文、按钮、标签和表单值统一收敛到 11–12px；卡片标题约 13px，智能体身份标题 20px，避免所有内容处于同一强调层级。
- P1 字重：正文与按钮恢复 400，标签和辅助状态为 500，标题与关键数据统一为 600；移除大面积 650/700 带来的视觉压迫。
- P2 控件高度：按钮与单行输入统一约 28px，表格行由 62px 收紧为 52px，规则行收紧为 33px。
- P2 列表密度：总览筛选区、表头、数据行和分页同步收紧；单行智能体数据不再占用 78px 高度。
- P2 运行首屏：预设、模型推理、执行边界、平台硬限制和配置预览均进入 1672 × 941 首屏。
- P2 权限与测试：权限策略表单、决策卡、测试用例和检查项的标题与正文重新分级，消除局部大字号和重字重残留。
- P2 新建抽屉：步骤标题、字段标签、说明文字和右侧预览统一压缩，保持参考图的高密度向导节奏。

## 访问权限专项复刻

- P1 旧版结构：移除摘要卡片、通用三字段策略表单和重复入口说明，改为参考图一致的任务顺序。
- P1 规则可读性：策略直接分成“允许使用”和“拒绝例外”，主体名称、来源和优先级在同一行读完；删除 `legacy role`、资源类型等实现术语。
- P1 添加例外：改为居中弹窗，先选允许/拒绝，再选角色、部门或用户；视觉和操作顺序与参考图一致。
- P2 权限模拟：增加典型身份与渠道选择，并展示组织策略、角色例外、智能体状态三段判定链。
- P2 渠道绑定：采用紧凑表格呈现状态、身份映射和检查结果，外部渠道仍引导至真实系统集成配置。
- P2 开关尺寸：访问范围开关在 Chrome 实测为 36 × 20px，没有 Grid 拉伸。
- 验证：1672 × 941 同视口对照通过；添加例外弹窗可打开，浏览器 Console 无 error/warn。

## 有意差异

- 参考图包含全局管理侧栏；本轮截图聚焦能力中心组件，实际生产环境仍由现有 Admin Shell 提供全局导航。
- 参考图的发布检查、版本号和回滚属于已明确删除的产品心智，因此没有复刻。
- 参考图中的渠道调用数据、风险扫描和真实会话结果缺少当前后端接口，因此界面只展示真实可保存、可验证的数据。
- 总览指标区和右侧待办/发布区域按用户标注删除，不视为视觉偏差。

## 技能包与技能专项落地

- P1 概念收敛：删除前端推断的“知识型能力”、能力分类、依赖健康和影响预览，页面只保留技能包与技能。
- P1 运行一致性：界面中的“技能”只统计真实 `codex_skill` 绑定；`config_fragment`、`prompt_hint` 当前未进入技能包运行解析，不再显示为已生效技能。
- P1 内容查看：技能包详情列出每个真实 Skill，并通过后端受控接口读取系统、本地或组织发布 Skill 的 `SKILL.md`，支持完整查看与复制。
- P1 添加逻辑：技能包在抽屉内多选暂存，只有点击“添加到草稿”才更新智能体配置，避免浏览候选项时误改数据。
- P2 信息密度：默认页在一张表内完成“技能包—包含技能—可见范围—状态—操作”的判断，不增加辅助分类层级。
- P2 列表可扫读性：汇总区突出技能包与真实可运行 Skill 数量；表格行增大到适合连续扫描的高度，并直接展示 Skill 标签，解决此前字号过小、内容过轻的问题。
- P2 添加抽屉：候选卡同时显示包说明、技能数量和具体 Skill，选中态使用左侧强调线与浅蓝底；用户无需打开详情即可判断是否需要添加。
- P2 详情层级：每个 Skill 收敛为“名称—说明—来源—查看内容”一条主线，触发说明仅在存在时渐进展示，不再堆叠辅助状态。
- P2 内容阅读：`SKILL.md` 默认渲染为 Markdown 预览，支持标题、列表、引用、代码和表格；保留源码切换与复制内容，兼顾普通用户阅读和管理员排障。
- 交互验证：Chrome 1672 × 941 下已覆盖技能包列表、添加抽屉、候选选中态、技能包详情、`SKILL.md` 预览与源码；页面不再出现“知识型能力”或“已启用能力”，Console 无错误。

## 新建智能体专项复刻

- P1 任务流程：保留参考图四步结构，但把旧版数据库字段表单重组为“选择起点 → 定义用途 → 配置能力 → 检查并创建”；每一步的主按钮直接说明下一步结果。
- P1 用途定义：名称、ID 和主要任务集中在首屏；角色规则改为按需展开，模板内容继续真实预填，不再与能力步骤重复编辑。
- P1 真实资源：运行策略和技能包改为可比较的选择卡，直接展示模型、推理强度、安全边界和真实 `codex_skill` 数量，不增加后端不存在的受众、渠道或版本字段。
- P1 创建确认：最后一步逐项展示将写入的智能体身份、运行策略、技能包绑定和角色规则；创建失败时明确内容仍保留，可直接重试。
- P2 结果预览：右侧持续展示将创建的智能体、配置起点、可见范围和装配结果，替代旧版通用摘要卡；创建流程不声称自动保存。
- P2 页面节奏：步骤切换自动回到抽屉顶部；1672 × 941 下用途页核心字段、系统准备项和主操作同屏可见，移动端降为单列。
- 交互验证：Chrome 已覆盖四个步骤、模板选择、字段填写、运行策略选择、技能包多选和最终检查；无水平溢出、无版本文案、无“初始角色指令”旧入口，Console 无错误。

## 检查项

- 字体与排版：使用项目中文系统字体栈，标题、表格、辅助说明保持管理台高密度层级。
- 间距与布局：桌面关键页面采用双栏或三栏工作区；编辑行为与结果反馈保持邻近。
- 色彩：中性工作面、蓝色主操作、语义状态色；没有照搬参考品牌。
- 图标：使用项目现有 Lucide/Ant Design 图标，没有 Emoji 或临时占位图。
- 时间：继续通过浏览器本地时区格式化。
- 可访问性：关键输入、按钮、步骤和抽屉具有可识别标签；禁用态说明来自当前步骤校验。

## 遗留建议

- P3：后端提供真实试运行接口后，可把测试验证升级为真实模型会话，并保留当前配置检查作为前置门槛。
- P3：后端提供渠道绑定与权限决策日志后，再补充渠道级可见范围和可解释的命中链路。

final result: passed

## 系统插件自动能力目录（2026-07-23）

- ImageGen 目标图：`docs/assets/skill-management-design/plugin-automatic/01-portal-automatic-plugin-skill.png`、`02-admin-plugin-catalog.png`、`03-admin-plugin-content-editor.png`
- Portal 实现截图：`temp/plugin-catalog-qa/portal-automatic-en-final.png`、`portal-automatic-zh-final.png`、`portal-automatic-mobile-detail-final-v2.png`
- Admin 实现截图：`temp/plugin-catalog-qa/admin-plugin-list-final.png`、`admin-plugin-editor-final.png`、`admin-plugin-runtime-final-v2.png`
- 验收浏览器：Codex 内置浏览器；桌面 1440 × 900、移动端 390 × 844

### 验收结论

- Portal 将插件放入独立“自动能力”范围，以紧凑双列卡片展示六个条目；详情保留用途、适用场景、使用方法和示例，不提供启用/停用操作，也不会写入输入框的已选 Skill。
- Admin 将插件原名、插件标识、版本、安装状态和包含能力作为只读运行信息；中英文用途名、释义、适用场景、使用方法、示例问题和数据范围继续由目录数据配置。
- 桌面端一次可浏览更多条目；移动端采用列表到详情的两层动线，并修复了切换筛选后的旧详情、滚动位置继承和长插件名按钮裁切。
- 页面不显示 Codex 品牌字样，保留 Bailey 运行时品牌；自动能力以绿色状态语义与可手动选择的 Skill 区分。
- Admin 基础信息页的 Portal 可用开关恢复为标准紧凑尺寸；自动能力预览的复制操作使用中性按钮，避免被误解为启用动作。
- Console 未发现本次插件目录新增错误；既有 `ThreadFollowupSuggestions` render-time state update 和 Ant Design deprecated API 警告不属于本次范围。

### 验证

- API：4 个测试文件、12 项通过，覆盖安装插件解析、白名单、目录同步、Portal 自动能力下发和路径脱敏。
- UI：Skill Picker 4 项测试通过，覆盖自动能力无启用动作、示例回填和不修改已选 Skill。
- API/UI 生产构建通过，`git diff --check` 通过。
- P0：0；P1：0；P2：0。

final result: passed

## Skill 目录、多语言管理与无快照发布（2026-07-22）

- Portal 参考图：`docs/assets/skill-management-design/portal/01-zh-catalog-create-shortcut.png` 至 `06-mobile-zh-shortcut-detail.png`
- Admin 参考图：`docs/assets/skill-management-design/admin/01-skill-catalog.png` 至 `05-publish-review.png`
- Portal 真实截图：`temp/skill-catalog-qa/portal-create-actual.png`
- Admin 真实截图：`temp/skill-catalog-qa/admin-list-actual.png`、`temp/skill-catalog-qa/admin-editor-actual.png`
- 同屏对照：`temp/skill-catalog-qa/portal-comparison.png`、`temp/skill-catalog-qa/admin-comparison.png`
- 验收浏览器：Codex 内置浏览器；桌面视口 1776 × 918

### 对照结论

- Portal：实现与效果图保持同一条主任务动线——搜索、范围筛选、紧凑卡片、详情、示例与启用操作同屏；创建入口会自动定位普通 `skill-creator`，没有额外创建流程。
- 输入框：只展示 Skill 原名；用途名、释义和范围通过悬浮/聚焦说明渐进展示，避免 Composer 膨胀。
- Admin：目录、范围/语言/状态筛选、详情预览、多语言编辑、实时预览和发布检查均已落地；列表密度高于效果图以承载更多真实 Skill。
- 国际化：Portal 按请求语言读取本地化内容；缺失语言按默认语言回退。Admin 同时展示翻译完整度和缺失语言，并允许逐语言维护。
- 发布：草稿覆盖当前生效配置，不创建或保留版本快照；发布检查明确告知影响范围和覆盖行为。
- 数据真实性：用途名、释义、适用场景、使用步骤、示例和数据范围均来自数据库目录与翻译记录，前端只保留通用界面文案和无数据兜底。

### 迭代记录

1. P1：首轮 Portal 详情底部操作被视口裁切；扩大浮层并调整双栏比例后，`Use example` 与 `Enable Skill` 在 1776 × 918 首屏完整可见。
2. P1：跨页面“新建托管 Skill”最初只返回 Portal；增加 `openSkill=create_skill` 定位协议后，可直接打开目录并聚焦 `skill-creator`。
3. P2：可编辑列表项的 React key 曾包含文本值，输入时会导致节点重建；改为稳定索引 key 后，连续输入不再丢失焦点。
4. 视觉对照：Portal 的内容数量取决于本地真实绑定，因此没有伪造效果图中的 Mine/Team/Recent 数据；Admin 实现保留更高列表密度，这是为了让管理员同屏扫描更多 Skill。

### 验证结果

- API build：通过。
- UI build：通过。
- API 定向测试：`skill-catalog/service.test.ts`、`portal/runtime-option-service.test.ts`，7 项通过。
- UI 定向测试：`SkillPicker.test.tsx`，3 项通过（目录启用、停用、Composer 悬浮说明）。
- Prisma：本地 PostgreSQL 52 个迁移全部已应用，schema up to date。
- 真实浏览器：已覆盖 Portal 目录、创建入口、启用态、Admin 目录、中文/英文切换、实时预览与“无版本快照”发布确认。

final result: passed

## Portal Skill 选择器结构化展示收口（2026-07-16）

- ImageGen 目标图：`temp/skill-picker-design/skill-picker-target.png`
- Chrome 组件实测：`temp/skill-picker-design/skill-picker-browser-desktop-full.png`
- 同视口并排对照：`temp/skill-picker-design/skill-picker-final-comparison.png`
- 移动端详情：`temp/skill-picker-design/skill-picker-browser-mobile-final.png`
- 验证浏览器：用户指定的 Chrome；桌面 1536 × 1024，移动端 390 × 844

### 本轮结论

- 桌面浮层按目标图收敛为 880 × 456px，左侧任务栏 304px，浮层与输入框保持约 8.5px 间距；双栏、推荐卡、示例问题、主操作和备选 Skill 的层级一致。
- Portal 不再依赖前端固定任务与分类表；展示名称、摘要、任务、分类、排序、来源、数据范围、示例提示词和预计耗时由后端 `presentation` 返回。
- 管理端新增结构化“Portal 展示”编辑器，管理员可修改上述元数据并保存到 Skill binding 的 `presentation` 覆盖层，不需要改前端代码。
- 移动端由长页面堆叠改为“任务列表 → Skill 详情”两步抽屉；点击任务会立即进入详情，并提供明确返回入口。
- Chrome 已实测任务切换、关键词搜索、示例提示词回填、启用 Skill、已选状态栏、移动端返回动线；桌面与移动端均无水平溢出，Console error 为 0。

### 视觉差异判断

- P0：0。
- P1：0。
- P2：0。实现沿用真实 Bailey Portal 壳层与现有 Composer 宽度，目标图中的会话内容仅作为背景语境，不要求复刻为业务数据。
- P3：ImageGen 图使用完整 Chrome 浏览器框，组件验收页只渲染产品内容区；不影响 Skill 选择器本身的尺寸、层级和交互判断。

final result: passed

# Portal Skill Picker Design QA

- 参考图：`/Users/like/.codex/generated_images/019f6608-562c-7e53-9400-e206b6e80be0/exec-bb0471f3-1b2f-4b54-9ada-35466766c8bb.png`、`exec-e54745b9-fed5-402b-911b-ebdecaa18391.png`、`exec-b2100f0c-b184-4362-8d77-d85a279b68be.png`、`exec-f2e1af1c-eed2-41f8-b5e4-9effdf8860bd.png`
- Chrome 实现截图：`temp/skill-picker-qa/01-task-picker.png`、`02-recommendation-v2.png`、`03-catalog-v2.png`、`04-selected.png`
- 同屏对照：`temp/skill-picker-qa/compare-recommendation.png`、`compare-catalog.png`、`compare-selected.png`
- 验证浏览器：用户指定的 Chrome，实际可用内容视口 1440 × 719

## 对照结论

- 字体与排版：沿用 Portal 系统字体和现有 Bailey 品牌；标题、辅助文案、列表项与按钮的层级接近参考图。运行时 Skill 的英文名称和说明来自本地验证数据，不属于视觉偏差。
- 间距与布局：桌面端保持“按任务选择 → 推荐详情 → 完整目录 → 已选上下文”四态；双栏宽度、分隔线、卡片密度、底部操作与参考图一致。
- 色彩与令牌：主操作和选择态使用 Portal 橙色，详情面保持中性白/灰；没有照搬外部品牌色。
- 图标与资产：使用项目既有 Lucide 图标；没有手工 SVG、Emoji 或占位图。页面背景资产继续使用 Bailey 现有实现。
- 文案与内容：任务文案、数据范围、适用场景、示例问题和来源均由后端 presentation DTO 提供；前端不展示内部路径和激活提示。
- 可访问性：入口、任务、分类、启停、返回和移除操作均有可识别名称；选择状态使用 `aria-pressed`，保存错误在原位置反馈。

## 迭代记录

1. 首轮发现 P1：推荐层的主操作被 `max-height` 裁切。修正为受视口约束的确定高度，并让左右栏独立滚动；复查确认“填入输入框”和“使用 Skill”可见可点。
2. 第二轮发现 P2：从底部“浏览全部”切换目录时继承了旧栏滚动位置，导致返回入口离开首屏。为任务态和目录态增加稳定 key 触发独立挂载；复查确认返回入口可见。
3. 线程级实测：启用 Skill 后写入 `codex_run_config.enabledSkills`，刷新仍保留；停用后 UI 和数据库同步恢复。验证产生的临时 Skill、权限数据和线程配置已清理。
4. Console：没有 SkillPicker 新增异常。现存 `ThreadFollowupSuggestions` render-time state update 警告在打开 SkillPicker 前已出现，属于既有问题，不纳入本次范围。

## 最终判断

- P0：0
- P1：0
- P2：0
- P3：目录聚焦态使用浅橙背景而非参考图的橙色勾选，以避免把“查看详情”误解为“已启用”；这是有意的语义修正。

final result: passed

## Portal Generated File Card（2026-07-23）

- 参考图：`/Users/like/.codex/generated_images/019f8ab4-32d6-71c1-9060-2a2cfb915fa6/exec-ac8258bb-c541-48c2-83a9-0bcbf5c0e9d3.png`
- 实现截图：`agent-ui/temp/design-qa-implementation-full.png`、`agent-ui/temp/design-qa-implementation-focused.png`
- 同屏对照：`agent-ui/temp/design-qa-comparison.png`
- 验收浏览器：Codex 内置浏览器；桌面视口 1440 × 1024，响应式检查覆盖 375、768、1024 和 1440 CSS px。

### 验收结论

- 同一路径的 runtime file-change 与最终 artifact 事件会合并为一个文件卡片，ready 状态优先，文件区稳定放在回答末尾；历史会话加载时执行同一归并逻辑。
- Portal 系统文案保持英文：`Generated files`、`Ready`、`Preview`、`Download`；移除含义不清的 `Download latest`。
- Preview 与 Download 在桌面端同高 38px、顶部位置一致；375px 移动端同高 44px且无水平溢出。
- Markdown 文件链接保持语义化 anchor，并使用蓝色、下划线和链接图标提高可识别性。
- 本地 artifact policy 未产生真实可下载制品，因此 ready/download 终态使用生产样式夹具验证；状态合并与下载能力由单元测试独立覆盖。
- 浏览器干净加载仅出现既有 `ThreadFollowupSuggestions` React 开发警告，本次文件卡片改动没有新增错误。

### 验证

- UI 测试：13 个文件、47 项全部通过。
- UI 生产构建：通过。
- 文件状态测试覆盖重复事件、多文件、晚到进度事件和最终位置。

final result: passed
