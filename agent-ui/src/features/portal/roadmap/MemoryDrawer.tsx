import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Popconfirm, Segmented, Select, Skeleton, Tag, Tooltip, message as antdMessage } from "antd";
import { Brain, Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { usePortalI18n } from "../i18n";
import {
  addMemory,
  deleteMemory,
  listMemories,
  updateMemory,
  type PortalMemoryCategory,
  type PortalMemoryItem,
  type PortalMemoryScope
} from "./api";

const CATEGORIES: PortalMemoryCategory[] = ["preference", "background", "habit"];

export function MemoryDrawer(props: {
  open: boolean;
  onClose(): void;
  modeLabel(modeId: string | null): string | undefined;
}) {
  const { t } = usePortalI18n();
  const [message, messageHolder] = antdMessage.useMessage();
  const [data, setData] = useState<{ enabled: boolean; scopes: PortalMemoryScope[] } | null>(null);
  const [scopeId, setScopeId] = useState<string>();
  const [category, setCategory] = useState<PortalMemoryCategory>("preference");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const raw = await listMemories();
      // Each assistant configuration keeps its own memory home; hide the empty ones
      // so the picker only lists places that actually hold memories.
      const nonEmpty = raw.scopes.filter((scope) => scope.items.length > 0);
      const out = { ...raw, scopes: nonEmpty.length ? nonEmpty : raw.scopes.slice(0, 1) };
      setData(out);
      setScopeId((current) => (current && out.scopes.some((scope) => scope.id === current) ? current : out.scopes[0]?.id));
    } catch (error) {
      setData({ enabled: false, scopes: [] });
      message.error(error instanceof Error ? error.message : String(error));
    }
  }, [message]);

  useEffect(() => {
    if (props.open) void reload();
  }, [props.open, reload]);

  const scope = data?.scopes.find((item) => item.id === scopeId);
  const items = useMemo(() => (scope?.items ?? []).filter((item) => item.category === category), [category, scope?.items]);
  const counts = useMemo(() => {
    const result: Record<PortalMemoryCategory, number> = { preference: 0, background: 0, habit: 0 };
    for (const item of scope?.items ?? []) result[item.category] += 1;
    return result;
  }, [scope?.items]);

  // One entry per assistant; the organization is only appended when two entries would read the same.
  const scopeLabel = useMemo(() => {
    const { modeLabel } = props;
    const base = (item: PortalMemoryScope) =>
      item.mode_id ? modeLabel(item.mode_id) ?? t("memory.scopeOther") : t("memory.scopeGeneral");
    const counts = new Map<string, number>();
    for (const item of data?.scopes ?? []) counts.set(base(item), (counts.get(base(item)) ?? 0) + 1);
    return (item: PortalMemoryScope) => {
      const label = base(item);
      return (counts.get(label) ?? 0) > 1 && item.organization_key ? `${label} · ${item.organization_key}` : label;
    };
  }, [data?.scopes, props.modeLabel, t]);

  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await task();
      message.success(success);
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const renderItem = (item: PortalMemoryItem) =>
    editing?.id === item.id ? (
      <li key={item.id} className="roadmap-memory-item is-editing">
        <Input.TextArea
          value={editing.text}
          autoSize={{ minRows: 2, maxRows: 6 }}
          maxLength={500}
          onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
          autoFocus
        />
        <div className="roadmap-memory-actions">
          <Button size="small" icon={<X size={14} />} onClick={() => setEditing(null)}>
            {t("tasks.cancel")}
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<Check size={14} />}
            loading={busy}
            disabled={!editing.text.trim()}
            onClick={() =>
              void run(async () => {
                await updateMemory(scope!.id, item.id, { text: editing.text });
                setEditing(null);
              }, t("memory.saved"))
            }
          >
            {t("memory.save")}
          </Button>
        </div>
      </li>
    ) : (
      <li key={item.id} className="roadmap-memory-item">
        <p>{item.text}</p>
        <div className="roadmap-memory-meta">
          <Tag bordered={false}>{item.source === "user" ? t("memory.sourceUser") : t("memory.sourceLearned")}</Tag>
          <span className="roadmap-memory-actions">
            <Select
              size="small"
              variant="borderless"
              value={item.category}
              popupMatchSelectWidth={false}
              options={CATEGORIES.map((value) => ({ value, label: t(`memory.category.${value}`) }))}
              onChange={(value) => void run(() => updateMemory(scope!.id, item.id, { category: value }), t("memory.saved"))}
            />
            <Tooltip title={t("memory.edit")}>
              <Button size="small" type="text" icon={<Pencil size={14} />} aria-label={t("memory.edit")} onClick={() => setEditing({ id: item.id, text: item.text })} />
            </Tooltip>
            <Popconfirm
              title={t("memory.deleteConfirm")}
              okText={t("memory.delete")}
              cancelText={t("tasks.cancel")}
              okButtonProps={{ danger: true }}
              onConfirm={() => void run(() => deleteMemory(scope!.id, item.id), t("memory.deleted"))}
            >
              <Button size="small" type="text" danger icon={<Trash2 size={14} />} aria-label={t("memory.delete")} />
            </Popconfirm>
          </span>
        </div>
      </li>
    );

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      width={520}
      rootClassName="roadmap-drawer"
      title={
        <span className="roadmap-drawer-title">
          <Brain size={18} aria-hidden="true" />
          {t("memory.title")}
        </span>
      }
      destroyOnHidden
    >
      {messageHolder}
      {!data ? (
        <Skeleton active />
      ) : (
        <>
          <p className="roadmap-muted roadmap-drawer-intro">{t("memory.subtitle")}</p>
          {!data.enabled ? <Alert type="info" showIcon message={t("memory.disabled")} className="roadmap-alert" /> : null}
          {data.scopes.length === 0 ? (
            <Empty image={<Brain size={40} strokeWidth={1.4} className="roadmap-empty-icon" />} description={t("memory.emptyNoScope")} />
          ) : (
            <>
              {data.scopes.length > 1 ? (
                <label className="roadmap-memory-scope">
                  <span>{t("memory.scope")}</span>
                  <Select
                    value={scopeId}
                    onChange={setScopeId}
                    options={data.scopes.map((item) => ({ value: item.id, label: `${scopeLabel(item)} (${item.items.length})` }))}
                  />
                </label>
              ) : null}
              <Segmented
                block
                value={category}
                onChange={(value) => setCategory(value as PortalMemoryCategory)}
                options={CATEGORIES.map((value) => ({ value, label: `${t(`memory.category.${value}`)} ${counts[value]}` }))}
              />
              <div className="roadmap-memory-add">
                <Input
                  value={draft}
                  maxLength={500}
                  placeholder={t("memory.addPlaceholder")}
                  onChange={(event) => setDraft(event.target.value)}
                  onPressEnter={() => {
                    if (!draft.trim() || !scope) return;
                    void run(async () => {
                      await addMemory({ scope_id: scope.id, text: draft, category });
                      setDraft("");
                    }, t("memory.saved"));
                  }}
                />
                <Button
                  type="primary"
                  icon={<Plus size={15} />}
                  loading={busy}
                  disabled={!draft.trim() || !scope}
                  onClick={() =>
                    void run(async () => {
                      await addMemory({ scope_id: scope!.id, text: draft, category });
                      setDraft("");
                    }, t("memory.saved"))
                  }
                >
                  {t("memory.add")}
                </Button>
              </div>
              {items.length ? (
                <ul className="roadmap-memory-list">{items.map(renderItem)}</ul>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span className="roadmap-empty">
                      <strong>{t("memory.empty")}</strong>
                      <span>{t("memory.emptyDetail")}</span>
                    </span>
                  }
                />
              )}
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
