import type { ReactNode } from "react";
import { Tabs } from "antd";

import type { WorkbenchTab } from "./layout-state";

export function RightWorkbenchDrawer(props: {
  open: boolean;
  activeTab: WorkbenchTab;
  onClose(): void;
  onTabChange(tab: WorkbenchTab): void;
  previewContent: ReactNode;
  collaborationContent: ReactNode;
}) {
  if (!props.open) return null;

  return (
    <div style={{ padding: '16px', height: '100%', overflowY: 'auto' }}>
      <Tabs
        activeKey={props.activeTab}
        onChange={(key) => props.onTabChange(key as WorkbenchTab)}
        items={[
          { key: "preview", label: "预览", forceRender: true, children: props.previewContent },
          { key: "collaboration", label: "协作面板", forceRender: true, children: props.collaborationContent }
        ]}
      />
    </div>
  );
}
