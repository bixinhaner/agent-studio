import { useMemo, useState } from "react";
import { Alert, Button, Checkbox, Drawer, Input, Segmented, Spin, Tag, message } from "antd";
import { BookOpen, Check, Code2, Copy, FileCode2, PackageOpen, Plus, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { fetchCodexSkillContent } from "./api";
import type { SkillPackageRecord, SkillPackageRuntimeBindingRecord } from "./types";

type Props = {
  skillPackages: SkillPackageRecord[];
  selectedIds: string[];
  agentVisibleToUsers: boolean;
  onChange(ids: string[]): void;
};

type CodexSkillView = {
  key: string;
  name: string;
  description?: string;
  activationPrompt?: string;
  managedSkillId?: string;
  binding: SkillPackageRuntimeBindingRecord;
};

type SkillContentView = "preview" | "source";

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function codexSkillsFromPackage(skillPackage: SkillPackageRecord): CodexSkillView[] {
  const skills: CodexSkillView[] = [];
  for (const item of skillPackage.items) {
    for (const binding of item.runtimeBindings) {
      if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") continue;
      const payload = payloadRecord(binding.bindingPayload);
      const name = textValue(payload.skillName) ?? textValue(payload.name);
      if (!name) continue;
      const managedSkillId = textValue(payload.managedSkillId);
      const key = managedSkillId ? `managed:${managedSkillId}` : `native:${name}`;
      if (skills.some((skill) => skill.key === key)) continue;
      skills.push({
        key,
        name,
        description: item.description,
        activationPrompt: textValue(payload.activationPrompt) ?? textValue(payload.defaultPrompt) ?? textValue(payload.prompt),
        managedSkillId,
        binding
      });
    }
  }
  return skills;
}

function markdownBody(content: string): string {
  if (!content.startsWith("---")) return content;
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}

export function isSkillPackageSelectable(skillPackage: SkillPackageRecord, agentVisibleToUsers: boolean): boolean {
  return skillPackage.status === "active" && (!agentVisibleToUsers || skillPackage.visibleToUsers);
}

export function AgentSkillsPanel({ skillPackages, selectedIds, agentVisibleToUsers, onChange }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [contentSkill, setContentSkill] = useState<CodexSkillView | null>(null);
  const [skillContent, setSkillContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");
  const [contentView, setContentView] = useState<SkillContentView>("preview");

  const enabledPackages = useMemo(() => skillPackages.filter((skillPackage) => selectedIds.includes(skillPackage.id)), [selectedIds, skillPackages]);
  const detailPackage = useMemo(() => skillPackages.find((skillPackage) => skillPackage.id === detailId) ?? null, [detailId, skillPackages]);
  const detailSkills = useMemo(() => detailPackage ? codexSkillsFromPackage(detailPackage) : [], [detailPackage]);
  const enabledSkillCount = enabledPackages.reduce((sum, skillPackage) => sum + codexSkillsFromPackage(skillPackage).length, 0);
  const availablePackages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return skillPackages.filter((skillPackage) => {
      if (selectedIds.includes(skillPackage.id)) return false;
      if (!isSkillPackageSelectable(skillPackage, agentVisibleToUsers)) return false;
      const skills = codexSkillsFromPackage(skillPackage);
      return !normalizedQuery || [skillPackage.name, skillPackage.slug, skillPackage.description, ...skills.map((skill) => skill.name)]
        .some((value) => (value ?? "").toLowerCase().includes(normalizedQuery));
    });
  }, [agentVisibleToUsers, query, selectedIds, skillPackages]);
  const stagedPackages = skillPackages.filter((skillPackage) => draftIds.includes(skillPackage.id));
  const stagedSkillCount = stagedPackages.reduce((sum, skillPackage) => sum + codexSkillsFromPackage(skillPackage).length, 0);

  function openAddDrawer() {
    setDraftIds([]);
    setQuery("");
    setAddOpen(true);
  }

  function toggleDraft(skillPackageId: string) {
    setDraftIds((ids) => ids.includes(skillPackageId) ? ids.filter((id) => id !== skillPackageId) : [...ids, skillPackageId]);
  }

  function applyDraft() {
    if (!draftIds.length) return;
    onChange([...selectedIds, ...draftIds.filter((id) => !selectedIds.includes(id))]);
    setDraftIds([]);
    setAddOpen(false);
  }

  async function openSkillContent(skill: CodexSkillView) {
    setContentSkill(skill);
    setSkillContent("");
    setContentError("");
    setContentView("preview");
    setContentLoading(true);
    try {
      const response = await fetchCodexSkillContent({ name: skill.name, managedSkillId: skill.managedSkillId });
      setSkillContent(response.content);
    } catch (error) {
      setContentError(error instanceof Error ? error.message : "读取 SKILL.md 失败");
    } finally {
      setContentLoading(false);
    }
  }

  async function copySkillContent() {
    if (!skillContent) return;
    await navigator.clipboard.writeText(skillContent);
    void message.success("SKILL.md 已复制");
  }

  return (
    <>
      <section className="reference-summary-strip skill-summary-strip">
        <span className="skill-summary-icon"><PackageOpen /></span>
        <span className="skill-summary-metric"><strong>{enabledPackages.length}</strong><small>技能包</small></span>
        <i />
        <span className="skill-summary-metric"><strong>{enabledSkillCount}</strong><small>可运行技能</small></span>
        <span className="summary-ok"><Check size={15} />保存后将在新会话中加载</span>
      </section>

      <section className="reference-section">
        <div className="reference-section-title">
          <div><h3>已启用技能包</h3><p>每个技能包包含一组可运行技能；保存后对新会话生效。</p></div>
          <Button icon={<Plus size={15} />} onClick={openAddDrawer}>添加技能包</Button>
        </div>
        <div className="reference-data-table skill-package-table">
          <div className="table-head"><span>技能包</span><span>包含的技能</span><span>可见范围</span><span>状态</span><span>操作</span></div>
          {enabledPackages.map((skillPackage) => {
            const skills = codexSkillsFromPackage(skillPackage);
            return <div className="table-row" key={skillPackage.id}>
              <span className="table-primary"><span className="table-icon"><PackageOpen /></span><span><strong>{skillPackage.name}</strong><small>{skillPackage.slug}</small></span></span>
              <span className="skill-table-skill-cell"><b>{skills.length} 个技能</b><span className="skill-name-list">{skills.length ? skills.map((skill) => <Tag key={skill.key}>{skill.name}</Tag>) : <Tag color="warning">未包含可运行技能</Tag>}</span></span>
              <span>{skillPackage.visibleToUsers ? "用户可见" : "仅管理员"}{agentVisibleToUsers && !skillPackage.visibleToUsers ? <Tag color="error">运行时不加载</Tag> : null}</span>
              <span><Tag color={skillPackage.status === "active" ? "success" : "default"}>{skillPackage.status === "active" ? "启用" : "停用"}</Tag></span>
              <span className="skill-row-actions"><Button type="link" aria-label={`查看 ${skillPackage.name}`} onClick={() => setDetailId(skillPackage.id)}>查看</Button><Button type="text" danger aria-label={`移除 ${skillPackage.name}`} onClick={() => onChange(selectedIds.filter((id) => id !== skillPackage.id))}>移除</Button></span>
            </div>;
          })}
        </div>
        {!enabledPackages.length ? <div className="reference-empty"><PackageOpen /><strong>尚未添加技能包</strong><p>添加完成目标所需的最小技能集合。</p><Button type="primary" onClick={openAddDrawer}>添加技能包</Button></div> : null}
      </section>

      <Drawer className="skill-add-reference-drawer" title="添加技能包" width={520} open={addOpen} onClose={() => setAddOpen(false)} footer={
        <div className="skill-add-footer"><div><strong>将新增 {draftIds.length} 个技能包、{stagedSkillCount} 个技能</strong><small>确认后加入当前智能体草稿，保存时统一提交。</small></div><Button onClick={() => setAddOpen(false)}>取消</Button><Button type="primary" disabled={!draftIds.length} onClick={applyDraft}>添加到草稿</Button></div>
      }>
        <Input prefix={<Search size={15} />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能包或技能名称" />
        <div className="skill-results-heading"><strong>可添加技能包</strong><span>{availablePackages.length} 个结果</span></div>
        <div className="skill-select-list skill-package-select-list">
          {availablePackages.map((skillPackage) => {
            const selected = draftIds.includes(skillPackage.id);
            const skills = codexSkillsFromPackage(skillPackage);
            return <label key={skillPackage.id} className={selected ? "selected" : ""}>
              <Checkbox checked={selected} onChange={() => toggleDraft(skillPackage.id)} aria-label={`选择 ${skillPackage.name}`} />
              <span className="skill-select-icon"><PackageOpen /></span>
              <span className="skill-select-copy"><span><strong>{skillPackage.name}</strong><Tag>{skills.length} 个技能</Tag></span><small>{skillPackage.description || skillPackage.slug}</small><span className="skill-candidate-tags">{skills.length ? skills.map((skill) => <Tag key={skill.key}>{skill.name}</Tag>) : <Tag color="warning">未包含可运行技能</Tag>}</span></span>
            </label>;
          })}
          {!availablePackages.length ? <div className="reference-empty"><Check /><strong>没有符合条件的技能包</strong><p>调整搜索词后重试。</p></div> : null}
        </div>
      </Drawer>

      <Drawer className="skill-detail-reference-drawer" title={detailPackage?.name || "技能包详情"} width={600} open={Boolean(detailPackage)} onClose={() => setDetailId(null)} footer={<Button onClick={() => setDetailId(null)}>关闭</Button>}>
        {detailPackage ? <>
          <div className="skill-detail-hero"><span className="table-icon"><PackageOpen /></span><span><strong>{detailPackage.name}</strong><small>{detailPackage.description || "未填写技能包说明"}</small><em>{detailPackage.slug}</em></span><Tag color={detailPackage.status === "active" ? "success" : "default"}>{detailPackage.status === "active" ? "启用" : "停用"}</Tag></div>
          <section className="skill-detail-section">
            <div className="skill-detail-heading"><h4>包含的技能</h4><span>{detailSkills.length} 个</span></div>
            {detailSkills.length ? <div className="skill-detail-items">{detailSkills.map((skill) => <article key={skill.key}>
              <div className="skill-detail-row-main"><span className="skill-detail-file-icon"><FileCode2 /></span><span className="skill-detail-copy"><strong>{skill.name}</strong><small>{skill.description || "未填写 Skill 说明"}</small><em>{skill.managedSkillId ? "组织发布" : "系统 / 本地"}{skill.activationPrompt ? " · 已配置触发说明" : ""}</em></span><Button size="small" onClick={() => void openSkillContent(skill)}>查看 SKILL.md</Button></div>
              {skill.activationPrompt ? <p className="skill-activation-prompt"><b>触发说明</b>{skill.activationPrompt}</p> : null}
            </article>)}</div> : <Alert type="warning" showIcon message="此技能包未包含可运行技能" description="当前只有绑定到 Codex Skill 的技能才会进入会话运行链路。" />}
          </section>
        </> : null}
      </Drawer>

      <Drawer className="skill-content-reference-drawer" title={contentSkill ? `${contentSkill.name} / SKILL.md` : "SKILL.md"} width={760} open={Boolean(contentSkill)} onClose={() => setContentSkill(null)}>
        {contentLoading ? <div className="skill-content-loading"><Spin /><span>正在读取 SKILL.md…</span></div> : null}
        {contentError ? <Alert type="error" showIcon message="无法读取 Skill 内容" description={contentError} /> : null}
        {!contentLoading && !contentError && skillContent ? <>
          <div className="skill-content-toolbar">
            <div><strong>{contentSkill?.name}</strong><span>{contentSkill?.managedSkillId ? "组织发布" : "系统 / 本地"} · {skillContent.split(/\r?\n/).length} 行</span></div>
            <Segmented size="small" value={contentView} onChange={(value) => setContentView(value as SkillContentView)} options={[{ label: <span><BookOpen />预览</span>, value: "preview" }, { label: <span><Code2 />源码</span>, value: "source" }]} />
            <Button icon={<Copy size={14} />} onClick={() => void copySkillContent()}>复制内容</Button>
          </div>
          {contentView === "preview" ? <div className="skill-content-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{markdownBody(skillContent)}</ReactMarkdown></div> : <pre className="skill-content-source">{skillContent}</pre>}
        </> : null}
      </Drawer>
    </>
  );
}
