export const PORTAL_ROLE_KEYS = [
  "rd_software",
  "rd_hardware",
  "qa_test",
  "product",
  "solution_delivery",
  "sales_international",
  "sales_domestic",
  "finance",
  "hr_admin",
  "supply_chain",
  "manufacturing",
  "project_management",
  "general"
] as const;

export type PortalRoleKey = (typeof PORTAL_ROLE_KEYS)[number] | "customer";

const RULES: Array<{ key: PortalRoleKey; pattern: RegExp }> = [
  { key: "product", pattern: /产品战略|product strategy/i },
  { key: "finance", pattern: /财务|资金|会计|税|finance|account(ing)?\b|treasury/i },
  { key: "hr_admin", pattern: /人力|行政|总裁办|招聘|培训|\bhr\b|human|admin|office/i },
  { key: "supply_chain", pattern: /采购|仓储|供应链|pmc|计划|订单|物流|procure|supply|warehouse|logistic/i },
  { key: "manufacturing", pattern: /生产|量产|工艺|smt|车间|制造|manufactur|production/i },
  { key: "qa_test", pattern: /质量|测试|品质|quality|\bqa\b|test/i },
  { key: "sales_international", pattern: /int'?l|international|海外|国际|apec|mea|america|eu&ca|japan|key account/i },
  { key: "sales_domestic", pattern: /营销|销售|售前|市场|运营商|专网|渠道|政府事务|sales|market/i },
  { key: "project_management", pattern: /项目管理|商务运营|project management|commercial/i },
  { key: "solution_delivery", pattern: /交付|技术支持|运维|规划|方案|delivery|support|solution|planning/i },
  { key: "rd_hardware", pattern: /硬件|射频|天线|结构|hardware|\brf\b/i },
  { key: "product", pattern: /产品|前沿技术|战略|product|strategy/i },
  { key: "rd_software", pattern: /软件|协议|平台|开发|架构|核心网|物理层|应用系统|自动化|software|develop|platform|architect|protocol/i }
];

/** Maps a department name (and optional job title) to a portal home role. */
export function classifyPortalRole(departmentName?: string | null, position?: string | null): PortalRoleKey {
  const haystack = [position, departmentName].filter(Boolean).join(" ");
  if (!haystack.trim()) return "general";
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return rule.key;
  }
  return "general";
}
