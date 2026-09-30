import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Form, Input, Popconfirm, Segmented, Select, Skeleton, Switch, Tag, Tooltip, message as antdMessage } from "antd";
import { BellRing, Plus, Send, Trash2 } from "lucide-react";

import { usePortalI18n, type PortalMessageKey } from "../i18n";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  searchSubscriptionTargets,
  testSubscription,
  updateSubscription,
  type NotificationSubscription,
  type SubscriptionOverview,
  type SubscriptionSeverity
} from "./api";
import { browserTimezone, formatDateTime } from "./schedule-format";

const SEVERITIES: SubscriptionSeverity[] = ["critical", "high", "medium", "low", "info"];

type FormValues = {
  target_type: "user" | "department" | "role";
  target_id?: string;
  scenario_key: string;
  connector_id: string;
  min_severity: SubscriptionSeverity;
  delivery_mode: "realtime" | "digest";
  digest_time: string;
};

const ALL = "__all__";

export function SubscriptionsDrawer(props: { open: boolean; onClose(): void }) {
  const { t, locale, intlLocale } = usePortalI18n();
  const [message, messageHolder] = antdMessage.useMessage();
  const [overview, setOverview] = useState<SubscriptionOverview | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState<Array<{ value: string; label: string }>>([]);
  const [form] = Form.useForm<FormValues>();
  const targetType = Form.useWatch("target_type", form);
  const deliveryMode = Form.useWatch("delivery_mode", form);

  const reload = useCallback(async () => {
    try {
      setOverview(await listSubscriptions());
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }, [message]);

  useEffect(() => {
    if (props.open) void reload();
  }, [props.open, reload]);

  const scenarioName = useCallback(
    (key: string | null) => {
      if (!key) return t("subs.scenarioAll");
      const scenario = overview?.scenarios.find((item) => item.key === key);
      return scenario ? (locale === "zh-CN" ? scenario.name_zh : scenario.name_en) : key;
    },
    [locale, overview?.scenarios, t]
  );

  const loadTargets = useCallback(
    async (q: string, type: FormValues["target_type"]) => {
      if (type === "user") return;
      try {
        const out = await searchSubscriptionTargets(q);
        setTargets((type === "department" ? out.departments : out.roles).map((item) => ({ value: item.id, label: item.name })));
      } catch {
        setTargets([]);
      }
    },
    []
  );

  useEffect(() => {
    if (creating && targetType && targetType !== "user") void loadTargets("", targetType);
  }, [creating, loadTargets, targetType]);

  const startCreate = () => {
    form.setFieldsValue({
      target_type: "user",
      target_id: undefined,
      scenario_key: ALL,
      connector_id: ALL,
      min_severity: "high",
      delivery_mode: "realtime",
      digest_time: "09:00"
    });
    setCreating(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await createSubscription({
        target_type: values.target_type,
        target_id: values.target_type === "user" ? undefined : values.target_id,
        scenario_key: values.scenario_key === ALL ? null : values.scenario_key,
        connector_id: values.connector_id === ALL ? null : values.connector_id,
        min_severity: values.min_severity,
        delivery_mode: values.delivery_mode,
        digest_time: values.delivery_mode === "digest" ? values.digest_time : null,
        timezone: browserTimezone()
      });
      message.success(t("subs.saved"));
      setCreating(false);
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (item: NotificationSubscription) => {
    try {
      await updateSubscription(item.id, { enabled: !item.enabled });
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const sendTest = async (item: NotificationSubscription) => {
    try {
      const out = await testSubscription(item.id);
      if (out.result === "sent") message.success(t("subs.testSent"));
      else message.warning(t("subs.testSkipped"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (item: NotificationSubscription) => {
    try {
      await deleteSubscription(item.id);
      message.success(t("subs.deleted"));
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const targetLabel = (item: NotificationSubscription) =>
    item.target_type === "user" && !overview?.can_manage_shared
      ? t("subs.target.user")
      : `${t(`subs.target.${item.target_type}` as PortalMessageKey)}${item.target_name ? ` · ${item.target_name}` : ""}`;

  const scenarioOptions = useMemo(
    () => [
      { value: ALL, label: t("subs.scenarioAll") },
      ...(overview?.scenarios ?? []).map((item) => ({ value: item.key, label: locale === "zh-CN" ? item.name_zh : item.name_en }))
    ],
    [locale, overview?.scenarios, t]
  );
  const connectorOptions = useMemo(
    () => [
      { value: ALL, label: t("subs.connectorAll") },
      ...(overview?.connectors ?? []).map((item) => ({
        value: item.id,
        label: `${item.name} · ${t("subs.findings30d", { count: item.finding_count_30d })}`
      }))
    ],
    [overview?.connectors, t]
  );

  return (
    <Drawer
      open={props.open}
      onClose={() => {
        setCreating(false);
        props.onClose();
      }}
      width={560}
      rootClassName="roadmap-drawer"
      title={
        <span className="roadmap-drawer-title">
          <BellRing size={18} aria-hidden="true" />
          {creating ? t("subs.new") : t("subs.title")}
        </span>
      }
      extra={!creating ? <Button type="primary" icon={<Plus size={15} />} onClick={startCreate}>{t("subs.new")}</Button> : null}
      destroyOnHidden
    >
      {messageHolder}
      {overview && !overview.dingtalk_bound ? <Alert type="warning" showIcon message={t("subs.notBound")} className="roadmap-alert" /> : null}
      {creating ? (
        <Form form={form} layout="vertical" requiredMark={false} className="roadmap-form">
          {overview?.can_manage_shared ? (
            <Form.Item name="target_type" label={t("subs.target")}>
              <Segmented
                options={(["user", "department", "role"] as const).map((value) => ({ value, label: t(`subs.target.${value}`) }))}
                onChange={() => form.setFieldValue("target_id", undefined)}
              />
            </Form.Item>
          ) : null}
          {targetType && targetType !== "user" ? (
            <Form.Item name="target_id" rules={[{ required: true }]}>
              <Select
                showSearch
                filterOption={false}
                placeholder={t("subs.targetPick")}
                options={targets}
                onSearch={(q) => void loadTargets(q, targetType)}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="scenario_key" label={t("subs.scenario")}>
            <Select options={scenarioOptions} />
          </Form.Item>
          <Form.Item name="connector_id" label={t("subs.connector")}>
            <Select options={connectorOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="min_severity" label={t("subs.severity")}>
            <Segmented options={SEVERITIES.slice(0, 4).map((value) => ({ value, label: t(`subs.severity.${value}`) }))} />
          </Form.Item>
          <Form.Item name="delivery_mode" label={t("subs.mode")}>
            <Segmented
              options={(["realtime", "digest"] as const).map((value) => ({ value, label: t(`subs.mode.${value}`) }))}
            />
          </Form.Item>
          {deliveryMode === "digest" ? (
            <Form.Item name="digest_time" label={t("subs.digestTime")} rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }]}>
              <Input type="time" step={300} />
            </Form.Item>
          ) : null}
          <div className="roadmap-form-actions">
            <Button onClick={() => setCreating(false)}>{t("tasks.cancel")}</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              {t("tasks.save")}
            </Button>
          </div>
        </Form>
      ) : !overview ? (
        <Skeleton active />
      ) : overview.subscriptions.length === 0 ? (
        <Empty
          image={<BellRing size={40} strokeWidth={1.4} className="roadmap-empty-icon" />}
          description={
            <span className="roadmap-empty">
              <strong>{t("subs.empty")}</strong>
              <span>{t("subs.emptyDetail")}</span>
            </span>
          }
        >
          <Button type="primary" icon={<Plus size={15} />} onClick={startCreate}>
            {t("subs.new")}
          </Button>
        </Empty>
      ) : (
        <>
          <p className="roadmap-muted roadmap-drawer-intro">{t("subs.subtitle")}</p>
          <ul className="roadmap-card-list">
            {overview.subscriptions.map((item) => (
              <li key={item.id} className={`roadmap-card${item.enabled ? "" : " is-paused"}`}>
                <div className="roadmap-card-main">
                  <div className="roadmap-card-body">
                    <strong>{scenarioName(item.scenario_key)}</strong>
                    <span className="roadmap-card-meta">
                      <Tag>{targetLabel(item)}</Tag>
                      {t("subs.summary", {
                        source: item.connector_id
                          ? overview.connectors.find((connector) => connector.id === item.connector_id)?.name ?? item.connector_id
                          : t("subs.connectorAll"),
                        severity: t(`subs.severity.${item.min_severity}` as PortalMessageKey),
                        mode:
                          item.delivery_mode === "digest"
                            ? `${t("subs.mode.digest")} ${item.digest_time ?? ""}`
                            : t("subs.mode.realtime")
                      })}
                    </span>
                    {item.last_delivered_at ? (
                      <span className="roadmap-card-meta">{t("subs.lastDelivered", { time: formatDateTime(item.last_delivered_at, intlLocale) })}</span>
                    ) : null}
                  </div>
                  <div className="roadmap-card-actions">
                    <Tooltip title={t("subs.test")}>
                      <Button type="text" icon={<Send size={16} />} aria-label={t("subs.test")} onClick={() => void sendTest(item)} />
                    </Tooltip>
                    <Switch size="small" checked={item.enabled} onChange={() => void toggle(item)} />
                    <Popconfirm
                      title={t("subs.deleteConfirm")}
                      okText={t("tasks.delete")}
                      cancelText={t("tasks.cancel")}
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void remove(item)}
                    >
                      <Button type="text" danger icon={<Trash2 size={16} />} aria-label={t("tasks.delete")} />
                    </Popconfirm>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}
