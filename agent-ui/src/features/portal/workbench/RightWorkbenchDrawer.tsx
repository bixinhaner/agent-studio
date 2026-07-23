import type { ReactNode } from "react";
import { Button } from "antd";
import { XIcon } from "lucide-react";
import { usePortalI18n } from "../i18n";

export function RightWorkbenchDrawer(props: {
  open: boolean;
  onClose(): void;
  previewContent: ReactNode;
  mobile?: boolean;
}) {
  const { t } = usePortalI18n();
  if (!props.open) return null;

  return (
    <div className={props.mobile ? "right-workbench-shell mobile" : "right-workbench-shell"}>
      {props.mobile ? (
        <Button
          type="text"
          className="right-workbench-close-btn mobile"
          icon={<XIcon size={18} />}
          onClick={props.onClose}
          aria-label={t("topbar.closePanel")}
        />
      ) : null}
      <div className="right-workbench-content">{props.previewContent}</div>
    </div>
  );
}
