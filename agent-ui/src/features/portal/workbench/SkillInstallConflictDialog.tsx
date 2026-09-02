import type { FC } from "react";
import { Modal } from "antd";
import { Copy, Share2 } from "lucide-react";

import { ApiError } from "../../../lib/api";
import type { ManagedSkillInstallConflict } from "../../skills/api";
import { usePortalI18n } from "../i18n";

type SkillInstallConflictDialogProps = {
  open: boolean;
  conflict?: ManagedSkillInstallConflict;
  loading: boolean;
  errorText?: string;
  onKeepShared: () => void;
  onCreateCopy: () => void;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function managedSkillInstallConflictFromError(error: unknown): ManagedSkillInstallConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== "SKILL_NAME_SHARED_CONFLICT") {
    return undefined;
  }
  const conflict = record(record(error.payload)?.conflict);
  const skillId = typeof conflict?.skillId === "string" ? conflict.skillId.trim() : "";
  const skillName = typeof conflict?.skillName === "string" ? conflict.skillName.trim() : "";
  const ownerUserId = typeof conflict?.ownerUserId === "string" ? conflict.ownerUserId.trim() : "";
  const suggestedName = typeof conflict?.suggestedName === "string" ? conflict.suggestedName.trim() : "";
  if (!skillId || !skillName || !ownerUserId || !suggestedName) return undefined;
  return {
    skillId,
    skillName,
    ownerUserId,
    suggestedName,
    ...(typeof conflict?.ownerDisplayName === "string" && conflict.ownerDisplayName.trim()
      ? { ownerDisplayName: conflict.ownerDisplayName.trim() }
      : {}),
    ...(typeof conflict?.ownerEmail === "string" && conflict.ownerEmail.trim()
      ? { ownerEmail: conflict.ownerEmail.trim() }
      : {})
  };
}

export const SkillInstallConflictDialog: FC<SkillInstallConflictDialogProps> = ({
  open,
  conflict,
  loading,
  errorText,
  onKeepShared,
  onCreateCopy
}) => {
  const { t } = usePortalI18n();
  const owner = conflict?.ownerDisplayName || conflict?.ownerEmail || conflict?.ownerUserId || "—";
  return (
    <Modal
      open={open}
      centered
      width={520}
      title={t("skill.sharedConflictTitle")}
      okText={t("skill.sharedConflictFork")}
      cancelText={t("skill.sharedConflictKeep")}
      confirmLoading={loading}
      onOk={onCreateCopy}
      onCancel={onKeepShared}
      closable={!loading}
      maskClosable={!loading}
      keyboard={!loading}
      rootClassName="portal-skill-conflict-modal"
      destroyOnHidden={false}
    >
      {conflict ? (
        <div className="portal-skill-conflict-content">
          <div className="portal-skill-conflict-icon" aria-hidden="true">
            <Share2 size={22} />
          </div>
          <p>{t("skill.sharedConflictBody", { owner, name: conflict.skillName })}</p>
          <div className="portal-skill-conflict-copy">
            <Copy size={17} aria-hidden="true" />
            <span>{t("skill.sharedConflictCopyHelp", { suggestedName: conflict.suggestedName })}</span>
          </div>
          <div className="portal-skill-conflict-names" aria-label={`${conflict.skillName} → ${conflict.suggestedName}`}>
            <code>{conflict.skillName}</code>
            <span aria-hidden="true">→</span>
            <code>{conflict.suggestedName}</code>
          </div>
          {errorText ? <p className="portal-skill-conflict-error" role="alert">{errorText}</p> : null}
        </div>
      ) : null}
    </Modal>
  );
};
