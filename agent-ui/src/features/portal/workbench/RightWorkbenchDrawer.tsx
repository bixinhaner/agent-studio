import type { ReactNode } from "react";
import { Button, Tabs } from "antd";
import { XIcon } from "lucide-react";

import type { WorkbenchTab } from "./layout-state";

export function RightWorkbenchDrawer(props: {
  open: boolean;
  activeTab: WorkbenchTab;
  onClose(): void;
  onTabChange(tab: WorkbenchTab): void;
  previewContent: ReactNode;
  collaborationContent: ReactNode;
  mobile?: boolean;
}) {
  if (!props.open) return null;

  return (
    <div className={props.mobile ? "right-workbench-shell mobile" : "right-workbench-shell"}>
      <div className="right-workbench-header">
        <div className="right-workbench-header-copy">
          <p className="right-workbench-header-eyebrow">Workbench</p>
          <h3>{props.activeTab === "preview" ? "Preview" : "Collaboration"}</h3>
        </div>
        <Button
          type="text"
          className="right-workbench-close-btn"
          icon={<XIcon size={18} />}
          onClick={props.onClose}
          aria-label="Close right panel"
        />
      </div>
      <Tabs
        activeKey={props.activeTab}
        onChange={(tab) => props.onTabChange(tab as WorkbenchTab)}
        className="right-workbench-tabs"
        items={[
          { key: "preview", label: "Preview", forceRender: true, children: props.previewContent },
          { key: "collaboration", label: "Collaboration", forceRender: true, children: props.collaborationContent }
        ]}
      />
    </div>
  );
}
