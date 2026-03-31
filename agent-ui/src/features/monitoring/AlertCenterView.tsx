import { useEffect, useState } from "react";
import { Alert, Button, Card, Spin, Tag, Typography } from "antd";

import { acknowledgeAlertEvent, fetchAlertEvents, fetchNotificationRecords } from "./api";
import type { AlertEventRecord, NotificationRecord } from "./types";
import { formatLocalDateTime } from "./types";

export function AlertCenterView() {
  const [alertEvents, setAlertEvents] = useState<AlertEventRecord[]>([]);
  const [notificationRecords, setNotificationRecords] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  async function load() {
    const [nextAlerts, nextNotifications] = await Promise.all([fetchAlertEvents(), fetchNotificationRecords()]);
    setAlertEvents(nextAlerts.alertEvents);
    setNotificationRecords(nextNotifications.notificationRecords);
  }

  useEffect(() => {
    let active = true;
    async function run() {
      setLoading(true);
      setErrorText("");
      try {
        await load();
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载告警中心失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, []);

  async function handleAcknowledge(eventId: string) {
    try {
      await acknowledgeAlertEvent(eventId);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "确认告警失败");
    }
  }

  return (
    <Card className="admin-card monitoring-card antd-admin-card">
      <div className="monitoring-heading">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            告警中心
          </Typography.Title>
          <Typography.Paragraph>查看开放告警、确认状态和通知投递结果。</Typography.Paragraph>
        </div>
      </div>
      {loading ? <Spin size="small" /> : null}
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      <div className="monitoring-subgrid">
        <Card size="small" className="monitoring-subcard">
          <Typography.Title level={5} className="admin-card-subheading">
            告警事件
          </Typography.Title>
          <div className="monitoring-table-wrap">
            <table className="monitoring-table">
              <thead>
                <tr>
                  <th>级别</th>
                  <th>状态</th>
                  <th>标题</th>
                  <th>作用域</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {alertEvents.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Tag color={event.severity === "critical" ? "error" : "warning"}>{event.severity}</Tag>
                    </td>
                    <td>
                      <Tag color={event.status === "open" ? "processing" : "success"}>{event.status}</Tag>
                    </td>
                    <td>{event.title}</td>
                    <td>
                      {event.scopeType} / {event.scopeId}
                    </td>
                    <td>{formatLocalDateTime(event.createdAt)}</td>
                    <td>
                      {event.status === "open" ? (
                        <Button
                          type="link"
                          className="monitoring-link-btn"
                          aria-label="确认"
                          onClick={() => void handleAcknowledge(event.id)}
                        >
                          确认
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card size="small" className="monitoring-subcard">
          <Typography.Title level={5} className="admin-card-subheading">
            通知投递
          </Typography.Title>
          <div className="monitoring-table-wrap">
            <table className="monitoring-table">
              <thead>
                <tr>
                  <th>渠道</th>
                  <th>目标</th>
                  <th>事件</th>
                  <th>状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {notificationRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.channelType}</td>
                    <td>{record.targetRef}</td>
                    <td>{record.eventType}</td>
                    <td>
                      <Tag color={record.status === "sent" ? "success" : "default"}>{record.status}</Tag>
                    </td>
                    <td>{formatLocalDateTime(record.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Card>
  );
}
