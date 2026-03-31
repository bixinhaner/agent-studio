import type { PropsWithChildren } from "react";
import { Button, Input } from "antd";

export function SessionRail(
  props: PropsWithChildren<{
    collapsed: boolean;
    userName: string;
    searchValue: string;
    onSearchChange(value: string): void;
    onCreateThread(): void;
    onToggleCollapsed(): void;
  }>
) {
  return (
    <aside className={props.collapsed ? "session-rail collapsed" : "session-rail"}>
      <div className="session-rail-head">
        <Button onClick={props.onToggleCollapsed}>{props.collapsed ? "展开" : "收起"}</Button>
        {!props.collapsed ? (
          <>
            <Button aria-label="新会话" type="primary" onClick={props.onCreateThread}>
              新会话
            </Button>
            <Input
              placeholder="搜索会话"
              value={props.searchValue}
              onChange={(event) => props.onSearchChange(event.target.value)}
            />
          </>
        ) : null}
      </div>
      {!props.collapsed ? <div className="session-rail-list">{props.children}</div> : null}
      {!props.collapsed ? <div className="session-rail-footer">{props.userName}</div> : null}
    </aside>
  );
}

