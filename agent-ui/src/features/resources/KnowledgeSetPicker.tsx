import type { KnowledgeSetOption } from "./types";
import { usePortalI18n } from "../portal/i18n";

type KnowledgeSetPickerProps = {
  knowledgeSets: KnowledgeSetOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export function KnowledgeSetPicker({
  knowledgeSets,
  selectedIds,
  onChange
}: KnowledgeSetPickerProps) {
  const { t } = usePortalI18n();
  const toggleKnowledgeSet = (knowledgeSetId: string) => {
    const next = selectedIds.includes(knowledgeSetId)
      ? selectedIds.filter((item) => item !== knowledgeSetId)
      : [...selectedIds, knowledgeSetId];
    onChange(next);
  };

  return (
    <section className="knowledge-set-panel" aria-label={t("settings.knowledgeSets")}>
      <div className="knowledge-set-copy">
        <h3>{t("settings.knowledgeSets")}</h3>
        <p>{t("settings.knowledgeHelp")}</p>
      </div>

      <div className="knowledge-set-group">
        <div className="knowledge-set-group-header">
          <span className="knowledge-set-group-label">{t("settings.knowledgeAvailable")}</span>
          <span className="knowledge-set-group-hint">{t("settings.knowledgeAuthorized")}</span>
        </div>
        {knowledgeSets.length > 0 ? (
          <div className="knowledge-set-option-list">
            {knowledgeSets.map((item) => {
              const checked = selectedIds.includes(item.id);
              const inputId = `knowledge-set-option-${item.id}`;
              return (
                <div key={item.id} className="knowledge-set-option">
                  <input id={inputId} type="checkbox" checked={checked} onChange={() => toggleKnowledgeSet(item.id)} />
                  <label htmlFor={inputId} className="knowledge-set-option-text">
                    <span className="knowledge-set-option-label">{item.label}</span>
                    <span className="knowledge-set-option-slug" aria-hidden="true">
                      {item.slug}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="knowledge-set-empty">{t("settings.knowledgeEmpty")}</p>
        )}
      </div>
    </section>
  );
}

export default KnowledgeSetPicker;
