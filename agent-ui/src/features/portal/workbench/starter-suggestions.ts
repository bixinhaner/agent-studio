import type { SuggestionConfig } from "@assistant-ui/react-ui";

export const PORTAL_STARTER_SUGGESTIONS: SuggestionConfig[] = [
  {
    text: "Check product & version fit",
    prompt: "Help me identify the correct Baicells product line, model, software branch, and version scope for this scenario. If key context is missing, ask for the minimum details needed before giving a conclusion."
  },
  {
    text: "Review deployment plan",
    prompt: "Review this Baicells deployment or configuration plan. Point out mismatches, risks, and the recommended next steps based on official product guidance."
  },
  {
    text: "Analyze alarm or KPI issue",
    prompt: "Analyze this Baicells alarm, KPI, log, or fault symptom. Explain likely causes, the recommended troubleshooting path, and what information is still needed."
  },
  {
    text: "Recommend solution design",
    prompt: "Recommend a Baicells product or solution approach for this customer scenario, including suitable products, deployment considerations, and key constraints."
  }
];
