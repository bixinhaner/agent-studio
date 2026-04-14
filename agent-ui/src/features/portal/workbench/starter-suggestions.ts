import type { SuggestionConfig } from "@assistant-ui/react-ui";

export const PORTAL_STARTER_SUGGESTIONS: SuggestionConfig[] = [
  {
    text: "Build execution plan",
    prompt: "Create an execution plan for my goal with this structure: objective, scope, milestones, owners, risks, and acceptance criteria."
  },
  {
    text: "Draft meeting notes",
    prompt: "Generate structured meeting notes from the current context, including: background, conclusions, action items, owners, and due dates."
  },
  {
    text: "Generate retrospective",
    prompt: "Provide a retrospective template and fill it with current context: goals, process, outcomes, issues, and improvement plan."
  },
  {
    text: "Draft external announcement",
    prompt: "Turn this conversation into a professional external announcement draft with complete information and key Q&A."
  }
];
