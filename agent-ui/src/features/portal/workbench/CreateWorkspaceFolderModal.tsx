import { useEffect, useState } from "react";
import { Input, Modal } from "antd";
import { FolderPlus } from "lucide-react";

import { usePortalI18n } from "../i18n";

export function CreateWorkspaceFolderModal(props: {
  open: boolean;
  parentName?: string;
  onCancel(): void;
  onCreate(name: string): Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setName("");
    setErrorText("");
    setSaving(false);
  }, [props.open]);

  const submit = async () => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setErrorText(t("workspace.folderNameRequired"));
      return;
    }
    setSaving(true);
    setErrorText("");
    try {
      await props.onCreate(normalizedName);
      props.onCancel();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.createFolderFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      title={(
        <span className="workspace-create-folder-title">
          <FolderPlus size={18} aria-hidden="true" />
          {t("workspace.createFolderTitle")}
        </span>
      )}
      okText={t("workspace.createFolder")}
      cancelText={t("common.cancel")}
      confirmLoading={saving}
      okButtonProps={{ disabled: !name.trim() }}
      onOk={() => void submit()}
      onCancel={saving ? undefined : props.onCancel}
      destroyOnHidden
    >
      <p className="workspace-create-folder-help">
        {props.parentName
          ? t("workspace.createFolderInParent", { parent: props.parentName })
          : t("workspace.createFolderInRoot")}
      </p>
      <label className="field">
        <span className="field-label">{t("workspace.folderNameLabel")}</span>
        <Input
          autoFocus
          aria-label={t("workspace.folderNameLabel")}
          value={name}
          maxLength={120}
          showCount
          placeholder={t("workspace.folderNamePlaceholder")}
          disabled={saving}
          status={errorText ? "error" : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (errorText) setErrorText("");
          }}
          onPressEnter={() => {
            if (!saving && name.trim()) void submit();
          }}
        />
      </label>
      {errorText ? <p className="workspace-create-folder-error" role="alert">{errorText}</p> : null}
    </Modal>
  );
}
