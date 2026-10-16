import { type FC, useContext } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { BotIcon, ClipboardListIcon, PackageIcon, ZapIcon } from "lucide-react";
import { type PortalMessageKey, usePortalI18n } from "./i18n";
import { useBranding } from "../branding/BrandingProvider";
import { useHomeProfile } from "./roadmap/home-profile";
import { recommendSkills, roleSuggestions } from "./roadmap/role-home";
import { SkillComposerContext } from "./portal-contexts";

/** Built-in translations for branding welcome suggestions that are stored in English. */
export const WELCOME_SUGGESTION_TRANSLATIONS: Record<string, { label: PortalMessageKey; prompt: PortalMessageKey }> = {
  "Check product & version fit": { label: "welcome.fit", prompt: "welcome.fitPrompt" },
  "Review deployment plan": { label: "welcome.deployment", prompt: "welcome.deploymentPrompt" },
  "Analyze alarm or KPI issue": { label: "welcome.alarm", prompt: "welcome.alarmPrompt" },
  "Recommend solution design": { label: "welcome.solution", prompt: "welcome.solutionPrompt" },
  "Introduce Product Capabilities": { label: "welcome.productCapabilities", prompt: "welcome.productCapabilitiesPrompt" },
  "Introduce Solution Approach": { label: "welcome.solutionApproach", prompt: "welcome.solutionApproachPrompt" },
  "Clarify Customer Requirements": { label: "welcome.customerRequirements", prompt: "welcome.customerRequirementsPrompt" },
  "Recommend Product Solution": { label: "welcome.productSolution", prompt: "welcome.productSolutionPrompt" }
};

export const RoleWelcomeSuggestions: FC<{ roleKey: string }> = ({ roleKey }) => {
  const { locale, t } = usePortalI18n();
  const { availableSkills, enabledSkillIds, setSkills } = useContext(SkillComposerContext);
  const suggestions = roleSuggestions(roleKey, locale);
  const recommended = recommendSkills(roleKey, availableSkills, 4);
  const icons = [PackageIcon, ClipboardListIcon, BotIcon, ZapIcon];
  const classes = ["icon-green", "icon-blue", "icon-orange", "icon-purple"];
  return (
    <div className="portal-role-home">
      <p className="portal-role-home-hint">
        {t("home.roleHint", { role: t(`home.role.${roleKey}` as PortalMessageKey) })}
      </p>
      <div className="portal-welcome-suggestion-grid">
        {suggestions.map((suggestion, index) => {
          const Icon = icons[index % icons.length];
          return (
            <ThreadPrimitive.Suggestion
              key={`${roleKey}-${index}`}
              className="portal-welcome-suggestion-card"
              prompt={suggestion.prompt}
              send={false}
              clearComposer
            >
              <div className={`portal-welcome-suggestion-icon-wrap ${classes[index % classes.length]}`}>
                <Icon size={20} strokeWidth={2.5} />
              </div>
              <span className="portal-welcome-suggestion-text">{suggestion.label}</span>
            </ThreadPrimitive.Suggestion>
          );
        })}
      </div>
      {recommended.length ? (
        <div className="portal-role-home-skills" aria-label={t("home.recommendedSkills")}>
          <span className="portal-role-home-skills-label">{t("home.recommendedSkills")}</span>
          {recommended.map((skill) => {
            const active = enabledSkillIds.includes(skill.id);
            return (
              <button
                key={skill.id}
                type="button"
                className={`portal-role-home-skill${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() =>
                  void setSkills(active ? enabledSkillIds.filter((id) => id !== skill.id) : [...enabledSkillIds, skill.id])
                }
              >
                <ZapIcon size={13} aria-hidden="true" />
                {skill.presentation?.displayName || skill.label || skill.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export const DraftOnlyWelcomeSuggestions: FC = () => {
  const { behavior } = useBranding();
  const { locale, t } = usePortalI18n();
  const homeProfile = useHomeProfile();

  if (homeProfile?.audience === "internal") {
    return <RoleWelcomeSuggestions roleKey={homeProfile.role_key} />;
  }

  if (behavior.portalWelcomeSuggestions.length === 0) {
    return null;
  }

  const icons = [PackageIcon, ClipboardListIcon, BotIcon, ZapIcon];
  const classes = ["icon-green", "icon-blue", "icon-orange", "icon-purple"];

  return (
    <div className="portal-welcome-suggestion-grid">
      {behavior.portalWelcomeSuggestions.map((suggestion, index) => {
        const Icon = icons[index % icons.length];
        const iconClass = classes[index % classes.length];
        const translated = WELCOME_SUGGESTION_TRANSLATIONS[suggestion.label.trim()];
        const localizedSuggestion = locale === "zh-CN" && translated
          ? { label: t(translated.label), prompt: t(translated.prompt) }
          : suggestion;
        return (
          <ThreadPrimitive.Suggestion
            key={`${localizedSuggestion.label}-${index}`}
            className="portal-welcome-suggestion-card"
            prompt={localizedSuggestion.prompt}
            send={false}
            clearComposer
          >
            <div className={`portal-welcome-suggestion-icon-wrap ${iconClass}`}>
              <Icon size={20} strokeWidth={2.5} />
            </div>
            <span className="portal-welcome-suggestion-text">{localizedSuggestion.label}</span>
          </ThreadPrimitive.Suggestion>
        );
      })}
    </div>
  );
};

export const DraftOnlyThreadWelcome: FC = () => {
  const { branding } = useBranding();
  const { locale, t } = usePortalI18n();
  const portalWelcomeIllustrationUrl = branding.portalWelcomeIllustrationUrl.trim();
  const assistantDisplayName = branding.assistantName.trim() || "AI Assistant";

  return (
    <ThreadPrimitive.Empty>
      <div className="portal-welcome-welcome-container">
        {portalWelcomeIllustrationUrl ? (
          <div className="portal-welcome-illustration-shell">
            <img
              className="portal-welcome-illustration"
              src={portalWelcomeIllustrationUrl}
              alt={assistantDisplayName}
              loading="eager"
            />
          </div>
        ) : null}
        <h1 className="portal-welcome-welcome-greeting">
          {locale === "zh-CN" ? <>你好，我是 <span>{assistantDisplayName}</span>。</> : <>Hello, I&apos;m <span>{assistantDisplayName}</span>.</>}
        </h1>
        <p className="portal-welcome-welcome-subtitle">
          {t("welcome.subtitle")}
        </p>
        <DraftOnlyWelcomeSuggestions />
      </div>
    </ThreadPrimitive.Empty>
  );
};

export function applyPortalWelcomeTemplate(
  template: string,
  replacements: {
    assistantName: string;
    platformName: string;
  }
): string {
  return template
    .replace(/\{\{\s*assistantName\s*\}\}/gi, replacements.assistantName)
    .replace(/\{\{\s*platformName\s*\}\}/gi, replacements.platformName)
    .trim();
}
