import { useEffect, useState } from "react";

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
    <section className="admin-card monitoring-card">
      <div className="monitoring-heading">
        <div>
          <h2>告警中心</h2>
          <p>查看开放告警、确认状态和通知投递结果。</p>
        </div>
      </div>
      {loading ? <p>加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      <div className="monitoring-subgrid">
        <section className="monitoring-subcard">
          <h3>告警事件</h3>
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
                    <td>{event.severity}</td>
                    <td>{event.status}</td>
                    <td>{event.title}</td>
                    <td>
                      {event.scopeType} / {event.scopeId}
                    </td>
                    <td>{formatLocalDateTime(event.createdAt)}</td>
                    <td>
                      {event.status === "open" ? (
                        <button type="button" className="monitoring-link-btn" onClick={() => void handleAcknowledge(event.id)}>
                          确认
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="monitoring-subcard">
          <h3>通知投递</h3>
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
                    <td>{record.status}</td>
                    <td>{formatLocalDateTime(record.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
