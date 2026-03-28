import type { KnowledgeSetOption } from "./types";

type KnowledgeSetPickerProps = {
  defaultKnowledgeSets: KnowledgeSetOption[];
  optionalKnowledgeSets: KnowledgeSetOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export function KnowledgeSetPicker({
  defaultKnowledgeSets,
  optionalKnowledgeSets,
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
    <section className="knowledge-set-panel" aria-label="知识集">
      <div className="knowledge-set-copy">
        <h3>知识集</h3>
        <p>默认知识集始终挂载，授权的可选知识集可以按工作区单独勾选。</p>
      </div>

      <div className="knowledge-set-group">
        <div className="knowledge-set-group-header">
          <span className="knowledge-set-group-label">默认知识集</span>
          <span className="knowledge-set-group-hint">自动挂载</span>
        </div>
        {defaultKnowledgeSets.length > 0 ? (
          <ul className="knowledge-set-default-list">
            {defaultKnowledgeSets.map((item) => (
              <li key={item.id} className="knowledge-set-default-item">
                {item.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="knowledge-set-empty">当前工作区没有默认知识集。</p>
        )}
      </div>

      <div className="knowledge-set-group">
        <div className="knowledge-set-group-header">
          <span className="knowledge-set-group-label">可选知识集</span>
          <span className="knowledge-set-group-hint">仅显示已授权项</span>
        </div>
        {optionalKnowledgeSets.length > 0 ? (
          <div className="knowledge-set-option-list">
            {optionalKnowledgeSets.map((item) => {
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
          <p className="knowledge-set-empty">当前工作区没有可选知识集。</p>
        )}
      </div>
    </section>
  );
}

export default KnowledgeSetPicker;
