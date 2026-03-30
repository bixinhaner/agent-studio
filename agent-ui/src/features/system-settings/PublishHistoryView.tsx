import type { SystemSettingsVersionMeta } from "./types";

type PublishHistoryViewProps = {
  draftMeta: SystemSettingsVersionMeta;
  publishedMeta: SystemSettingsVersionMeta | null;
  saving: boolean;
  publishing: boolean;
  onSave(): void;
  onPublish(): void;
};

function formatLocalDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function describeVersion(meta: SystemSettingsVersionMeta | null) {
  if (!meta) return "尚未发布";
  return `v${meta.versionNumber}`;
}

export function PublishHistoryView({ draftMeta, publishedMeta, saving, publishing, onSave, onPublish }: PublishHistoryViewProps) {
  return (
    <section className="resource-center-section">
      <div className="resource-center-section-header">
        <div>
          <h3>发布记录</h3>
          <p>草稿修改不会影响运行，必须显式发布后才会成为新默认值。</p>
        </div>
        <div className="system-settings-action-group">
          <button type="button" className="admin-secondary-btn" disabled={saving || publishing} onClick={onSave}>
            {saving ? "保存中..." : "保存草稿"}
          </button>
          <button type="button" className="admin-action-btn" disabled={saving || publishing} onClick={onPublish}>
            {publishing ? "发布中..." : "发布设置"}
          </button>
        </div>
      </div>

      <div className="system-settings-history-grid">
        <article className="system-settings-history-card">
          <h4>当前草稿</h4>
          <dl>
            <div>
              <dt>版本</dt>
              <dd>{describeVersion(draftMeta)}</dd>
            </div>
            <div>
              <dt>修订</dt>
              <dd>{draftMeta.revision}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{formatLocalDateTime(draftMeta.createdAt)}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{formatLocalDateTime(draftMeta.updatedAt)}</dd>
            </div>
            <div>
              <dt>发布状态</dt>
              <dd>{draftMeta.status}</dd>
            </div>
          </dl>
        </article>

        <article className="system-settings-history-card">
          <h4>最近发布</h4>
          <dl>
            <div>
              <dt>版本</dt>
              <dd>{describeVersion(publishedMeta)}</dd>
            </div>
            <div>
              <dt>修订</dt>
              <dd>{publishedMeta?.revision ?? "-"}</dd>
            </div>
            <div>
              <dt>发布时间</dt>
              <dd>{formatLocalDateTime(publishedMeta?.publishedAt ?? null)}</dd>
            </div>
            <div>
              <dt>发布人</dt>
              <dd>{publishedMeta?.publishedByUserId ?? "尚未发布"}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{formatLocalDateTime(publishedMeta?.updatedAt ?? null)}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  );
}
