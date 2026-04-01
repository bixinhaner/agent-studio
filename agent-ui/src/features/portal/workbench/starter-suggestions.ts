import type { SuggestionConfig } from "@assistant-ui/react-ui";

export const PORTAL_STARTER_SUGGESTIONS: SuggestionConfig[] = [
  {
    text: "输出执行方案",
    prompt: "请根据我的目标输出执行方案，结构为：目标、范围、里程碑、负责人、风险、验收标准。"
  },
  {
    text: "整理会议纪要",
    prompt: "请基于当前信息生成结构化会议纪要，包含：背景、结论、行动项、负责人、截止时间。"
  },
  {
    text: "生成复盘报告",
    prompt: "请给出复盘报告模板并结合当前内容填充：目标、过程、结果、问题、改进计划。"
  },
  {
    text: "生成对外公告",
    prompt: "请把当前会话整理成对外公告草稿，语气专业、信息完整，附关键问答。"
  }
];
