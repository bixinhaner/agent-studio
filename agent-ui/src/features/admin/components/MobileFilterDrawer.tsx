import { FilterOutlined } from "@ant-design/icons";
import { Badge, Button, Drawer, Space } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";

type MobileFilterDrawerProps = {
  title: string;
  filterCount?: number;
  children: ReactNode;
};

export function MobileFilterDrawer({ title, filterCount = 0, children }: MobileFilterDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Badge count={filterCount} size="small">
        <Button icon={<FilterOutlined />} onClick={() => setOpen(true)}>
          筛选
        </Button>
      </Badge>
      <Drawer
        title={title}
        placement="right"
        width="86%"
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
        footer={(
          <Space>
            <Button type="primary" onClick={() => setOpen(false)}>
              应用筛选
            </Button>
          </Space>
        )}
      >
        {children}
      </Drawer>
    </>
  );
}
