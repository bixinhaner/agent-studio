import type { ReactNode } from "react";
import { Button } from "antd";
import { XIcon } from "lucide-react";

export function RightWorkbenchDrawer(props: {
  open: boolean;
  onClose(): void;
  previewContent: ReactNode;
  mobile?: boolean;
}) {
  if (!props.open) return null;

  return (
    <div className={props.mobile ? "right-workbench-shell mobile" : "right-workbench-shell"}>
      {props.mobile ? (
        <Button
          type="text"
          className="right-workbench-close-btn mobile"
          icon={<XIcon size={18} />}
          onClick={props.onClose}
          aria-label="Close right panel"
        />
      ) : null}
      <div className="right-workbench-content">{props.previewContent}</div>
    </div>
  );
}
