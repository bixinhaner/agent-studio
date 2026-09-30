import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Skeleton,
  Switch,
  Tag,
  Tooltip,
  message as antdMessage
} from "antd";
import { CalendarClock, ChevronDown, ChevronRight, ExternalLink, Pause, Play, Plus, Trash2, Zap } from "lucide-react";

import { usePortalI18n } from "../i18n";
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  runScheduledTaskNow,
  updateScheduledTask,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskRun
} from "./api";
import { browserTimezone, describeSchedule, formatDateTime, formatDuration } from "./schedule-format";

export type ScheduledTaskPrefill = {
  title?: string;
  prompt?: string;
  skillIds?: string[];
  sourceThreadId?: string | null;
};

export type ScheduledTaskContext = {
  skills: Array<{ id: string; label: string }>;
  /** Snapshot of the current mode/model so runs behave like the composer. */
  runSnapshot(): Pick<ScheduledTaskInput, "mode_id" | "model" | "reasoning_effort" | "run_config" | "folder_id">;
};

type FormValues = {
  title: string;
  prompt: string;
  skill_ids: string[];
  frequency: ScheduledTask["frequency"];
  weekdays: number[];
  day_of_month: number;
  time: string;
  notify_dingtalk: boolean;
};

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function RunStatusTag({ status }: { status: ScheduledTaskRun["status"] | null }) {
  const { t } = usePortalI18n();
  if (!status) return null;
  const color = status === "succeeded" ? "success" : status === "failed" ? "error" : "processing";
  return <Tag color={color}>{t(`tasks.status.${status}`)}</Tag>;
}

function TaskRuns(props: { taskId: string; onOpenThread(threadId: string): void }) {
  const { t, intlLocale, locale } = usePortalI18n();
  const [runs, setRuns] = useState<ScheduledTaskRun[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getScheduledTask(props.taskId)
      .then((out) => !cancelled && setRuns(out.task.runs ?? []))
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, [props.taskId]);
  if (!runs) return <Skeleton active paragraph={{ rows: 2 }} title={false} />;
  if (!runs.length) return <p className="roadmap-muted">{t("tasks.historyEmpty")}</p>;
  return (
    <ol className="roadmap-run-list">
      {runs.map((run) => (
        <li key={run.id} className={`roadmap-run is-${run.status}`}>
          <div className="roadmap-run-head">
            <RunStatusTag status={run.status} />
            <span>{formatDateTime(run.started_at, intlLocale)}</span>
            {run.finished_at ? (
              <span className="roadmap-muted">
                {t("tasks.duration", {
                  duration: formatDuration(Date.parse(run.finished_at) - Date.parse(run.started_at), locale)
                })}
              </span>
            ) : null}
            {run.artifact_count > 0 ? <span className="roadmap-muted">{t("tasks.files", { count: run.artifact_count })}</span> : null}
            {run.thread_id ? (
              <Button size="small" type="link" icon={<ExternalLink size={13} />} onClick={() => props.onOpenThread(run.thread_id!)}>
                {t("tasks.openThread")}
              </Button>
            ) : null}
          </div>
          {run.error ? <p className="roadmap-run-error">{run.error}</p> : null}
          {!run.error && run.answer_preview ? <p className="roadmap-run-preview">{run.answer_preview}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function ScheduledTasksDrawer(props: {
  open: boolean;
  prefill?: ScheduledTaskPrefill | null;
  context: ScheduledTaskContext;
  onClose(): void;
  onOpenThread(threadId: string): void;
}) {
  const { t, locale, intlLocale } = usePortalI18n();
  const [message, messageHolder] = antdMessage.useMessage();
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [dingtalkAvailable, setDingtalkAvailable] = useState(false);
  const [editing, setEditing] = useState<ScheduledTask | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const frequency = Form.useWatch("frequency", form);
  const timezone = useMemo(browserTimezone, []);

  const reload = useCallback(async () => {
    try {
      const out = await listScheduledTasks();
      setTasks(out.tasks);
      setDingtalkAvailable(out.dingtalk_available);
    } catch (error) {
      setTasks([]);
      message.error(error instanceof Error ? error.message : t("tasks.loadFailed"));
    }
  }, [message, t]);

  useEffect(() => {
    if (!props.open) return;
    void reload();
  }, [props.open, reload]);

  const startEdit = useCallback(
    (task: ScheduledTask | "new", prefill?: ScheduledTaskPrefill | null) => {
      setEditing(task);
      const base = task === "new" ? null : task;
      form.setFieldsValue({
        title: base?.title ?? prefill?.title ?? "",
        prompt: base?.prompt ?? prefill?.prompt ?? "",
        skill_ids: base?.skill_ids ?? prefill?.skillIds ?? [],
        frequency: base?.frequency ?? "weekdays",
        weekdays: base?.weekdays?.length ? base.weekdays : [1],
        day_of_month: base?.day_of_month ?? 1,
        time: base?.time_of_day ?? "09:00",
        notify_dingtalk: base?.notify_dingtalk ?? true
      });
    },
    [form]
  );

  useEffect(() => {
    if (props.open && props.prefill) startEdit("new", props.prefill);
  }, [props.open, props.prefill, startEdit]);

  const submit = async () => {
    const values = await form.validateFields();
    const payload: ScheduledTaskInput = {
      title: values.title.trim(),
      prompt: values.prompt.trim(),
      skill_ids: values.skill_ids ?? [],
      frequency: values.frequency,
      weekdays: values.frequency === "weekly" ? values.weekdays : [],
      day_of_month: values.frequency === "monthly" ? values.day_of_month : null,
      time_of_day: values.time,
      timezone,
      locale,
      notify_dingtalk: values.notify_dingtalk
    };
    setSaving(true);
    try {
      if (editing === "new") {
        await createScheduledTask({
          ...payload,
          ...props.context.runSnapshot(),
          source_thread_id: props.prefill?.sourceThreadId ?? null
        });
      } else if (editing) {
        await updateScheduledTask(editing.id, payload);
      }
      message.success(t("tasks.saved"));
      setEditing(null);
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (task: ScheduledTask) => {
    try {
      await updateScheduledTask(task.id, { enabled: !task.enabled });
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const runNow = async (task: ScheduledTask) => {
    try {
      await runScheduledTaskNow(task.id);
      message.success(t("tasks.runStarted"));
      setExpanded(task.id);
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (task: ScheduledTask) => {
    try {
      await deleteScheduledTask(task.id);
      message.success(t("tasks.deleted"));
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const weekdayOptions = WEEKDAY_ORDER.map((day) => ({ value: day, label: t(`tasks.weekday.${day}` as never) }));

  return (
    <Drawer
      open={props.open}
      onClose={() => {
        setEditing(null);
        props.onClose();
      }}
      width={560}
      rootClassName="roadmap-drawer"
      title={
        <span className="roadmap-drawer-title">
          <CalendarClock size={18} aria-hidden="true" />
          {editing ? (editing === "new" ? t("tasks.create") : t("tasks.edit")) : t("tasks.title")}
        </span>
      }
      extra={
        !editing ? (
          <Button type="primary" icon={<Plus size={15} />} onClick={() => startEdit("new")}>
            {t("tasks.new")}
          </Button>
        ) : null
      }
      destroyOnHidden
    >
      {messageHolder}
      {editing ? (
        <Form form={form} layout="vertical" requiredMark={false} className="roadmap-form">
          <Form.Item name="title" label={t("tasks.fieldTitle")} rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={120} placeholder={t("tasks.fieldTitlePlaceholder")} />
          </Form.Item>
          <Form.Item name="prompt" label={t("tasks.fieldPrompt")} rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} maxLength={8000} placeholder={t("tasks.fieldPromptPlaceholder")} />
          </Form.Item>
          {props.context.skills.length ? (
            <Form.Item name="skill_ids" label={t("tasks.fieldSkills")}>
              <Select
                mode="multiple"
                allowClear
                maxCount={5}
                optionFilterProp="label"
                placeholder={t("tasks.fieldSkillsPlaceholder")}
                options={props.context.skills.map((skill) => ({ value: skill.id, label: skill.label }))}
              />
            </Form.Item>
          ) : null}
          <div className="roadmap-form-row">
            <Form.Item name="frequency" label={t("tasks.fieldFrequency")}>
              <Select
                options={(["daily", "weekdays", "weekly", "monthly"] as const).map((value) => ({
                  value,
                  label: t(`tasks.freq.${value}`)
                }))}
              />
            </Form.Item>
            <Form.Item
              name="time"
              label={t("tasks.fieldTime")}
              rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }]}
            >
              <Input type="time" step={300} />
            </Form.Item>
          </div>
          {frequency === "weekly" ? (
            <Form.Item name="weekdays" label={t("tasks.fieldWeekdays")} rules={[{ required: true, type: "array", min: 1 }]}>
              <Checkbox.Group options={weekdayOptions} className="roadmap-weekdays" />
            </Form.Item>
          ) : null}
          {frequency === "monthly" ? (
            <Form.Item name="day_of_month" label={t("tasks.fieldDayOfMonth")}>
              <InputNumber min={1} max={31} />
            </Form.Item>
          ) : null}
          <p className="roadmap-muted">{t("tasks.timezoneHint", { timezone })}</p>
          <Form.Item name="notify_dingtalk" valuePropName="checked" label={t("tasks.fieldNotify")} extra={!dingtalkAvailable ? t("tasks.notifyUnavailable") : undefined}>
            <Switch disabled={!dingtalkAvailable} />
          </Form.Item>
          <div className="roadmap-form-actions">
            <Button onClick={() => setEditing(null)}>{t("tasks.cancel")}</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              {t("tasks.save")}
            </Button>
          </div>
        </Form>
      ) : tasks === null ? (
        <Skeleton active />
      ) : tasks.length === 0 ? (
        <Empty
          image={<CalendarClock size={40} strokeWidth={1.4} className="roadmap-empty-icon" />}
          description={
            <span className="roadmap-empty">
              <strong>{t("tasks.empty")}</strong>
              <span>{t("tasks.emptyDetail")}</span>
            </span>
          }
        >
          <Button type="primary" icon={<Plus size={15} />} onClick={() => startEdit("new")}>
            {t("tasks.new")}
          </Button>
        </Empty>
      ) : (
        <>
          <p className="roadmap-muted roadmap-drawer-intro">{t("tasks.subtitle")}</p>
          <ul className="roadmap-card-list">
            {tasks.map((task) => (
              <li key={task.id} className={`roadmap-card${task.enabled ? "" : " is-paused"}`}>
                <div className="roadmap-card-main">
                  <button
                    type="button"
                    className="roadmap-card-toggle"
                    aria-expanded={expanded === task.id}
                    onClick={() => setExpanded((current) => (current === task.id ? null : task.id))}
                  >
                    {expanded === task.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="roadmap-card-body" onClick={() => startEdit(task)} role="button" tabIndex={0}>
                    <strong>{task.title}</strong>
                    <span className="roadmap-card-meta">
                      {describeSchedule(task, t)}
                      {" · "}
                      {task.enabled
                        ? t("tasks.nextRun", { time: formatDateTime(task.next_run_at, intlLocale) })
                        : task.consecutive_failures >= 5
                          ? t("tasks.autoPaused", { count: task.consecutive_failures })
                          : t("tasks.paused")}
                    </span>
                    {task.last_run_status ? (
                      <span className="roadmap-card-meta">
                        {t("tasks.lastRun")} <RunStatusTag status={task.last_run_status} />
                        {formatDateTime(task.last_run_at, intlLocale)}
                      </span>
                    ) : null}
                  </div>
                  <div className="roadmap-card-actions">
                    <Tooltip title={t("tasks.runNow")}>
                      <Button type="text" icon={<Zap size={16} />} aria-label={t("tasks.runNow")} onClick={() => void runNow(task)} />
                    </Tooltip>
                    <Tooltip title={task.enabled ? t("tasks.pause") : t("tasks.resume")}>
                      <Button
                        type="text"
                        icon={task.enabled ? <Pause size={16} /> : <Play size={16} />}
                        aria-label={task.enabled ? t("tasks.pause") : t("tasks.resume")}
                        onClick={() => void toggleEnabled(task)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title={t("tasks.deleteConfirm", { title: task.title })}
                      okText={t("tasks.delete")}
                      cancelText={t("tasks.cancel")}
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void remove(task)}
                    >
                      <Button type="text" danger icon={<Trash2 size={16} />} aria-label={t("tasks.delete")} />
                    </Popconfirm>
                  </div>
                </div>
                {expanded === task.id ? (
                  <div className="roadmap-card-detail">
                    <h4>{t("tasks.history")}</h4>
                    <TaskRuns key={`${task.id}-${task.last_run_at ?? ""}`} taskId={task.id} onOpenThread={props.onOpenThread} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}
