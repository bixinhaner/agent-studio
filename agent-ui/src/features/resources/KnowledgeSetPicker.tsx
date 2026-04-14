import type { KnowledgeSetOption } from "./types";

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
  const toggleKnowledgeSet = (knowledgeSetId: string) => {
    const next = selectedIds.includes(knowledgeSetId)
      ? selectedIds.filter((item) => item !== knowledgeSetId)
      : [...selectedIds, knowledgeSetId];
    onChange(next);
  };

  return (
    <section className="knowledge-set-panel" aria-label="Knowledge sets">
      <div className="knowledge-set-copy">
        <h3>Knowledge Sets</h3>
        <p>Select knowledge sets to mount for the current agent, or leave all unselected.</p>
      </div>

      <div className="knowledge-set-group">
        <div className="knowledge-set-group-header">
          <span className="knowledge-set-group-label">Available knowledge sets</span>
          <span className="knowledge-set-group-hint">Only authorized items are shown</span>
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
          <p className="knowledge-set-empty">No knowledge sets are currently available.</p>
        )}
      </div>
    </section>
  );
}

export default KnowledgeSetPicker;
