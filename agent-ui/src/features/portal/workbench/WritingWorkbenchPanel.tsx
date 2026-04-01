import { Button, Card, Collapse, Space, Typography } from "antd";

const WRITING_TEMPLATES: Array<{ title: string; desc: string; prompt: string }> = [
  {
    title: "执行方案",
    desc: "输出可落地的项目执行方案，适合直接进入评审。",
    prompt: "请输出执行方案文档，结构为：目标、范围、里程碑、角色分工、风险与应对、验收标准。"
  },
  {
    title: "会议纪要",
    desc: "把当前上下文整理成标准会议纪要并附行动项。",
    prompt: "请生成会议纪要，包含：背景、核心结论、行动项、负责人、截止时间、跟进机制。"
  },
  {
    title: "复盘报告",
    desc: "聚焦过程问题和改进路径，形成可复用经验。",
    prompt: "请生成复盘报告，包含：目标达成、关键决策、问题清单、根因分析、改进计划。"
  }
];

export function WritingWorkbenchPanel(props: { onUsePrompt(prompt: string): void }) {
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {WRITING_TEMPLATES.map((template) => (
        <Card key={template.title} size="small" title={template.title}>
          <Typography.Paragraph className="workbench-card-desc">{template.desc}</Typography.Paragraph>
          <Button block onClick={() => props.onUsePrompt(template.prompt)}>
            使用模板
          </Button>
        </Card>
      ))}

      <Collapse
        items={[
          {
            key: "more-writing-tools",
            label: "更多写作工具",
            children: (
              <div className="workbench-collapse-note">
                继续补充：润色、改写、技术方案对比、邮件草稿、公告草稿等常用模板。
              </div>
            )
          }
        ]}
      />
    </Space>
  );
}
