CREATE TABLE "skill_catalog_entries" (
  "id" TEXT NOT NULL,
  "catalog_key" TEXT NOT NULL,
  "organization_id" TEXT,
  "source_type" TEXT NOT NULL,
  "source_ref" TEXT NOT NULL,
  "canonical_name" TEXT NOT NULL,
  "default_locale" TEXT NOT NULL DEFAULT 'zh-CN',
  "icon_key" TEXT NOT NULL DEFAULT 'sparkles',
  "sort_order" INTEGER NOT NULL DEFAULT 100,
  "shortcut_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_catalog_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_catalog_translations" (
  "id" TEXT NOT NULL,
  "catalog_entry_id" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "display_name" TEXT,
  "summary" TEXT,
  "use_cases" JSONB NOT NULL,
  "usage_steps" JSONB NOT NULL,
  "example_prompts" JSONB NOT NULL,
  "data_scope" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_catalog_translations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_catalog_drafts" (
  "id" TEXT NOT NULL,
  "catalog_entry_id" TEXT NOT NULL,
  "base_config" JSONB NOT NULL,
  "translations" JSONB NOT NULL,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_catalog_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_catalog_entries_catalog_key_key" ON "skill_catalog_entries"("catalog_key");
CREATE INDEX "skill_catalog_entries_organization_id_status_idx" ON "skill_catalog_entries"("organization_id", "status");
CREATE INDEX "skill_catalog_entries_source_type_source_ref_idx" ON "skill_catalog_entries"("source_type", "source_ref");
CREATE INDEX "skill_catalog_entries_shortcut_key_status_idx" ON "skill_catalog_entries"("shortcut_key", "status");
CREATE UNIQUE INDEX "skill_catalog_translations_catalog_entry_id_locale_key" ON "skill_catalog_translations"("catalog_entry_id", "locale");
CREATE INDEX "skill_catalog_translations_locale_idx" ON "skill_catalog_translations"("locale");
CREATE UNIQUE INDEX "skill_catalog_drafts_catalog_entry_id_key" ON "skill_catalog_drafts"("catalog_entry_id");

ALTER TABLE "skill_catalog_translations" ADD CONSTRAINT "skill_catalog_translations_catalog_entry_id_fkey"
  FOREIGN KEY ("catalog_entry_id") REFERENCES "skill_catalog_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_catalog_drafts" ADD CONSTRAINT "skill_catalog_drafts_catalog_entry_id_fkey"
  FOREIGN KEY ("catalog_entry_id") REFERENCES "skill_catalog_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "skill_catalog_entries"
  ("id", "catalog_key", "source_type", "source_ref", "canonical_name", "default_locale", "icon_key", "sort_order", "shortcut_key", "status", "published_at")
VALUES
  ('skillcat-native-imagegen', 'global:native:imagegen', 'native', 'imagegen', 'imagegen', 'zh-CN', 'image', 10, NULL, 'active', CURRENT_TIMESTAMP),
  ('skillcat-native-lab-device-access', 'global:native:lab-device-access', 'native', 'lab-device-access', 'lab-device-access', 'zh-CN', 'flask', 20, NULL, 'active', CURRENT_TIMESTAMP),
  ('skillcat-native-skill-creator', 'global:native:skill-creator', 'native', 'skill-creator', 'skill-creator', 'zh-CN', 'wand-sparkles', 30, 'create_skill', 'active', CURRENT_TIMESTAMP),
  ('skillcat-native-power-outage-report', 'global:native:power-outage-report', 'native', 'power-outage-report', 'power-outage-report', 'zh-CN', 'bolt', 40, NULL, 'active', CURRENT_TIMESTAMP),
  ('skillcat-native-bss-report', 'global:native:bss-report', 'native', 'bss-report', 'bss-report', 'zh-CN', 'chart', 50, NULL, 'active', CURRENT_TIMESTAMP),
  ('skillcat-native-core-network-report', 'global:native:1-core-network-month-alarm-report', 'native', '1-core-network-month-alarm-report', '1-core-network-month-alarm-report', 'zh-CN', 'radio', 60, NULL, 'active', CURRENT_TIMESTAMP),
  ('skillcat-native-zendesk-data', 'global:native:zendesk-data', 'native', 'zendesk-data', 'zendesk-data', 'zh-CN', 'headphones', 70, NULL, 'active', CURRENT_TIMESTAMP),
  ('skillcat-native-text-metrics', 'global:native:text-metrics', 'native', 'text-metrics', 'text-metrics', 'zh-CN', 'chart-line', 80, NULL, 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("catalog_key") DO NOTHING;

INSERT INTO "skill_catalog_translations"
  ("id", "catalog_entry_id", "locale", "display_name", "summary", "use_cases", "usage_steps", "example_prompts", "data_scope")
VALUES
  ('skilltr-imagegen-zh', 'skillcat-native-imagegen', 'zh-CN', '图像生成与编辑', '根据提示生成或编辑图像', '["生成产品效果图","编辑现有图片","探索视觉方案"]', '["描述需要生成或修改的图像","提供必要的参考图和限制","检查结果并继续调整"]', '["生成一张企业 AI 助手的产品效果图。","把我上传的图片改成简洁的科技风格。"]', '仅使用本次对话中提供的描述和图片'),
  ('skilltr-imagegen-en', 'skillcat-native-imagegen', 'en-US', 'Image Generation & Editing', 'Generate or edit images from prompts', '["Generate a product mockup","Edit an existing image","Explore a visual direction"]', '["Describe the image you need","Add references and constraints","Review and refine the result"]', '["Create a product mockup for an enterprise AI assistant.","Edit my uploaded image into a minimal technology style."]', 'Only uses prompts and images provided in this conversation'),
  ('skilltr-lab-zh', 'skillcat-native-lab-device-access', 'zh-CN', '实验室设备查询', '查询实验室设备信息和状态', '["查询实验室设备","确认设备状态","了解可用型号"]', '["描述需要查询的设备","补充型号或用途","查看设备信息和状态"]', '["查询实验室里可用的 CAT6 CPE 设备。","帮我确认这台设备当前是否可用。"]', '实验室设备清单、状态与当前账号权限'),
  ('skilltr-lab-en', 'skillcat-native-lab-device-access', 'en-US', 'Lab Device Access', 'Check lab device information and status', '["Find lab devices","Check device status","Review available models"]', '["Describe the device you need","Add model or usage details","Review availability and status"]', '["Find available CAT6 CPE devices in the lab.","Check whether this device is currently available."]', 'Lab device inventory, status, and current account permissions'),
  ('skilltr-creator-zh', 'skillcat-native-skill-creator', 'zh-CN', 'Skill 创建助手', '通过对话创建、修改和优化 Skill，无需了解文件结构', '["创建一个新的 Skill","更新已有 Skill","把重复工作变成 Skill"]', '["描述你希望它完成什么","回答必要的问题","检查结果并开始使用"]', '["帮我创建一个分析工单趋势的 Skill","将我的数据检查流程整理成一个 Skill"]', '仅访问用户在当前会话中主动提供的文件与上下文'),
  ('skilltr-creator-en', 'skillcat-native-skill-creator', 'en-US', 'Skill Creator', 'Create, update, and improve Skills through a guided conversation', '["Create a new Skill","Update an existing Skill","Turn repeat work into a Skill"]', '["Describe what you want it to do","Answer the required questions","Review the result and start using it"]', '["Help me build a Skill to analyze daily network alarms","Turn our onboarding checklist into a reusable Skill"]', 'Only accesses files and context the user provides in the current conversation'),
  ('skilltr-power-zh', 'skillcat-native-power-outage-report', 'zh-CN', '停电分析报告', '统计停电时长、次数和影响范围', '["统计停电影响范围","分析恢复时长","生成管理汇报"]', '["说明统计时间和区域","确认需要的指标","生成并检查报告"]', '["生成上周华东地区的停电报表。","分析本月与上月停电次数和恢复时长的变化。"]', '当前账号有权访问的停电事件与影响数据'),
  ('skilltr-power-en', 'skillcat-native-power-outage-report', 'en-US', 'Power Outage Analysis Report', 'Analyze outage duration, frequency, and impact', '["Measure outage impact","Analyze recovery time","Prepare a management report"]', '["Choose a period and region","Confirm the required metrics","Generate and review the report"]', '["Create last week’s outage report for East China.","Compare outage count and recovery time with last month."]', 'Outage events and impact data available to the current account'),
  ('skilltr-bss-zh', 'skillcat-native-bss-report', 'zh-CN', 'BSS 运营报告', '汇总 BSS 运营数据', '["生成 BSS 业务报表","汇总运营数据","分析业务趋势"]', '["说明报告周期","选择关注指标","生成并检查报告"]', '["生成本月 BSS 业务运营汇总。","对比最近三个月的 BSS 关键指标变化。"]', '当前账号有权访问的 BSS 业务数据'),
  ('skilltr-bss-en', 'skillcat-native-bss-report', 'en-US', 'BSS Operations Report', 'Summarize BSS operational data', '["Create a BSS report","Summarize operations data","Analyze business trends"]', '["Choose a reporting period","Select key metrics","Generate and review the report"]', '["Create this month’s BSS operations summary.","Compare BSS metrics across the last three months."]', 'BSS business data available to the current account'),
  ('skilltr-core-zh', 'skillcat-native-core-network-report', 'zh-CN', '核心网告警月报', '生成核心网告警月度分析报告', '["生成核心网告警月报","汇总告警趋势","整理重点告警"]', '["选择报告月份","确认告警范围","生成并检查报告"]', '["生成上个月的核心网告警月报。","汇总本月高频告警并说明趋势。"]', '当前账号有权访问的核心网告警数据'),
  ('skilltr-core-en', 'skillcat-native-core-network-report', 'en-US', 'Core Network Alarm Report', 'Create a monthly core network alarm analysis', '["Create a monthly alarm report","Summarize alarm trends","Review critical alarms"]', '["Choose the reporting month","Confirm the alarm scope","Generate and review the report"]', '["Create last month’s core network alarm report.","Summarize frequent alarms and explain the trend."]', 'Core network alarm data available to the current account'),
  ('skilltr-zendesk-zh', 'skillcat-native-zendesk-data', 'zh-CN', 'Zendesk 工单分析', '分析客户工单并提供处理建议', '["查询 Zendesk 工单","分析客户问题","汇总解决进展"]', '["说明查询范围","选择问题或指标","查看分析与建议"]', '["统计最近 7 天未解决的高优先级工单。","分析本月客户工单最常见的问题。"]', '当前账号有权访问的 Zendesk 工单与客户数据'),
  ('skilltr-zendesk-en', 'skillcat-native-zendesk-data', 'en-US', 'Zendesk Ticket Analysis', 'Analyze support tickets and recommend next actions', '["Find Zendesk tickets","Analyze customer issues","Summarize resolution progress"]', '["Describe the ticket scope","Choose questions or metrics","Review the analysis and actions"]', '["List high-priority tickets unresolved for 7 days.","Analyze the most common ticket topics this month."]', 'Zendesk ticket and customer data available to the current account'),
  ('skilltr-text-zh', 'skillcat-native-text-metrics', 'zh-CN', '文本指标分析', '提取并分析文本中的关键指标', '["提取关键词","统计文本指标","比较文本差异"]', '["提供需要分析的文本","选择关注指标","查看并解释结果"]', '["提取这份文档的关键词和出现频率。","比较两段文本的主要指标差异。"]', '仅使用用户提供的文本内容'),
  ('skilltr-text-en', 'skillcat-native-text-metrics', 'en-US', 'Text Metrics', 'Extract and analyze key text metrics', '["Extract keywords","Measure text metrics","Compare text content"]', '["Provide the text to analyze","Choose the metrics","Review and interpret the result"]', '["Extract keywords and frequency from this document.","Compare the key metrics in these two passages."]', 'Only uses text provided by the user')
ON CONFLICT ("catalog_entry_id", "locale") DO NOTHING;
