import type { PropsWithChildren, ReactNode } from "react";
import { Button, Input, Tooltip } from "antd";
import { Plus, Search, MessageSquare } from "lucide-react";

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
    <aside className={props.collapsed ? "session-rail collapsed" : "session-rail"} style={{ width: '100%', borderRight: 'none' }}>
      <div className="session-rail-head">
        {!props.collapsed ? (
          <div className="session-rail-controls">
            {props.newThreadSlot ?? (
              <Button className="session-rail-new-btn" aria-label="New session" type="primary" icon={<Plus size={16} />} onClick={props.onCreateThread} style={{ width: '100%', borderRadius: 6 }}>
                New session
              </Button>
            )}
            <Input
              aria-label="Search sessions"
              placeholder="Search sessions..."
              prefix={<Search size={14} style={{ color: '#9ca3af' }} />}
              value={props.searchValue}
              onChange={(event) => props.onSearchChange(event.target.value)}
              allowClear
              style={{ borderRadius: 6, backgroundColor: '#ffffff', borderColor: '#e2e8f0' }}
            />
          </div>
        ) : (
          <Tooltip title="New session" placement="right">
            <Button
              className="session-rail-new-btn"
              type="primary"
              icon={<Plus size={16} />}
              onClick={props.onCreateThread}
              style={{ width: 40, height: 40, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            />
          </Tooltip>
        )}
      </div>
      
      {!props.collapsed ? (
        <div className="session-rail-list">{props.children}</div>
      ) : (
        <div className="session-rail-list" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <MessageSquare size={20} color="#9ca3af" />
        </div>
      )}
      
      {!props.collapsed ? (
        <div className="session-rail-footer">{props.footer ?? props.userName}</div>
      ) : null}
    </aside>
  );
}
