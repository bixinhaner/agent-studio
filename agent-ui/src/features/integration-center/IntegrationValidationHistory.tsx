import type { IntegrationValidationItem } from './types';

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function stringifyUnknown(value: unknown) {
  if (typeof value === 'string') return value;
  if (value == null) return '-';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function IntegrationValidationHistory(props: { items: IntegrationValidationItem[] }) {
  if (props.items.length === 0) {
    return <p className="resource-center-empty">还没有验证历史。</p>;
  }

  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>验证与历史</h3>
          <p>按本地时区显示最近的手动或自动验证结果。</p>
        </div>
      </div>
      <div className="resource-policy-list">
        {props.items.map((item) => (
          <article key={item.id} className="resource-policy-card integration-history-card">
            <div className="resource-center-summary-grid compact">
              <div>
                <span className="field-label">状态</span>
                <p>{item.status}</p>
              </div>
              <div>
                <span className="field-label">触发方式</span>
                <p>{item.triggerType}</p>
              </div>
              <div>
                <span className="field-label">触发人</span>
                <p>{item.triggeredByUserId || '-'}</p>
              </div>
              <div>
                <span className="field-label">时间</span>
                <p>{formatTimestamp(item.createdAt)}</p>
              </div>
            </div>
            <div className="integration-history-detail">
              <p><strong>摘要：</strong>{stringifyUnknown(item.summary)}</p>
              <p><strong>详情：</strong>{stringifyUnknown(item.detail)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
