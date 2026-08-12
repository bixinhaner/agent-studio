import type { SkillCatalogLocalizedContent } from "./types.js";

export type CuratedSkillPresentation = {
  zh: SkillCatalogLocalizedContent;
  en: SkillCatalogLocalizedContent;
};

function content(
  displayName: string,
  summary: string,
  useCases: string[],
  usageSteps: string[],
  examplePrompts: string[],
  dataScope: string
): SkillCatalogLocalizedContent {
  return { displayName, summary, useCases, usageSteps, examplePrompts, dataScope };
}

export const CURATED_SKILL_PRESENTATIONS: Record<string, CuratedSkillPresentation> = {
  "1-core-network-month-alarm-report": {
    zh: content("核心网告警月报", "从标准 Zabbix 报表环境生成指定月份的核心网告警报告", ["生成核心网月度告警报告", "核对中英文报告文件", "获取可预览的 HTML 报告"], ["提供需要统计的年份和月份", "连接固定报表环境并运行标准脚本", "核验结果后返回中文和英文预览"], ["生成 2026 年 7 月的核心网告警月报。", "重新生成上个月的中英文核心网告警报告。"], "固定生产 Zabbix 报表环境中当前账号获准访问的告警与报表数据"),
    en: content("Core Network Alarm Report", "Generate monthly core-network alarm reports from the standard Zabbix reporting environment", ["Create a monthly core-network alarm report", "Verify Chinese and English report files", "Retrieve previewable HTML reports"], ["Provide the target year and month", "Run the standard scripts in the fixed reporting environment", "Verify and return both report previews"], ["Create the core-network alarm report for July 2026.", "Regenerate last month's Chinese and English alarm reports."], "Alarm and report data accessible to the authorized account in the fixed production Zabbix environment")
  },
  "analyze-kpi-evidence": {
    zh: content("KPI 证据分析", "按明确口径审查 KPI 异常、基线和关联证据，不越过证据下根因结论", ["排查站点或小区 KPI 劣化", "比较变更前后指标", "关联告警、版本和邻区变化"], ["提供数据文件、时区和分析范围", "确认阈值、低流量排除和基线规则", "输出可审计发现并标明待确认根因"], ["分析这份 KPI 表里最近一周的性能劣化。", "比较升级前后 KPI，并关联同期告警。"], "用户提供或明确授权访问的表格、数据库导出和粘贴数据；不会自行操作网络设备"),
    en: content("KPI Evidence Analysis", "Review KPI anomalies, baselines, and correlated evidence without overstating root cause", ["Investigate site or cell KPI degradation", "Compare metrics before and after a change", "Correlate alarms, versions, and neighbor changes"], ["Provide the data, time zone, and analysis scope", "Confirm thresholds, low-traffic exclusions, and baseline rules", "Return auditable findings with unconfirmed causes clearly marked"], ["Analyze performance degradation in this KPI file for the past week.", "Compare KPIs before and after the upgrade and correlate alarms."], "User-provided or explicitly authorized tables and exports; never operates network devices")
  },
  "analyze-packet-capture-evidence": {
    zh: content("抓包证据分析", "只读分析抓包与日志，先校验采集完整性再判断协议和信令问题", ["分析 PCAP/PCAPNG 信令流程", "定位重传、时延和协议失败", "与正常样本或日志做对比"], ["提供抓包、日志和采集点说明", "核对时间基准、接口覆盖和同一用户标识", "在证据边界内输出流程和异常结论"], ["分析这个 PCAP 中的接入失败流程。", "对比异常与正常抓包，找出重传和时延差异。"], "仅使用用户提供的抓包、日志和对照样本；不会连接、查询或配置网络设备"),
    en: content("Packet Capture Evidence Analysis", "Analyze captures and logs read-only after validating collection integrity and coverage", ["Analyze PCAP or PCAPNG signaling", "Locate retransmissions, delays, and protocol failures", "Compare an issue capture with logs or a normal baseline"], ["Provide captures, logs, and capture-point context", "Validate time basis, interface coverage, and same-user identity", "Report sequence evidence and bounded conclusions"], ["Analyze the access failure sequence in this PCAP.", "Compare the failing and normal captures for retransmission and delay differences."], "Only user-provided captures, logs, and comparison samples; never connects to or changes network devices")
  },
  "analyze-telecom-competitors": {
    zh: content("通信竞品分析", "基于可引用证据研究通信厂商、产品和市场策略，并输出管理层可用报告", ["对比竞品型号与技术能力", "研究供应链、认证和市场策略", "制作竞品分析文档或演示文稿"], ["说明竞品、产品和决策问题", "确定快速、标准或深度研究范围", "核对来源并生成 Markdown、Word 或 PPT"], ["对比这两款室外 CPE 的硬件、软件和市场定位。", "生成某竞品核心网产品的管理层分析 PPT。"], "公开可信来源、用户提供的资料及当前账号获准访问的数据；关键结论保留出处"),
    en: content("Telecom Competitive Analysis", "Research telecom vendors, products, and strategies with citable evidence and decision-ready outputs", ["Benchmark competitor products and technology", "Research supply chain, certification, and market strategy", "Create competitive-analysis documents or presentations"], ["Specify the competitor, product, and decision question", "Choose a quick, standard, or deep research scope", "Verify sources and deliver Markdown, Word, or PowerPoint"], ["Compare these outdoor CPE models on hardware, software, and positioning.", "Create an executive presentation on a competitor's core-network portfolio."], "Credible public sources, user-provided material, and authorized data, with sources retained for material claims")
  },
  "baicells-config-guide-synthesis": {
    zh: content("配置指南合成", "按模板和目标版本资料合成可交付的佰才邦基站配置指南", ["从多份版本文档合成配置指南", "迁移目标版本内容与图表", "校验并美化交付级 Word 文档"], ["提供结构模板和目标版本源文档", "完成资料完整性与目标版本证据检查", "生成、渲染并逐页核验 DOCX"], ["按这个模板合成 Nova 系列目标版本配置指南。", "继续完善这份配置指南并检查图片和表格。"], "仅使用用户提供的模板、目标版本资料和任务生成文件"),
    en: content("Configuration Guide Synthesis", "Build a delivery-ready Baicells base-station configuration guide from a template and target-version sources", ["Synthesize a guide from multiple version documents", "Migrate target-version text, images, and tables", "Validate and polish a delivery-grade Word document"], ["Provide the structure template and target-version sources", "Audit source completeness and target-version evidence", "Generate, render, and inspect the DOCX page by page"], ["Build the target-version Nova configuration guide from this template.", "Continue this guide and verify every image and table."], "Only user-provided templates, target-version sources, and files generated for the task")
  },
  "batch-template-docs": {
    zh: content("批量模板文档", "用已批准的训练数据批量生成模板化人员文档，并先做严格校验和预览", ["批量生成 DOCX 或文本模板", "校验人员数据与占位符", "执行受控的邮件合并训练"], ["提供模板和已批准的数据清单", "校验必填值、唯一人员和日期范围", "先生成两份预览，确认后再批量生成"], ["用这份批准的培训数据生成两份预览。", "确认预览后批量生成全部人员文档。"], "仅使用明确批准且绑定到文件清单的培训数据；不使用生产或未批准的人员数据"),
    en: content("Batch Template Documents", "Generate template-based personnel documents from approved training data with validation and preview gates", ["Batch-generate DOCX or text templates", "Validate personnel data and placeholders", "Run controlled mail-merge training"], ["Provide the template and approved data manifest", "Validate required values, unique people, and date ranges", "Generate exactly two previews before approved batch output"], ["Generate two previews from this approved training dataset.", "The previews are approved; generate the remaining personnel documents."], "Only explicitly approved training data bound to the supplied manifest; never production or unapproved personnel data")
  },
  "bss-report": {
    zh: content("BSS 月度报告", "从两个月的 EML 附件生成 Zed BSS 月度 HTML 报告", ["生成 BSS 月报", "汇总两个月邮件附件数据", "获取可预览的 HTML 报告"], ["提供目标月份及所需 EML 文件", "在固定报表环境运行标准流程", "核验并下载月报预览"], ["用这两个月的 EML 生成 2026 年 7 月 BSS 月报。", "重新生成上月 BSS 报告并返回预览。"], "用户提供的 EML 与固定 Zed BSS 报表服务器中当前账号获准访问的数据"),
    en: content("BSS Monthly Report", "Generate a Zed BSS monthly HTML report from two months of EML attachments", ["Create a BSS monthly report", "Aggregate two months of email attachment data", "Retrieve a previewable HTML report"], ["Provide the target month and required EML files", "Run the standard workflow in the fixed reporting environment", "Verify and download the monthly preview"], ["Create the July 2026 BSS report from these two months of EML files.", "Regenerate last month's BSS report and return the preview."], "User-provided EML files and data accessible to the authorized account on the fixed Zed BSS reporting server")
  },
  "build-baicells-network-health-report": {
    zh: content("网络健康评估报告", "综合 OMC 告警、4G KPI、站点和规划数据生成网络健康 PPT 与审计明细", ["生成 4G 网络健康报告", "汇总告警、KPI 和负荷问题", "输出管理 PPT 与 Excel 明细"], ["提供所需 CSV 和 XLSX 数据", "核对时间范围、字段和站点口径", "生成并校验 PPTX 与审计工作簿"], ["用这些 OMC 和 KPI 文件生成网络健康报告。", "更新日报并补充问题闭环 Excel 明细。"], "用户提供的 OMC、KPI、站点监控和规划文件及本任务生成的报告"),
    en: content("Network Health Assessment", "Combine OMC alarms, 4G KPIs, site, and planning data into an executive deck and auditable workbook", ["Create a 4G network-health report", "Summarize alarm, KPI, and load issues", "Deliver a management deck and Excel evidence"], ["Provide the required CSV and XLSX inputs", "Confirm period, fields, and site scope", "Generate and validate the PPTX and audit workbook"], ["Create a network-health assessment from these OMC and KPI files.", "Update the daily report and add an Excel issue-closure detail."], "User-provided OMC, KPI, station, monitoring, and planning files plus generated report artifacts")
  },
  "meeting-minutes-actions": {
    zh: content("会议纪要与行动项", "把原始会议记录整理为已确认决定、行动项、责任人、截止时间和待确认事项", ["整理会议纪要", "提取行动项和责任人", "更新决定、截止时间与待确认事项"], ["提供原始记录或现有纪要", "区分已确认决定和未定事项", "补齐责任人或标记待确认后输出"], ["整理这份会议记录并列出行动项。", "更新纪要中的责任人，缺少截止日的保留待确认。"], "仅使用用户提供的会议记录和明确确认的信息"),
    en: content("Meeting Minutes & Actions", "Turn meeting notes into confirmed decisions, actions, owners, due dates, and open questions", ["Structure meeting minutes", "Extract actions and owners", "Update decisions, deadlines, and open items"], ["Provide the raw notes or existing minutes", "Separate confirmed decisions from unresolved topics", "Clarify missing owners or mark unresolved fields before delivery"], ["Organize these notes and list every action item.", "Update the owners and leave missing deadlines as to be confirmed."], "Only user-provided meeting material and explicitly confirmed information")
  },
  "omc-operations": {
    zh: content("OMC 运维操作", "通过实时能力目录查询、诊断并按授权操作 OMC 管理的网络资源", ["查询站点、告警和性能", "诊断 OMC 管理资源", "执行经授权的配置或运维动作"], ["说明目标资源和要完成的操作", "实时查询可用能力及所需参数", "先展示关键影响，再按权限执行并返回结果"], ["查询这个站点当前告警和在线状态。", "检查可用操作后，按授权修改该设备参数。"], "当前账号获准访问的 OMC 资源与实时能力目录；变更操作受权限和确认约束"),
    en: content("OMC Operations", "Query, diagnose, and operate OMC-managed network resources through the live capability catalog", ["Check sites, alarms, and performance", "Diagnose OMC-managed resources", "Run authorized configuration or operations actions"], ["Describe the target resource and intended outcome", "Discover current capabilities and required parameters", "Show material impact before authorized execution and report the result"], ["Check this site's current alarms and online status.", "Discover the supported action, then change this device parameter with authorization."], "OMC resources and live capabilities available to the current account; state-changing actions remain permission- and confirmation-bound")
  },
  "oxm-operations": {
    zh: content("OXM 设备运维", "按设备软件版本匹配能力手册，安全查询和操作 OXM 管理的网络设备", ["查询设备状态、告警和拓扑", "分析无线、传输、日志和任务", "执行经授权的配置、文件或软件操作"], ["提供目标设备和业务目的", "识别软件版本并选择匹配能力", "通过连接器执行，核验结果与影响"], ["查询这台基站的状态、版本和当前告警。", "按当前版本能力检查并执行这个配置变更。"], "当前账号获准访问的 OXM 设备、版本化能力手册和操作结果；变更动作受权限及确认约束"),
    en: content("OXM Device Operations", "Use version-matched capability handbooks to safely query and operate OXM-managed devices", ["Check device status, alarms, and topology", "Analyze radio, transport, logs, and tasks", "Run authorized configuration, file, or software operations"], ["Provide the target device and operational goal", "Identify software version and select matching capabilities", "Execute through the connector and verify result and impact"], ["Check this base station's status, version, and active alarms.", "Use its current-version capability to validate and run this configuration change."], "OXM devices, versioned capability handbooks, and results available to the current account; changes remain permission- and confirmation-bound")
  },
  "power-outage-report": {
    zh: content("停电月报", "在固定报表环境按指定年月生成停电事件 HTML 月报", ["生成停电月报", "汇总停电次数、时长和影响", "获取可预览 HTML 报告"], ["提供需要统计的年份和月份", "在固定 SSH 环境运行标准报表流程", "核验结果并返回本地预览"], ["生成 2026 年 7 月停电月报。", "重新生成上个月的停电报告并返回预览。"], "固定生产报表环境中当前账号获准访问的停电数据"),
    en: content("Power Outage Monthly Report", "Generate a monthly outage HTML report for a specified year and month in the fixed reporting environment", ["Create a monthly outage report", "Summarize outage count, duration, and impact", "Retrieve a previewable HTML report"], ["Provide the target year and month", "Run the standard report process in the fixed SSH environment", "Verify the result and return a local preview"], ["Create the July 2026 power outage report.", "Regenerate last month's outage report and return the preview."], "Outage data accessible to the authorized account in the fixed production reporting environment")
  },
  "ppt-gen": {
    zh: content("分层可编辑演示文稿", "先生成视觉母版，再拆分资产并组装为文字可编辑、结构分层的 PPTX", ["制作高质量演示文稿", "把效果图复刻为可编辑 PPT", "生成分层背景、卡片、图标和文字"], ["说明主题、受众、页数和视觉要求", "生成母版并记录模块坐标", "拆分资产、组装 PPTX 并渲染检查"], ["为这个产品方案制作 10 页可编辑演示文稿。", "把这张效果图复刻为分层可编辑 PPT。"], "用户提供的内容和参考图，以及本任务生成的图像资产、坐标清单和 PPTX"),
    en: content("Layered Editable Presentation", "Create a visual master, split its assets, and assemble a layered PPTX with editable text", ["Create a polished presentation", "Rebuild a visual mockup as editable slides", "Generate layered backgrounds, cards, icons, and text"], ["Specify topic, audience, slide count, and visual direction", "Generate the visual master and coordinate manifest", "Assemble the layered PPTX and verify rendered slides"], ["Create a 10-slide editable deck for this product proposal.", "Rebuild this mockup as a layered, editable PowerPoint."], "User-provided content and references plus generated image assets, coordinate manifests, and presentation files")
  },
  "siteapp-surge-support": {
    zh: content("SiteApp 生产支持", "通过受控 SSH 读取 Surge 生产环境，以当前证据回答 SiteApp 使用和排障问题", ["查询 SiteApp 当前配置和数据", "解释页面流程与系统行为", "基于生产证据排查问题"], ["说明页面、对象和期望结果", "以只读方式核对生产代码、配置、数据或日志", "区分已确认事实与建议并给出操作路径"], ["为什么这个规划页面不能删除 Cell？", "检查生产环境中这个站点的当前规划状态。"], "受控 SSH 可读取的 SiteApp Surge 生产代码、配置、数据库和日志；默认只读，不执行未授权变更"),
    en: content("SiteApp Production Support", "Inspect the Surge production environment through controlled SSH to answer SiteApp usage and troubleshooting questions", ["Check current SiteApp configuration and data", "Explain workflows and system behavior", "Troubleshoot from live production evidence"], ["Describe the page, object, and expected outcome", "Inspect production code, configuration, data, or logs read-only", "Separate confirmed facts from recommendations and provide the supported path"], ["Why can't this planning page delete the Cell?", "Check this site's current planning state in production."], "SiteApp Surge production code, configuration, database, and logs accessible through controlled SSH; read-only by default with no unauthorized changes")
  },
  "ssh-device-inspector": {
    zh: content("SSH 设备检查", "通过授权 SSH 对 Linux 或 OpenWrt 设备做只读识别和升级前能力盘点", ["识别 CPE 或嵌入式设备", "盘点系统、硬件和可用命令", "生成安全的升级前设备画像"], ["提供 IP、端口和授权凭据", "执行只读系统与命令发现", "报告已确认信息和仍存在的不确定项"], ["通过 SSH 识别这台 CPE 的系统和硬件平台。", "为这台 OpenWrt 设备生成升级前只读检查报告。"], "用户明确授权的 SSH 设备及其只读系统信息；不会配置、重启或升级设备"),
    en: content("SSH Device Inspector", "Perform authorized read-only discovery of Linux or OpenWrt devices and build a pre-upgrade profile", ["Identify a CPE or embedded device", "Inventory OS, hardware, and available commands", "Create a safe pre-upgrade device profile"], ["Provide host, port, and authorized credentials", "Run read-only system and command discovery", "Report confirmed facts and remaining uncertainty"], ["Identify this CPE's operating system and hardware platform over SSH.", "Create a read-only pre-upgrade profile for this OpenWrt device."], "Explicitly authorized SSH devices and read-only system information; never configures, restarts, or upgrades a device")
  },
  "surge-vpn-manage": {
    zh: content("Surge VPN 管理", "为获授权管理员查询、添加或撤销 Surge WireGuard 用户和设备接入", ["查询当前 VPN 用户和设备", "新增用户并生成客户端配置", "撤销用户或设备访问"], ["说明要查询或变更的用户与设备", "核对管理员授权和当前 WireGuard 状态", "执行变更、验证结果并交付必要配置"], ["查询当前 Surge VPN 用户。", "新增两个 VPN 用户并生成各自配置。"], "Surge 生产 VPN 的授权用户、Peer 和 WireGuard 配置；仅为明确授权的管理请求执行变更"),
    en: content("Surge VPN Management", "Let authorized administrators query, add, or revoke Surge WireGuard users and device peers", ["List current VPN users and devices", "Add users and generate client configurations", "Revoke user or device access"], ["Specify the users or devices to query or change", "Verify administrator authorization and current WireGuard state", "Apply the change, verify it, and deliver required configuration"], ["List the current Surge VPN users.", "Add two VPN users and generate a configuration for each."], "Authorized Surge production VPN users, peers, and WireGuard configuration; changes only for explicitly authorized administration requests")
  },
  "test-daily-report": {
    zh: content("测试日报邮件", "把零散测试事实整理成规范的中文日报主题和可直接发送的富文本正文", ["生成版本测试日报", "整理测试进展与风险", "输出邮件主题和正文"], ["提供当日测试事实、版本和项目", "补齐或标记缺失的进展与风险信息", "生成可复制到邮箱的日报内容"], ["根据这些测试记录生成今天的日报邮件。", "按现有模板整理版本测试进展和风险。"], "仅使用用户提供的测试事实、表格和日志摘要；不会读取或发送真实邮件"),
    en: content("Test Daily Report Email", "Turn fragmented test facts into a structured Chinese daily-report subject and ready-to-send rich-text body", ["Create a software test daily report", "Organize progress and risks", "Produce an email subject and body"], ["Provide today's test facts, version, and project", "Complete or clearly mark missing progress and risk fields", "Generate content ready to copy into email"], ["Create today's test daily-report email from these notes.", "Organize this version's test progress and risks using the existing template."], "Only user-provided test facts, tables, and log summaries; does not read or send live email")
  },
  "text-metrics": {
    zh: content("文本指标统计", "统计纯文本和 Markdown 的行数、词数、字符数、空行和高频词", ["统计 TXT 或 Markdown 指标", "提取高频词", "比较文本规模和结构"], ["提供需要分析的文本文件", "说明需要的指标或 Top N", "返回统计结果和必要说明"], ["统计这份 Markdown 的行数、词数和字符数。", "列出这个 TXT 中出现最多的 20 个词。"], "仅使用用户提供的纯文本和 Markdown 文件"),
    en: content("Text Metrics", "Measure lines, words, characters, blank lines, and frequent terms in plain text and Markdown", ["Measure TXT or Markdown files", "Extract frequent terms", "Compare text size and structure"], ["Provide the text files", "Choose metrics or a Top N value", "Return the measurements with relevant notes"], ["Count lines, words, and characters in this Markdown file.", "List the 20 most frequent words in this TXT file."], "Only user-provided plain-text and Markdown files")
  },
  "weekly-alarm-operations-summary": {
    zh: content("每周告警运营摘要", "从一个或多个告警 CSV 生成简洁、可审计的每周运营摘要", ["汇总每周告警量和趋势", "分析级别、状态和高频类型", "整理未解决重点和后续动作"], ["提供告警 CSV 和报告周期", "检查数据质量、字段和时间范围", "输出趋势、重点对象和保守行动建议"], ["汇总这些 CSV 的本周告警运营情况。", "比较本周每天的告警趋势并列出未解决重点。"], "仅使用用户提供的告警 CSV；建议不会被表述为已确认根因或已执行动作"),
    en: content("Weekly Alarm Operations Summary", "Create a concise, auditable weekly operations summary from one or more alarm CSV files", ["Summarize weekly alarm volume and trend", "Analyze severity, status, and top alarm types", "List unresolved priorities and follow-up actions"], ["Provide alarm CSV files and the reporting period", "Validate data quality, fields, and time range", "Report trends, affected objects, and conservative next actions"], ["Summarize this week's alarm operations from these CSV files.", "Compare daily alarm trends and list unresolved priorities."], "Only user-provided alarm CSV files; recommendations are not presented as confirmed root causes or completed actions")
  },
  "write-weekly-report": {
    zh: content("周报整理", "根据当期事实生成或修改固定为“结果、风险、下周动作”的简洁 Markdown 周报", ["编写个人或项目周报", "把零散工作整理成结果", "更新风险和下周动作"], ["提供周期、汇报对象和当期事实", "核验数字并区分事实与计划", "按固定结构输出简洁 Markdown"], ["根据这些工作记录写本周周报。", "把这份周报改成结果、风险、下周动作三部分。"], "仅使用用户提供并确认的当期工作事实和数字"),
    en: content("Weekly Report Writer", "Create or revise a concise Markdown weekly report structured as results, risks, and next-week actions", ["Write an individual or project weekly report", "Turn activity notes into outcomes", "Update risks and next actions"], ["Provide the period, audience, and current facts", "Verify numbers and separate facts from plans", "Return concise Markdown in the fixed structure"], ["Write this week's report from these work notes.", "Rewrite this report as results, risks, and next-week actions."], "Only current-period work facts and figures provided and confirmed by the user")
  },
  "zendesk-data": {
    zh: content("Zendesk 工单数据", "查询、导出和分析 Zendesk 工单、用户、组织及支持运营趋势", ["查询和统计 Zendesk 工单", "分析客户问题与支持趋势", "生成工单运营报表"], ["说明时间、状态、组织或指标范围", "使用受控账号查询并校验数据", "返回统计、明细或报告文件"], ["统计最近 7 天未解决的高优先级工单。", "分析本月最常见的客户问题并生成报表。"], "内置受控账号有权访问的 Zendesk 工单、用户、组织和分组数据"),
    en: content("Zendesk Ticket Data", "Query, export, and analyze Zendesk tickets, users, organizations, and support trends", ["Find and count Zendesk tickets", "Analyze customer issues and support trends", "Create ticket-operations reports"], ["Define time, status, organization, or metric scope", "Query and validate data with the controlled account", "Return statistics, details, or report files"], ["Count high-priority tickets unresolved in the past seven days.", "Analyze this month's most common customer issues and create a report."], "Zendesk tickets, users, organizations, and groups accessible to the bundled controlled account")
  },
  "plugin-creator": {
    zh: content("插件创建助手", "创建或更新符合规范的 Codex 插件目录、manifest 和个人插件市场条目", ["创建新的个人插件", "补充插件中的 Skill 或可选目录", "更新插件市场排序和可用性信息"], ["说明插件名称和需要包含的能力", "生成目录与 .codex-plugin/plugin.json", "校验 manifest，并按需要更新市场与重装缓存"], ["创建一个包含两个 Skill 的个人插件。", "为这个插件补充 marketplace 条目并校验结构。"], "用户指定的本地插件目录和个人 marketplace 配置；创建或更新文件前遵循目标路径权限"),
    en: content("Plugin Creator", "Create or update valid Codex plugin directories, manifests, and personal marketplace entries", ["Create a personal plugin", "Add Skills or optional plugin folders", "Update marketplace ordering and availability metadata"], ["Specify the plugin name and included capabilities", "Generate the directory and .codex-plugin/plugin.json", "Validate the manifest and update marketplace or reinstall cache when needed"], ["Create a personal plugin containing two Skills.", "Add a marketplace entry for this plugin and validate its structure."], "User-specified local plugin directories and personal marketplace configuration, subject to target-path permissions")
  },
  "skill-installer": {
    zh: content("Skill 安装助手", "从精选目录或 Git 仓库安装 Codex Skill 到当前运行环境", ["查看可安装 Skill", "安装精选 Skill", "从公开或私有仓库安装 Skill"], ["说明要安装的 Skill 或仓库路径", "检查来源、目标名称和现有安装", "安装到 CODEX_HOME 并提示重新加载"], ["列出当前可安装的精选 Skill。", "从这个 Git 仓库安装指定 Skill。"], "所选目录或 Git 仓库以及当前 CODEX_HOME/skills；安装会写入当前运行环境"),
    en: content("Skill Installer", "Install Codex Skills from the curated catalog or a Git repository into the current runtime", ["List installable Skills", "Install a curated Skill", "Install a Skill from a public or private repository"], ["Specify the Skill or repository path", "Check source, target name, and existing installation", "Install into CODEX_HOME and prompt for reload"], ["List the curated Skills available to install.", "Install the specified Skill from this Git repository."], "The selected catalog or Git repository and current CODEX_HOME/skills; installation writes to the current runtime")
  }
};

export const NATIVE_PRESENTATION_BACKFILL_NAMES = [
  "oxm-operations",
  "plugin-creator",
  "skill-installer"
] as const;
