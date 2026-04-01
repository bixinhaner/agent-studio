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
      title="工具台"
      placement="right"
      width="min(420px, calc(100vw - 16px))"
      open={props.open}
      onClose={props.onClose}
      destroyOnClose={false}
      forceRender
      rootClassName="workbench-right-drawer"
    >
      <Tabs
        activeKey={props.activeTab}
        onChange={(key) => props.onTabChange(key as WorkbenchTab)}
        items={[
          { key: "writing", label: "文档工坊", forceRender: true, children: props.writingContent },
          { key: "collaboration", label: "协作面板", forceRender: true, children: props.collaborationContent }
        ]}
      />
    </Drawer>
  );
}
