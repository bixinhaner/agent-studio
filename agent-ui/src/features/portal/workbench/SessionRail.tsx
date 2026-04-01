import type { PropsWithChildren, ReactNode } from "react";
import { Button, Input } from "antd";

export function SessionRail(
  props: PropsWithChildren<{
    collapsed: boolean;
    userName: string;
    footer?: ReactNode;
    newThreadSlot?: ReactNode;
    searchValue: string;
    onSearchChange(value: string): void;
    onCreateThread(): void;
    onToggleCollapsed(): void;
  }>
) {
  return (
    <aside className={props.collapsed ? "session-rail collapsed" : "session-rail"}>
      <div className="session-rail-head">
        <div className="session-rail-title-row">
          {!props.collapsed ? (
            <div className="session-rail-title-copy">
              <p className="session-rail-eyebrow">会话工作区</p>
              <h2>Threads</h2>
            </div>
          ) : null}
          <Button
            type="text"
            className="session-rail-collapse-btn"
            aria-label={props.collapsed ? "展开侧栏" : "收起侧栏"}
            onClick={props.onToggleCollapsed}
          >
            {props.collapsed ? "›" : "‹"}
          </Button>
        </div>
        {!props.collapsed ? (
          <div className="session-rail-controls">
            {props.newThreadSlot ?? (
              <Button aria-label="新会话" type="primary" onClick={props.onCreateThread}>
                新会话
              </Button>
            )}
            <Input
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={props.searchValue}
              onChange={(event) => props.onSearchChange(event.target.value)}
              allowClear
            />
          </div>
        ) : (
          <div className="session-rail-collapsed-label">会话</div>
        )}
      </div>
      {!props.collapsed ? <div className="session-rail-list">{props.children}</div> : null}
      {!props.collapsed ? <div className="session-rail-footer">{props.footer ?? props.userName}</div> : null}
    </aside>
  );
}
