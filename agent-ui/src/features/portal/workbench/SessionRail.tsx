import type { PropsWithChildren, ReactNode } from "react";
import { Button, Input, Tooltip } from "antd";
import { Plus, Search, MessageSquare } from "lucide-react";
import { usePortalI18n } from "../i18n";

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
  const { t } = usePortalI18n();
  return (
    <aside className={props.collapsed ? "session-rail collapsed" : "session-rail"} style={{ width: '100%', borderRight: 'none' }}>
      <div className="session-rail-head">
        {!props.collapsed ? (
          <div className="session-rail-controls">
            {props.newThreadSlot ?? (
              <Button className="session-rail-new-btn" aria-label={t("sessions.new")} type="primary" icon={<Plus size={16} />} onClick={props.onCreateThread} style={{ width: '100%', borderRadius: 6 }}>
                {t("sessions.new")}
              </Button>
            )}
            <Input
              className="session-rail-search-input"
              aria-label={t("sessions.search")}
              placeholder={t("sessions.searchPlaceholder")}
              prefix={<Search size={14} style={{ color: '#9ca3af' }} />}
              value={props.searchValue}
              onChange={(event) => props.onSearchChange(event.target.value)}
              allowClear
            />
          </div>
        ) : (
          <Tooltip title={t("sessions.new")} placement="right">
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
