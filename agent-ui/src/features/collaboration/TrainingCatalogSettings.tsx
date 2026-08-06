import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Select, Spin, Switch, Tag, Typography, message } from "antd";
import { CheckCircle2, ExternalLink, Save, ShieldCheck } from "lucide-react";

import type { AdminUser } from "../admin/types";
import {
  fetchTrainingCatalogConfiguration,
  fetchTrainingRootFolders,
  saveTrainingCatalogConfiguration
} from "./api";
import type { TrainingCatalogConfiguration, TrainingCatalogRootFolderOption } from "./types";

type TrainingCatalogDraft = Pick<TrainingCatalogConfiguration, "enabled" | "sourceEmail" | "rootFolderName">;

function draftFromConfiguration(configuration: TrainingCatalogConfiguration): TrainingCatalogDraft {
  return {
    enabled: configuration.enabled,
    sourceEmail: configuration.sourceEmail,
    rootFolderName: configuration.rootFolderName
  };
}

export function TrainingCatalogSettings(props: { users: AdminUser[] }) {
  const [configuration, setConfiguration] = useState<TrainingCatalogConfiguration | null>(null);
  const [draft, setDraft] = useState<TrainingCatalogDraft | null>(null);
  const [folders, setFolders] = useState<TrainingCatalogRootFolderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const sourceOptions = useMemo(
    () => props.users
      .filter((user) => (
        user.source.userType !== "external_user" &&
        user.effective.status === "active" &&
        Boolean(user.synced.email?.trim())
      ))
      .map((user) => ({
        value: user.synced.email!.trim(),
        label: user.synced.displayName
          ? `${user.synced.displayName} · ${user.synced.email!.trim()}`
          : user.synced.email!.trim()
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN")),
    [props.users]
  );

  async function loadFolders(sourceEmail: string) {
    if (!sourceEmail.trim()) {
      setFolders([]);
      return;
    }
    setFoldersLoading(true);
    try {
      setFolders(await fetchTrainingRootFolders(sourceEmail));
    } catch (error) {
      setFolders([]);
      message.error(error instanceof Error ? error.message : "读取来源工作区失败");
    } finally {
      setFoldersLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const next = await fetchTrainingCatalogConfiguration();
        if (!active) return;
        setConfiguration(next);
        setDraft(draftFromConfiguration(next));
        await loadFolders(next.sourceEmail);
      } catch (error) {
        if (active) message.error(error instanceof Error ? error.message : "加载培训案例配置失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const dirty = Boolean(configuration && draft && (
    configuration.enabled !== draft.enabled ||
    configuration.sourceEmail !== draft.sourceEmail ||
    configuration.rootFolderName !== draft.rootFolderName
  ));

  async function handleSave() {
    if (!draft) return;
    if (!draft.sourceEmail.trim() || !draft.rootFolderName.trim()) {
      message.error("请选择来源账号和根目录");
      return;
    }
    setSaving(true);
    try {
      const next = await saveTrainingCatalogConfiguration(draft);
      setConfiguration(next);
      setDraft(draftFromConfiguration(next));
      message.success("培训案例配置已保存并生效");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存培训案例配置失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !configuration || !draft) {
    return <div className="training-config-loading"><Spin size="large" /></div>;
  }

  const validationTone = configuration.validationStatus === "valid" ? "success" :
    configuration.validationStatus === "disabled" ? "info" : "error";

  return (
    <section className="training-config-panel" aria-labelledby="training-config-title">
      <div className="training-config-panel-head">
        <div>
          <Typography.Title id="training-config-title" level={4}>培训案例配置</Typography.Title>
          <Typography.Text type="secondary">从指定内部员工工作区实时展示只读培训内容。</Typography.Text>
        </div>
        <Tag color={draft.enabled ? "success" : "default"}>{draft.enabled ? "已启用" : "未启用"}</Tag>
      </div>

      <div className="training-config-row">
        <div className="training-config-label">
          <strong>启用培训案例</strong>
          <span>启用后，内部员工可在工作台帮助菜单中进入只读培训页。</span>
        </div>
        <Switch
          aria-label="启用培训案例"
          checked={draft.enabled}
          onChange={(enabled) => setDraft((current) => current ? { ...current, enabled } : current)}
        />
      </div>

      <div className="training-config-row training-config-form-row">
        <label htmlFor="training-source-account">
          <strong>来源账号（内部员工）</strong>
          <span>培训目录和会话从该员工的当前工作区读取。</span>
        </label>
        <Select
          id="training-source-account"
          showSearch
          optionFilterProp="label"
          value={draft.sourceEmail}
          options={sourceOptions}
          onChange={(sourceEmail) => {
            setDraft((current) => current ? { ...current, sourceEmail, rootFolderName: "" } : current);
            void loadFolders(sourceEmail);
          }}
          placeholder="选择内部员工"
        />
      </div>

      <div className="training-config-row training-config-form-row">
        <label htmlFor="training-root-folder">
          <strong>根目录</strong>
          <span>只展示该目录及其子目录、文件和会话。</span>
        </label>
        <Select
          id="training-root-folder"
          showSearch
          optionFilterProp="label"
          loading={foldersLoading}
          value={draft.rootFolderName || undefined}
          options={folders.map((folder) => ({ label: folder.name, value: folder.name }))}
          onChange={(rootFolderName) => setDraft((current) => current ? { ...current, rootFolderName } : current)}
          placeholder={foldersLoading ? "正在读取工作区…" : "选择根目录"}
          notFoundContent={foldersLoading ? <Spin size="small" /> : "该账号没有可用根目录"}
        />
      </div>

      <div className="training-config-row">
        <div className="training-config-label training-config-visibility">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>仅内部员工</strong>
            <span>外部客户不会看到入口，也无法直接访问培训页面或数据。</span>
          </div>
        </div>
        <Input value="只读" readOnly aria-label="培训案例访问模式" />
      </div>

      <div className="training-config-row training-config-validation-row">
        <div className="training-config-label"><strong>验证状态</strong></div>
        <Alert
          type={validationTone}
          showIcon
          icon={configuration.validationStatus === "valid" ? <CheckCircle2 size={18} /> : undefined}
          message={configuration.validationStatus === "valid" ? "配置有效" : configuration.validationStatus === "disabled" ? "当前未启用" : "配置需要修正"}
          description={configuration.validationStatus === "valid"
            ? `${configuration.folderCount} 个目录 · ${configuration.threadCount} 个会话 · 内容实时同步`
            : configuration.validationMessage}
        />
      </div>

      <div className="training-config-actions">
        <span aria-live="polite">{dirty ? "有尚未保存的修改" : "当前配置已保存"}</span>
        <Button
          icon={<ExternalLink size={15} />}
          disabled={!configuration.enabled || configuration.validationStatus !== "valid"}
          onClick={() => window.open("/training", "_blank", "noopener,noreferrer")}
        >
          预览培训页
        </Button>
        <Button type="primary" icon={<Save size={15} />} loading={saving} disabled={!dirty} onClick={() => void handleSave()}>
          保存配置
        </Button>
      </div>
    </section>
  );
}
