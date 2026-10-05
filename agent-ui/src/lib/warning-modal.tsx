import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Input, Modal, Typography } from "antd";
import type { ModalFuncProps } from "antd";
import type { ReactNode } from "react";

export type DangerLevel = "normal" | "warning" | "danger";

export type WarningConfirmOptions = {
  title: string;
  content: ReactNode;
  description?: ReactNode;
  okText?: string;
  cancelText?: string;
  dangerLevel?: DangerLevel;
  okButtonDanger?: boolean;
  /** When set, the confirm button stays disabled until the admin types this exact text. */
  requireTypedText?: string;
  modalProps?: Omit<ModalFuncProps, "title" | "content" | "onOk" | "onCancel">;
};

function iconColor(level: DangerLevel): string {
  if (level === "danger") return "#d32029";
  if (level === "warning") return "#d48806";
  return "#1677ff";
}

export async function openWarningConfirm(options: WarningConfirmOptions): Promise<boolean> {
  const {
    title,
    content,
    description,
    okText = "确认",
    cancelText = "取消",
    dangerLevel = "danger",
    okButtonDanger,
    requireTypedText,
    modalProps
  } = options;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const danger = okButtonDanger ?? dangerLevel === "danger";
    const expected = requireTypedText?.trim();

    const instance = Modal.confirm({
      icon: <ExclamationCircleOutlined style={{ color: iconColor(dangerLevel) }} />,
      title,
      content: (
        <div>
          <Typography.Paragraph style={{ marginBottom: description || expected ? 6 : 0 }}>{content}</Typography.Paragraph>
          {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
          {expected ? (
            <div style={{ marginTop: 12 }}>
              <Typography.Text>
                请输入 <Typography.Text code>{expected}</Typography.Text> 确认
              </Typography.Text>
              <Input
                autoFocus
                aria-label={`输入 ${expected} 确认`}
                style={{ marginTop: 6 }}
                onChange={(event) =>
                  instance.update({ okButtonProps: { danger, disabled: event.target.value.trim() !== expected } })
                }
              />
            </div>
          ) : null}
        </div>
      ),
      okText,
      cancelText,
      okButtonProps: {
        danger,
        disabled: Boolean(expected)
      },
      centered: true,
      maskClosable: false,
      onOk: () => {
        settled = true;
        resolve(true);
      },
      onCancel: () => {
        if (!settled) resolve(false);
      },
      ...modalProps
    });
  });
}
