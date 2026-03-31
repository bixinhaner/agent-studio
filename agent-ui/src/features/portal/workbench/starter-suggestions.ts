import type { SuggestionConfig } from "@assistant-ui/react-ui";

export const PORTAL_STARTER_SUGGESTIONS: SuggestionConfig[] = [
  {
    text: "生成会议纪要",
    prompt: "请根据我的问题输出结构化会议纪要，格式为：背景、结论、行动项、负责人、截止时间。"
  },
  {
    text: "给出复盘模板",
    prompt: "请给我一个可直接填写的项目复盘模板，包含目标、过程、结果、问题、改进计划。"
  },
  {
    text: "整理成方案文档",
    prompt: "请基于当前会话内容整理成正式方案文档，包含摘要、需求、方案、风险、验收标准。"
  },
  {
    text: "整理为执行清单",
    prompt: "请把当前会话整理为可执行清单，按优先级分组并输出负责人和预计完成时间。"
  }
];
