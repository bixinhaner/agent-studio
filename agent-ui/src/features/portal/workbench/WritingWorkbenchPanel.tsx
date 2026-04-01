import { Button, Card, Collapse, Space, Typography } from "antd";

export function WritingWorkbenchPanel(props: { onUsePrompt(prompt: string): void }) {
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Card size="small" title="结构化产出">
        <Typography.Paragraph className="workbench-card-desc">
          把当前会话整理为可落地的行动清单，减少遗漏。
        </Typography.Paragraph>
        <Button block onClick={() => props.onUsePrompt("请按固定结构输出：背景、结论、行动项、负责人、截止时间。")}>
          生成结构化结果
        </Button>
      </Card>

      <Card size="small" title="会话生成文档">
        <Typography.Paragraph className="workbench-card-desc">
          按正式文档结构输出，适合直接进入评审流程。
        </Typography.Paragraph>
        <Button block onClick={() => props.onUsePrompt("请基于当前会话整理一份可直接评审的正式文档。")}>
          生成会话文档
        </Button>
      </Card>

      <Collapse
        items={[
          {
            key: "more-writing-tools",
            label: "更多写作工具",
            children: <div className="workbench-collapse-note">保留现有写作工具入口（润色、扩写、缩写、翻译等）</div>
          }
        ]}
      />
    </Space>
  );
}
