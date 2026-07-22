export type PortalSkillPresentation = {
  displayName: string;
  summary: string;
  useCases: string[];
  usageSteps: string[];
  examplePrompts: string[];
  dataScope?: string;
  iconKey: string;
  sortOrder: number;
  shortcutKey?: string;
  requestedLocale: string;
  resolvedLocale: string;
  fallbackLocale?: string;
};
