import { Button, Space, Tag } from "antd";

export function PortalTopBar(props: {
  onToggleRail(): void;
  onOpenAdvancedSettings(): void;
  onOpenDrawer(): void;
  modelTag?: string;
  modeTag?: string;
}) {
  return (
    <header className="portal-topbar" aria-label="工作台顶栏">
      <Space>
        <Button type="text" aria-label="展开会话栏" onClick={props.onToggleRail}>
          会话
        </Button>
        <Button aria-label="高级设置" onClick={props.onOpenAdvancedSettings}>
          高级设置
        </Button>
      </Space>
      <Space>
        {props.modelTag ? <Tag>{props.modelTag}</Tag> : null}
        {props.modeTag ? <Tag>{props.modeTag}</Tag> : null}
        <Button type="primary" aria-label="打开工作台抽屉" onClick={props.onOpenDrawer}>
          写作 / 协作
        </Button>
      </Space>
    </header>
  );
}

