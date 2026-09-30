import type { PortalLocale } from "../i18n";

export type RoleSuggestion = { label: string; prompt: string };

type RoleHome = {
  zh: RoleSuggestion[];
  en: RoleSuggestion[];
  /** Keywords matched against skill ids/names/labels to recommend skills. */
  skillKeywords: string[];
};

const ROLE_HOME: Record<string, RoleHome> = {
  rd_software: {
    skillKeywords: ["code", "log", "review", "doc", "markdown", "pdf"],
    zh: [
      { label: "分析日志定位问题", prompt: "我会上传一段协议栈/平台日志，请帮我按时间线梳理关键事件，定位最可能的故障点，并给出排查步骤。" },
      { label: "评审代码改动", prompt: "请评审下面这段代码改动，指出潜在缺陷、边界条件和性能风险，并给出修改建议。" },
      { label: "写技术设计说明", prompt: "请根据以下需求帮我写一份技术设计说明，包括背景、方案对比、接口设计、风险和测试要点。" },
      { label: "解读 3GPP 规范", prompt: "请用通俗的语言解释以下 3GPP 规范条款的含义、适用场景，以及在我们基站实现中需要注意的地方。" }
    ],
    en: [
      { label: "Analyze logs to find a fault", prompt: "I will upload protocol-stack or platform logs. Build a timeline of key events, locate the most likely failure point and list troubleshooting steps." },
      { label: "Review a code change", prompt: "Review the following code change. Point out likely bugs, edge cases and performance risks, and suggest fixes." },
      { label: "Draft a technical design", prompt: "Write a technical design for the requirement below: background, option comparison, interface design, risks and test points." },
      { label: "Explain a 3GPP clause", prompt: "Explain the following 3GPP clause in plain language, when it applies, and what our base-station implementation must watch for." }
    ]
  },
  rd_hardware: {
    skillKeywords: ["pdf", "xlsx", "excel", "doc"],
    zh: [
      { label: "整理测试数据", prompt: "我会上传射频/硬件测试数据表，请帮我汇总关键指标、标出超限项，并生成对比图表。" },
      { label: "器件选型对比", prompt: "请对比以下几款器件的关键参数、成本和供货风险，给出选型建议。" },
      { label: "写硬件问题分析报告", prompt: "请根据以下现象和测试结果，写一份硬件问题分析报告：现象、复现条件、根因分析、改进措施。" },
      { label: "解读数据手册", prompt: "请阅读我上传的数据手册，提炼关键电气参数、设计注意事项和典型应用电路要点。" }
    ],
    en: [
      { label: "Summarize test data", prompt: "I will upload RF or hardware test data. Summarize key metrics, flag out-of-limit items and chart the comparison." },
      { label: "Compare components", prompt: "Compare these components on key parameters, cost and supply risk, and recommend one." },
      { label: "Write a failure analysis", prompt: "Write a hardware failure analysis from the symptoms and test results below: symptom, reproduction, root cause, corrective actions." },
      { label: "Digest a datasheet", prompt: "Read the uploaded datasheet and extract key electrical parameters, design cautions and typical application notes." }
    ]
  },
  qa_test: {
    skillKeywords: ["xlsx", "excel", "test", "doc"],
    zh: [
      { label: "生成测试用例", prompt: "请根据以下功能说明生成测试用例，覆盖正常、异常和边界场景，用表格输出。" },
      { label: "汇总缺陷趋势", prompt: "我会上传缺陷导出表，请按模块、严重程度和时间汇总趋势，指出需要重点关注的问题。" },
      { label: "写测试报告", prompt: "请根据以下测试结果写一份版本测试报告，包括测试范围、结论、遗留问题和发布建议。" },
      { label: "分析失败用例", prompt: "请分析这些失败用例的日志，区分环境问题、脚本问题和产品缺陷，并给出下一步动作。" }
    ],
    en: [
      { label: "Generate test cases", prompt: "Generate test cases for the feature below, covering normal, error and boundary scenarios, as a table." },
      { label: "Summarize defect trends", prompt: "I will upload a defect export. Summarize trends by module, severity and time, and flag what needs attention." },
      { label: "Write a test report", prompt: "Write a release test report from the results below: scope, conclusion, open issues and release recommendation." },
      { label: "Triage failed cases", prompt: "Analyze the logs of these failed cases, separate environment, script and product issues, and propose next steps." }
    ]
  },
  product: {
    skillKeywords: ["ppt", "pptx", "slide", "doc", "xlsx"],
    zh: [
      { label: "写产品需求文档", prompt: "请根据以下想法帮我写一份 PRD：背景、目标用户、核心场景、功能清单、优先级和验收标准。" },
      { label: "竞品对比分析", prompt: "请对比我们和以下竞品在功能、价格、部署方式上的差异，给出我们的差异化机会。" },
      { label: "做产品介绍 PPT", prompt: "请帮我做一份 10 页左右的产品介绍 PPT，面向运营商客户，突出价值和典型案例。" },
      { label: "梳理版本路线图", prompt: "请把以下需求按价值和投入排序，整理成未来三个版本的路线图，并说明取舍理由。" }
    ],
    en: [
      { label: "Write a PRD", prompt: "Turn the idea below into a PRD: background, target users, key scenarios, feature list, priorities and acceptance criteria." },
      { label: "Compare competitors", prompt: "Compare us with the following competitors on features, pricing and deployment, and identify our differentiation." },
      { label: "Build a product deck", prompt: "Create a ~10-slide product introduction for operator customers, highlighting value and reference cases." },
      { label: "Plan a roadmap", prompt: "Rank the requirements below by value and effort, lay out a three-release roadmap and explain the trade-offs." }
    ]
  },
  solution_delivery: {
    skillKeywords: ["omc", "network", "ppt", "doc", "xlsx"],
    zh: [
      { label: "评审部署方案", prompt: "请评审这份部署/配置方案，指出与官方指导不一致的地方、风险点和推荐的下一步。" },
      { label: "分析告警或 KPI", prompt: "请分析这个告警、KPI 或故障现象，说明可能原因、推荐的排查路径，以及还需要哪些信息。" },
      { label: "写客户方案建议书", prompt: "请根据客户场景写一份方案建议书，包括推荐产品、组网方式、部署要点和关键约束。" },
      { label: "整理开局检查清单", prompt: "请为以下站点开局整理一份检查清单，按准备、安装、调测、验收分阶段列出。" }
    ],
    en: [
      { label: "Review a deployment plan", prompt: "Review this deployment or configuration plan. Point out mismatches with official guidance, risks and recommended next steps." },
      { label: "Analyze an alarm or KPI", prompt: "Analyze this alarm, KPI or fault symptom. Explain likely causes, the troubleshooting path and what information is still needed." },
      { label: "Draft a solution proposal", prompt: "Write a solution proposal for this customer scenario: recommended products, network design, deployment notes and constraints." },
      { label: "Build a site checklist", prompt: "Create a site bring-up checklist for the following sites, grouped by preparation, installation, commissioning and acceptance." }
    ]
  },
  sales_international: {
    skillKeywords: ["ppt", "pptx", "doc", "email", "translate"],
    zh: [
      { label: "写英文客户邮件", prompt: "请帮我写一封英文邮件给海外客户，内容是：……语气专业友好，结尾给出明确的下一步。" },
      { label: "准备客户拜访材料", prompt: "我下周要拜访一家海外运营商，请帮我准备拜访提纲、客户痛点假设和我们的价值主张。" },
      { label: "做报价方案说明", prompt: "请根据以下配置清单整理一份报价方案说明，解释配置理由和可选项，方便客户理解。" },
      { label: "翻译并润色标书", prompt: "请把下面这段标书内容翻译成英文并润色，保持技术术语准确。" }
    ],
    en: [
      { label: "Write a customer email", prompt: "Write a professional, friendly email to an overseas customer about the following, ending with a clear next step." },
      { label: "Prepare a customer visit", prompt: "I am visiting an overseas operator next week. Prepare an agenda, likely pain points and our value proposition." },
      { label: "Explain a quotation", prompt: "Turn the configuration list below into a quotation explanation that justifies each item and lists options." },
      { label: "Translate a tender response", prompt: "Translate the following tender content into English and polish it while keeping technical terms accurate." }
    ]
  },
  sales_domestic: {
    skillKeywords: ["ppt", "pptx", "doc", "xlsx"],
    zh: [
      { label: "梳理客户需求", prompt: "请根据以下沟通记录梳理客户的真实需求、决策链和顾虑，并给出跟进策略。" },
      { label: "写项目方案汇报", prompt: "请帮我写一份面向客户领导的项目方案汇报提纲，突出价值、投入和实施计划。" },
      { label: "做营销活动方案", prompt: "请为以下产品设计一场行业营销活动方案，包括目标客户、主题、议程和传播计划。" },
      { label: "分析商机漏斗", prompt: "我会上传商机清单，请按阶段和金额分析漏斗健康度，指出需要重点推进的商机。" }
    ],
    en: [
      { label: "Clarify customer needs", prompt: "From the notes below, identify the customer's real needs, decision chain and concerns, and suggest a follow-up plan." },
      { label: "Outline a proposal briefing", prompt: "Outline a proposal briefing for the customer's leadership, highlighting value, investment and rollout plan." },
      { label: "Plan a marketing event", prompt: "Design an industry marketing event for the following product: target customers, theme, agenda and promotion plan." },
      { label: "Review the pipeline", prompt: "I will upload the opportunity list. Assess funnel health by stage and value, and flag deals to push." }
    ]
  },
  finance: {
    skillKeywords: ["xlsx", "excel", "pdf", "data"],
    zh: [
      { label: "核对费用明细", prompt: "我会上传费用明细表，请按部门和科目汇总，标出异常或重复的记录。" },
      { label: "做月度经营分析", prompt: "请根据以下收入和成本数据做一份月度经营分析，包括同比环比、主要变动原因和建议。" },
      { label: "解读合同付款条款", prompt: "请阅读这份合同，提炼付款节点、条件和风险条款，用表格列出。" },
      { label: "整理报销政策问答", prompt: "请把以下报销制度整理成员工常见问答，语言简洁易懂。" }
    ],
    en: [
      { label: "Reconcile expenses", prompt: "I will upload an expense ledger. Summarize by department and account, and flag anomalies or duplicates." },
      { label: "Monthly performance review", prompt: "Build a monthly performance analysis from the revenue and cost data below: YoY, MoM, key drivers and recommendations." },
      { label: "Extract payment terms", prompt: "Read this contract and tabulate payment milestones, conditions and risky clauses." },
      { label: "Policy FAQ", prompt: "Turn the reimbursement policy below into a short, clear employee FAQ." }
    ]
  },
  hr_admin: {
    skillKeywords: ["doc", "ppt", "xlsx"],
    zh: [
      { label: "写招聘 JD", prompt: "请根据以下岗位要求写一份招聘 JD，包括职责、任职要求和亮点，语言有吸引力。" },
      { label: "准备培训材料", prompt: "请为新员工入职培训准备一份课件大纲，涵盖公司介绍、制度流程和常用工具。" },
      { label: "起草内部通知", prompt: "请帮我起草一份内部通知，内容是：……语气正式简洁。" },
      { label: "整理面试评估", prompt: "请根据以下面试记录整理候选人评估，按能力维度打分并给出录用建议。" }
    ],
    en: [
      { label: "Write a job description", prompt: "Write an engaging job description from the requirements below: responsibilities, qualifications and highlights." },
      { label: "Prepare onboarding training", prompt: "Outline an onboarding course covering company intro, policies and processes, and everyday tools." },
      { label: "Draft an announcement", prompt: "Draft a concise, formal internal announcement about the following." },
      { label: "Summarize interviews", prompt: "Summarize the candidate from the interview notes below, score each competency and give a hiring recommendation." }
    ]
  },
  supply_chain: {
    skillKeywords: ["xlsx", "excel", "data", "pdf"],
    zh: [
      { label: "分析库存与缺料", prompt: "我会上传库存和需求表，请找出缺料风险物料，并按紧急程度排序。" },
      { label: "供应商比价", prompt: "请对比以下供应商报价，综合价格、交期和质量给出推荐。" },
      { label: "整理交付计划", prompt: "请根据订单清单和产能情况整理一份交付计划，标出可能延期的订单。" },
      { label: "写采购合同要点", prompt: "请阅读这份采购合同，提炼交付、验收、违约责任等关键条款。" }
    ],
    en: [
      { label: "Find shortage risks", prompt: "I will upload inventory and demand sheets. Identify materials at risk of shortage, ranked by urgency." },
      { label: "Compare supplier quotes", prompt: "Compare the supplier quotes below on price, lead time and quality, and recommend one." },
      { label: "Build a delivery plan", prompt: "Build a delivery plan from the order list and capacity, and flag orders likely to slip." },
      { label: "Review a purchase contract", prompt: "Extract delivery, acceptance and liability terms from this purchase contract." }
    ]
  },
  manufacturing: {
    skillKeywords: ["xlsx", "excel", "pdf", "doc"],
    zh: [
      { label: "分析良率数据", prompt: "我会上传产线良率数据，请按工站和不良类型分析，找出主要问题和改善方向。" },
      { label: "写作业指导书", prompt: "请根据以下工序说明写一份作业指导书，步骤清晰并标出质量控制点。" },
      { label: "制定排产计划", prompt: "请根据订单需求和产线产能制定下周排产计划，并说明瓶颈工序。" },
      { label: "整理 8D 报告", prompt: "请根据以下质量问题信息整理一份 8D 报告。" }
    ],
    en: [
      { label: "Analyze yield data", prompt: "I will upload line yield data. Analyze by station and defect type, and identify the main issues and improvements." },
      { label: "Write a work instruction", prompt: "Write a work instruction from the process notes below with clear steps and quality checkpoints." },
      { label: "Plan production", prompt: "Plan next week's production from demand and line capacity, and call out bottleneck operations." },
      { label: "Prepare an 8D report", prompt: "Prepare an 8D report from the quality issue information below." }
    ]
  },
  project_management: {
    skillKeywords: ["ppt", "xlsx", "doc"],
    zh: [
      { label: "写项目周报", prompt: "请根据以下进展信息写一份项目周报：本周进展、下周计划、风险与需要的支持。" },
      { label: "拆解项目计划", prompt: "请把以下项目目标拆解成 WBS 和里程碑，并估算关键路径。" },
      { label: "整理会议纪要", prompt: "请把以下会议记录整理成纪要，列出结论、待办事项、负责人和截止时间。" },
      { label: "识别项目风险", prompt: "请根据项目现状识别主要风险，评估影响和概率，并给出应对措施。" }
    ],
    en: [
      { label: "Weekly project report", prompt: "Write a weekly project report from the updates below: progress, next week's plan, risks and support needed." },
      { label: "Break down a plan", prompt: "Break the project goals below into a WBS and milestones, and estimate the critical path." },
      { label: "Meeting minutes", prompt: "Turn the notes below into minutes with decisions, action items, owners and due dates." },
      { label: "Identify risks", prompt: "Identify the main project risks, rate impact and likelihood, and propose mitigations." }
    ]
  },
  general: {
    skillKeywords: ["ppt", "xlsx", "doc", "pdf"],
    zh: [
      { label: "总结文档要点", prompt: "请阅读我上传的文档，提炼核心要点、关键数据和需要我关注的事项。" },
      { label: "做一份汇报 PPT", prompt: "请根据以下内容帮我做一份简洁的汇报 PPT，结构清晰、重点突出。" },
      { label: "分析 Excel 数据", prompt: "我会上传一份表格，请帮我分析关键趋势并生成图表。" },
      { label: "起草邮件或通知", prompt: "请帮我起草一封邮件，内容是：……语气专业、简洁。" }
    ],
    en: [
      { label: "Summarize a document", prompt: "Read the uploaded document and extract the key points, figures and anything I should act on." },
      { label: "Make a briefing deck", prompt: "Turn the content below into a concise, well-structured briefing deck." },
      { label: "Analyze a spreadsheet", prompt: "I will upload a spreadsheet. Analyze the key trends and chart them." },
      { label: "Draft an email", prompt: "Draft a concise, professional email about the following." }
    ]
  }
};

export const ROLE_KEYS = Object.keys(ROLE_HOME);

export function roleSuggestions(roleKey: string | undefined, locale: PortalLocale): RoleSuggestion[] {
  const home = ROLE_HOME[roleKey ?? ""] ?? ROLE_HOME.general;
  return locale === "zh-CN" ? home.zh : home.en;
}

export function recommendSkills<T extends { id: string; name: string; label?: string }>(
  roleKey: string | undefined,
  skills: T[],
  limit = 4
): T[] {
  const keywords = (ROLE_HOME[roleKey ?? ""] ?? ROLE_HOME.general).skillKeywords;
  const scored = skills
    .map((skill) => {
      const haystack = `${skill.id} ${skill.name} ${skill.label ?? ""}`.toLowerCase();
      const index = keywords.findIndex((keyword) => haystack.includes(keyword));
      return { skill, score: index < 0 ? Number.POSITIVE_INFINITY : index };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((item) => item.skill);
}
