import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Popconfirm, Select, Skeleton, Tooltip, message as antdMessage } from "antd";
import { Brain, Check, ChevronDown, ChevronRight, Languages, Pencil, Plus, Trash2, X } from "lucide-react";

import { usePortalI18n } from "../i18n";
import {
  addMemory,
  deleteMemory,
  listMemories,
  translateMemory,
  updateMemory,
  type MemoryContent,
  type MemoryLanguage,
  type MemoryPoint,
  type PortalMemoryItem,
  type PortalMemoryOverview,
  type PortalMemoryScope
} from "./api";

type TranslationState =
  | { status: "loading"; hash: string }
  | { status: "done"; hash: string; content: MemoryContent }
  | { status: "failed"; hash: string };

function PointList(props: { points: MemoryPoint[] }) {
  return (
    <ul className="roadmap-memory-points">
      {props.points.map((point, index) => (
        <li key={index}>
          {point.text}
          {point.details.length ? (
            <ul>
              {point.details.map((detail, detailIndex) => (
                <li key={detailIndex}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function MemoryDrawer(props: {
  open: boolean;
  onClose(): void;
  modeLabel(modeId: string | null): string | undefined;
}) {
  const { t, locale, intlLocale } = usePortalI18n();
  const uiLanguage: MemoryLanguage = locale === "zh-CN" ? "zh" : "en";
  const [message, messageHolder] = antdMessage.useMessage();
  const [data, setData] = useState<PortalMemoryOverview | null>(null);
  const [scopeId, setScopeId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [translations, setTranslations] = useState<Record<string, TranslationState>>({});
  const [showOriginal, setShowOriginal] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const out = await listMemories(locale);
      setData(out);
      setScopeId((current) => (current && out.scopes.some((scope) => scope.id === current) ? current : out.scopes[0]?.id));
    } catch (error) {
      setData({ enabled: false, learning: false, min_idle_hours: 6, translation_available: false, scopes: [] });
      message.error(error instanceof Error ? error.message : String(error));
    }
  }, [locale, message]);

  useEffect(() => {
    if (props.open) void reload();
  }, [props.open, reload]);

  const scope = data?.scopes.find((item) => item.id === scopeId);
  const learned = scope?.learned ?? null;
  const needsTranslation = Boolean(learned && learned.language !== uiLanguage);
  const translation = scope && learned ? translations[scope.id] : undefined;
  const translatedContent =
    learned?.translated && learned.translated.language === uiLanguage
      ? learned.translated
      : translation?.status === "done" && translation.hash === learned?.content_hash
        ? translation.content
        : undefined;

  // Codex writes its summary mostly in English; translate it for display (Codex keeps reading the original).
  useEffect(() => {
    if (!scope || !learned || !needsTranslation || !data?.translation_available || learned.translated) return;
    const current = translations[scope.id];
    if (current && current.hash === learned.content_hash) return;
    const hash = learned.content_hash;
    setTranslations((state) => ({ ...state, [scope.id]: { status: "loading", hash } }));
    translateMemory(scope.id, locale)
      .then((result) =>
        setTranslations((state) => ({ ...state, [scope.id]: { status: "done", hash: result.content_hash, content: result.translated } }))
      )
      .catch(() => setTranslations((state) => ({ ...state, [scope.id]: { status: "failed", hash } })));
  }, [data?.translation_available, learned, locale, needsTranslation, scope, translations]);

  useEffect(() => {
    setShowOriginal(false);
    setTipsOpen(false);
    setEditing(null);
  }, [scopeId]);

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

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    [intlLocale]
  );

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

  const submitDraft = () => {
    if (!draft.trim() || !scope || busy) return;
    void run(async () => {
      await addMemory({ scope_id: scope.id, text: draft });
      setDraft("");
    }, t("memory.saved"));
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
      <li key={item.id} className="roadmap-memory-item is-row">
        <p>{item.text}</p>
        <span className="roadmap-memory-actions">
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
      </li>
    );

  const renderLearned = () => {
    if (!learned) {
      return (
        <div className="roadmap-memory-learned is-empty">
          <strong>{t("memory.learned.empty")}</strong>
          <span>
            {data?.learning
              ? t("memory.learned.emptyDetail", { hours: data.min_idle_hours })
              : t("memory.learned.emptyDisabled")}
          </span>
        </div>
      );
    }
    const translating = needsTranslation && !translatedContent && translation?.status === "loading";
    const failed = needsTranslation && !translatedContent && (translation?.status === "failed" || !data?.translation_available);
    const content: MemoryContent = translatedContent && !showOriginal ? translatedContent : learned;
    const lang = translatedContent && !showOriginal ? uiLanguage : learned.language;
    return (
      <div className="roadmap-memory-learned" lang={lang === "zh" ? "zh-CN" : "en"} aria-busy={translating || undefined}>
        <div className="roadmap-memory-learned-meta">
          {learned.updated_at ? <span>{t("memory.learned.updated", { time: dateFormat.format(new Date(learned.updated_at)) })}</span> : <span />}
          {translatedContent ? (
            <button type="button" className="roadmap-memory-translate-toggle" onClick={() => setShowOriginal((value) => !value)}>
              <Languages size={13} aria-hidden="true" />
              {showOriginal ? t("memory.showTranslation") : `${t("memory.translated")} · ${t("memory.showOriginal")}`}
            </button>
          ) : null}
        </div>
        {translating ? (
          <div className="roadmap-memory-translating">
            <span className="roadmap-muted">{t("memory.translating")}</span>
            <Skeleton active title={false} paragraph={{ rows: 4 }} />
          </div>
        ) : (
          <>
            {failed ? <p className="roadmap-muted roadmap-memory-note">{t("memory.translateFailed")}</p> : null}
            {content.profile.length ? (
              <section>
                <h4>{t("memory.learned.profile")}</h4>
                {content.profile.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </section>
            ) : null}
            {content.preferences.length ? (
              <section>
                <h4>{t("memory.learned.preferences")}</h4>
                <PointList points={content.preferences} />
              </section>
            ) : null}
            {content.tips.length ? (
              <section>
                <button
                  type="button"
                  className="roadmap-memory-disclosure"
                  aria-expanded={tipsOpen}
                  onClick={() => setTipsOpen((value) => !value)}
                >
                  {tipsOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  {t("memory.learned.tips", { count: content.tips.length })}
                </button>
                {tipsOpen ? <PointList points={content.tips} /> : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      width={560}
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
                    options={data.scopes.map((item) => ({ value: item.id, label: scopeLabel(item) }))}
                  />
                </label>
              ) : null}

              <section className="roadmap-memory-section" aria-labelledby="memory-learned-title">
                <h3 id="memory-learned-title">{t("memory.learned.title")}</h3>
                <p className="roadmap-muted roadmap-memory-section-hint">{t("memory.learned.hint")}</p>
                {renderLearned()}
              </section>

              <section className="roadmap-memory-section" aria-labelledby="memory-mine-title">
                <h3 id="memory-mine-title">{t("memory.mine.title")}</h3>
                <p className="roadmap-muted roadmap-memory-section-hint">{t("memory.mine.hint")}</p>
                <div className="roadmap-memory-add">
                  <Input
                    value={draft}
                    maxLength={500}
                    placeholder={t("memory.addPlaceholder")}
                    aria-label={t("memory.addPlaceholder")}
                    onChange={(event) => setDraft(event.target.value)}
                    onPressEnter={submitDraft}
                  />
                  <Button type="primary" icon={<Plus size={15} />} loading={busy} disabled={!draft.trim() || !scope} onClick={submitDraft}>
                    {t("memory.add")}
                  </Button>
                </div>
                {scope?.user_items.length ? (
                  <ul className="roadmap-memory-list">{scope.user_items.map(renderItem)}</ul>
                ) : (
                  <p className="roadmap-muted roadmap-memory-note">{t("memory.mine.empty")}</p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
