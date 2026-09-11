import { InlineFileChip } from "./InlineAttachmentComposer";
import { InlineSkillChip } from "./InlineSkillChip";
import { parseInlineReferences } from "./inline-references";
import type { InlineAttachment } from "./inline-attachments";

export function InlineMessageReferences({ text, attachments, onPreview }: {
  text: string;
  attachments: readonly InlineAttachment[];
  onPreview?(attachment: InlineAttachment): void;
}) {
  return <span className="portal-inline-message-text">{parseInlineReferences(text).map((part, index) =>
    part.type === "text" ? <span key={index}>{part.text}</span> :
      part.type === "skill" ? <InlineSkillChip key={index} id={part.id} name={part.name} readOnly /> :
      <InlineFileChip key={index} id={part.id} name={part.name} attachment={attachments.find(item => item.id === part.id)} onPreview={onPreview} readOnly />
  )}</span>;
}
