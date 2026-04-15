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
        activeKey="preview"
        items={[
          { key: "preview", label: "Preview", forceRender: true, children: props.previewContent }
        ]}
      />
    </div>
  );
}
