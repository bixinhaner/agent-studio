INSERT INTO "skill_catalog_entries"
  ("id", "catalog_key", "source_type", "source_ref", "canonical_name", "default_locale", "icon_key", "sort_order", "status", "published_at")
VALUES
  ('skillcat-plugin-documents', 'global:plugin:documents', 'plugin', 'documents', 'documents', 'zh-CN', 'document', 110, 'active', CURRENT_TIMESTAMP),
  ('skillcat-plugin-pdf', 'global:plugin:pdf', 'plugin', 'pdf', 'pdf', 'zh-CN', 'pdf', 120, 'active', CURRENT_TIMESTAMP),
  ('skillcat-plugin-presentations', 'global:plugin:presentations', 'plugin', 'presentations', 'presentations', 'zh-CN', 'presentation', 130, 'active', CURRENT_TIMESTAMP),
  ('skillcat-plugin-spreadsheets', 'global:plugin:spreadsheets', 'plugin', 'spreadsheets', 'spreadsheets', 'zh-CN', 'spreadsheet', 140, 'active', CURRENT_TIMESTAMP),
  ('skillcat-plugin-product-design', 'global:plugin:product-design', 'plugin', 'product-design', 'product-design', 'zh-CN', 'design', 150, 'active', CURRENT_TIMESTAMP),
  ('skillcat-plugin-visualize', 'global:plugin:visualize', 'plugin', 'visualize', 'visualize', 'zh-CN', 'visualize', 160, 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("catalog_key") DO NOTHING;

INSERT INTO "skill_catalog_translations"
  ("id", "catalog_entry_id", "locale", "display_name", "summary", "use_cases", "usage_steps", "example_prompts", "data_scope")
VALUES
  (
    'skilltr-plugin-documents-zh',
    'skillcat-plugin-documents',
    'zh-CN',
    '文档制作',
    '创建、编辑并检查 Word 文档，确保内容与排版可直接交付',
    '["把提纲整理成正式文档","生成报告、方案、备忘录或说明书","修改现有 DOCX 并检查页面布局"]',
    '["说明文档目标、读者和交付格式","提供素材、结构或现有文件","系统生成并渲染检查后交付 DOCX"]',
    '["把这份项目提纲整理成一份正式的 Word 项目备忘录。","根据附件生成中英文双语产品说明书，并检查分页。"]',
    '仅处理当前对话提供的内容、附件及会话工作区内生成的文档'
  ),
  (
    'skilltr-plugin-documents-en',
    'skillcat-plugin-documents',
    'en-US',
    'Document Creation',
    'Create, edit, and verify Word documents ready for delivery',
    '["Turn an outline into a polished document","Create reports, proposals, memos, or guides","Revise a DOCX file and verify its page layout"]',
    '["Describe the goal, audience, and deliverable","Provide source material, an outline, or an existing file","The system generates, renders, verifies, and delivers the DOCX"]',
    '["Turn this project outline into a polished Word memo.","Create a bilingual product guide from the attachments and verify pagination."]',
    'Uses only content, attachments, and generated documents available in the current conversation workspace'
  ),
  (
    'skilltr-plugin-pdf-zh',
    'skillcat-plugin-pdf',
    'zh-CN',
    'PDF 处理',
    '读取、生成、提取和视觉检查 PDF，适合对页面呈现有要求的任务',
    '["提取 PDF 中的文字、表格或重点","把内容制作成正式 PDF","检查 PDF 的分页、字体和版式"]',
    '["上传 PDF 或描述需要生成的内容","说明提取范围或版式要求","系统逐页检查并交付结果"]',
    '["提取这份 PDF 里的所有表格并总结异常数据。","把这份报告制作成正式 PDF，并检查每页版式。"]',
    '仅处理当前对话上传的 PDF、提供的内容及会话工作区内生成的文件'
  ),
  (
    'skilltr-plugin-pdf-en',
    'skillcat-plugin-pdf',
    'en-US',
    'PDF Processing',
    'Read, create, extract, and visually verify PDF files when page fidelity matters',
    '["Extract text, tables, or findings from a PDF","Create a polished PDF deliverable","Check pagination, fonts, and layout"]',
    '["Upload a PDF or describe the content to create","Specify extraction scope or layout requirements","The system checks pages visually and delivers the result"]',
    '["Extract every table from this PDF and summarize anomalies.","Turn this report into a polished PDF and verify every page."]',
    'Uses only PDFs, content, and generated files available in the current conversation workspace'
  ),
  (
    'skilltr-plugin-presentations-zh',
    'skillcat-plugin-presentations',
    'zh-CN',
    '演示文稿制作',
    '创建、编辑并渲染检查 PowerPoint 演示文稿',
    '["把材料整理成结构清晰的汇报","生成产品、项目或经营分析演示文稿","修改现有 PPTX 并统一视觉样式"]',
    '["说明汇报对象、时长和目标","提供素材、数据或现有演示文稿","系统制作、渲染检查并交付 PPTX"]',
    '["把这份季度经营数据做成 10 页管理层汇报。","重做附件中的演示文稿，统一版式并保留原始内容。"]',
    '仅处理当前对话提供的内容、附件及会话工作区内生成的演示文稿'
  ),
  (
    'skilltr-plugin-presentations-en',
    'skillcat-plugin-presentations',
    'en-US',
    'Presentation Creation',
    'Create, edit, render, and verify PowerPoint slide decks',
    '["Turn source material into a clear presentation","Create product, project, or business review decks","Revise a PPTX and unify its visual system"]',
    '["Describe the audience, duration, and objective","Provide source material, data, or an existing deck","The system creates, renders, verifies, and delivers the PPTX"]',
    '["Turn this quarterly operating data into a 10-slide executive review.","Redesign the attached deck with consistent layouts while preserving its content."]',
    'Uses only content, attachments, and generated presentations available in the current conversation workspace'
  ),
  (
    'skilltr-plugin-spreadsheets-zh',
    'skillcat-plugin-spreadsheets',
    'zh-CN',
    '表格分析与制作',
    '创建、编辑、分析并检查 Excel、CSV 和 TSV 表格文件',
    '["清洗和分析业务数据","制作带公式、图表和格式的 Excel","生成可复用的预算、台账或报表模板"]',
    '["上传数据或描述所需表格","说明指标、公式和展示要求","系统计算、检查并交付表格文件"]',
    '["分析这份销售 CSV，生成带趋势图的 Excel 报告。","制作一份包含公式和月度汇总的费用台账模板。"]',
    '仅处理当前对话提供的数据、附件及会话工作区内生成的表格；不直接控制用户电脑上已打开的 Excel'
  ),
  (
    'skilltr-plugin-spreadsheets-en',
    'skillcat-plugin-spreadsheets',
    'en-US',
    'Spreadsheet Analysis',
    'Create, edit, analyze, and verify Excel, CSV, and TSV files',
    '["Clean and analyze business data","Build Excel workbooks with formulas, charts, and formatting","Create reusable budgets, trackers, or report templates"]',
    '["Upload data or describe the workbook","Specify metrics, formulas, and presentation needs","The system calculates, verifies, and delivers the spreadsheet"]',
    '["Analyze this sales CSV and create an Excel report with trend charts.","Build an expense tracker template with formulas and monthly summaries."]',
    'Uses only data, attachments, and generated spreadsheets available in the current conversation workspace; it does not control an Excel workbook already open on the user device'
  ),
  (
    'skilltr-plugin-product-design-zh',
    'skillcat-plugin-product-design',
    'zh-CN',
    '产品设计',
    '从产品想法、页面、网址或截图出发，探索方案、审视体验并落地可验证原型',
    '["为产品需求探索多个视觉方向","审视现有页面或用户流程","从网址或效果图复刻可交互前端"]',
    '["提供需求、网址、截图或现有设计","确认目标用户与关键任务","系统生成方向、实施并通过真实页面检查结果"]',
    '["为这个企业审批场景设计三种界面方向。","审视这个页面的用户动线并给出带证据的改进方案。"]',
    '可使用当前对话提供的需求、图片、网址和会话工作区代码；访问外部页面时受当前网络和账号权限限制'
  ),
  (
    'skilltr-plugin-product-design-en',
    'skillcat-plugin-product-design',
    'en-US',
    'Product Design',
    'Explore directions, audit experiences, and build verifiable prototypes from ideas, URLs, or screenshots',
    '["Explore multiple visual directions for a product brief","Audit an existing screen or user flow","Turn a URL or mockup into an interactive frontend"]',
    '["Provide a brief, URL, screenshot, or existing design","Confirm the target user and core task","The system explores, builds, and checks the result in a real page"]',
    '["Create three interface directions for this enterprise approval workflow.","Audit this page journey and propose evidence-based improvements."]',
    'May use requirements, images, URLs, and workspace code provided in the current conversation; external access follows current network and account permissions'
  ),
  (
    'skilltr-plugin-visualize-zh',
    'skillcat-plugin-visualize',
    'zh-CN',
    '交互式可视化',
    '把数据、结构或原理制作成可筛选、可调整、可探索的交互视图',
    '["制作交互图表和数据探索器","展示流程、关系图或地图","用可调参数解释模型、原理或场景"]',
    '["提供数据或需要解释的关系","说明希望比较、筛选或调整的内容","系统生成可交互视图供继续探索"]',
    '["把这份数据做成可按区域和月份筛选的交互趋势图。","用可调整参数的模拟器展示库存变化。"]',
    '仅使用当前对话提供的数据和上下文；外部数据访问受当前网络与账号权限限制'
  ),
  (
    'skilltr-plugin-visualize-en',
    'skillcat-plugin-visualize',
    'en-US',
    'Interactive Visualization',
    'Turn data, structures, or concepts into filterable and adjustable interactive views',
    '["Build interactive charts and data explorers","Show flows, relationship graphs, or maps","Explain models and scenarios with adjustable inputs"]',
    '["Provide data or the relationship to explain","Describe what users should compare, filter, or adjust","The system creates an interactive view for further exploration"]',
    '["Turn this dataset into an interactive trend chart with region and month filters.","Show inventory changes in a simulator with adjustable inputs."]',
    'Uses only data and context provided in the current conversation; external data access follows current network and account permissions'
  )
ON CONFLICT ("catalog_entry_id", "locale") DO NOTHING;
