import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Modal, Typography } from "antd";
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
    modalProps
  } = options;

  return new Promise<boolean>((resolve) => {
    let settled = false;

    Modal.confirm({
      icon: <ExclamationCircleOutlined style={{ color: iconColor(dangerLevel) }} />,
      title,
      content: (
        <div>
          <Typography.Paragraph style={{ marginBottom: description ? 6 : 0 }}>{content}</Typography.Paragraph>
          {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
        </div>
      ),
      okText,
      cancelText,
      okButtonProps: {
        danger: okButtonDanger ?? dangerLevel === "danger"
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
