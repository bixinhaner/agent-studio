import type { ReactNode } from "react";
import { Drawer, Tabs } from "antd";

import type { WorkbenchTab } from "./layout-state";

export function RightWorkbenchDrawer(props: {
  open: boolean;
  activeTab: WorkbenchTab;
  onClose(): void;
  onTabChange(tab: WorkbenchTab): void;
  writingContent: ReactNode;
  collaborationContent: ReactNode;
}) {
  return (
    <Drawer
      title="工作台工具"
      placement="right"
      width={420}
      open={props.open}
      onClose={props.onClose}
      destroyOnClose={false}
      forceRender
    >
      <Tabs
        activeKey={props.activeTab}
        onChange={(key) => props.onTabChange(key as WorkbenchTab)}
        items={[
          { key: "writing", label: "写作", forceRender: true, children: props.writingContent },
          { key: "collaboration", label: "协作", forceRender: true, children: props.collaborationContent }
        ]}
      />
    </Drawer>
  );
}
