import { formatAdminDateTime } from "../../lib/formatters";
import type { AdminConversationSendFailure } from "./types";

const STAGE_COPY: Record<string, { label: string; reason: string }> = {
  attachment_upload: {
    label: "附件上传失败",
    reason: "用户选择的文件没有上传成功，portal 提示用户重试或移除文件。"
  },
  attachment_not_ready: {
    label: "附件未就绪，发送被拦下",
    reason: "用户点击发送时仍有附件没有上传完成，消息没有发出，输入内容保留在输入框。"
  },
  composer_send: {
    label: "发送时附件处理失败",
    reason: "发送过程中附件没有准备好，消息没有发出；portal 已把文字和附件放回输入框。"
  },
  run_blocked: {
    label: "发送被拦截",
    reason: "浏览器端在保存消息前拦下了这次发送（例如运行环境未就绪、没有可用的智能体或没有识别到文字）。"
  },
  thread_resolve: {
    label: "未能确定当前任务",
    reason: "浏览器没能拿到这个任务在服务器上的 ID，消息没有保存。"
  },
  thread_create: {
    label: "创建任务失败",
    reason: "服务器没能创建这个任务，消息没有保存。"
  },
  message_save: {
    label: "保存用户消息失败",
    reason: "用户消息没有保存到服务器，portal 把文字放回输入框并提示错误。"
  },
  session_start: {
    label: "启动会话失败",
    reason: "用户消息已保存，但会话没有启动成功。"
  }
};

export function sendFailureStageCopy(stage: string): { label: string; reason: string } {
  return STAGE_COPY[stage] ?? { label: "发送失败", reason: `未归类的发送失败（${stage}）。` };
}

function attachmentSummary(failure: AdminConversationSendFailure): string {
  return failure.attachments
    .map((item) => [item.name, item.failureCode || item.status].filter(Boolean).join(" · "))
    .join("，");
}

export function ConversationSendFailures(props: { failures: AdminConversationSendFailure[] }) {
  if (props.failures.length === 0) return null;
  return (
    <section className="admin-send-failures" aria-label="发送失败记录">
      <div className="admin-send-failures-title">发送失败记录（{props.failures.length}）</div>
      {props.failures.map((failure) => {
        const copy = sendFailureStageCopy(failure.stage);
        const codes = [failure.errorCode, failure.httpStatus ? `HTTP ${failure.httpStatus}` : null].filter(Boolean).join(" · ");
        const attachments = attachmentSummary(failure);
        const raw = [
          failure.detail,
          failure.clientRunId ? `run: ${failure.clientRunId}` : null,
          failure.buildId ? `build: ${failure.buildId}` : null,
          failure.userAgent ? `UA: ${failure.userAgent}` : null
        ].filter(Boolean).join("\n");
        return (
          <section key={failure.id} className="admin-turn-outcome is-send-failure">
            <div className="admin-turn-outcome-head">
              <span className="admin-turn-outcome-label">{copy.label}</span>
              {codes ? <code className="admin-turn-outcome-code">{codes}</code> : null}
              <span className="admin-turn-outcome-tag">{failure.source === "client" ? "浏览器上报" : "服务器记录"}</span>
              <span className="admin-send-failure-time">{formatAdminDateTime(failure.createdAt, { seconds: true })}</span>
            </div>
            <p className="admin-turn-outcome-reason">{copy.reason}</p>
            {failure.messagePreview ? (
              <p className="admin-send-failure-field"><span>未发出的内容</span>{failure.messagePreview}</p>
            ) : null}
            {attachments ? (
              <p className="admin-send-failure-field"><span>附件</span>{attachments}</p>
            ) : null}
            {raw ? (
              <details className="admin-turn-outcome-raw">
                <summary>原始信息</summary>
                <pre>{raw}</pre>
              </details>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}
