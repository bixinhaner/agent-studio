import { InlineFileChip } from "./InlineAttachmentComposer";
import { InlineSkillChip } from "./InlineSkillChip";
import { parseInlineReferences, splitLeadingReferences, type InlineReference } from "./inline-references";
import type { InlineAttachment } from "./inline-attachments";

export function InlineMessageReferences({ text, attachments, onPreview }: {
  text: string;
  attachments: readonly InlineAttachment[];
  onPreview?(attachment: InlineAttachment): void;
}) {
  const { leading, rest } = splitLeadingReferences(parseInlineReferences(text));
  const render = (part: InlineReference, key: string) =>
    part.type === "text" ? <span key={key}>{part.text}</span> :
      part.type === "skill" ? <InlineSkillChip key={key} id={part.id} name={part.name} readOnly /> :
      <InlineFileChip key={key} id={part.id} name={part.name} attachment={attachments.find(item => item.id === part.id)} onPreview={onPreview} readOnly />;
  return <span className="portal-inline-message-text">
    {leading.length > 0 ? <span className="portal-inline-message-refs">{leading.map((part, index) => render(part, `lead-${index}`))}</span> : null}
    {rest.map((part, index) => render(part, `part-${index}`))}
  </span>;
}
