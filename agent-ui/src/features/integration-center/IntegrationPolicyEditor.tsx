import { useEffect, useMemo, useState } from "react";

import { PolicyRulesEditor } from "../admin/components/PolicyRulesEditor";
import { fetchIntegrationPolicies, putIntegrationPolicies } from "./api";
import type { IntegrationPolicyInput } from "./types";

type EditablePolicy = IntegrationPolicyInput;

export function IntegrationPolicyEditor(props: { instanceId: string }) {
  const [policies, setPolicies] = useState<EditablePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setReady(false);
      setErrorText("");
      setSuccessText("");
      try {
        const response = await fetchIntegrationPolicies(props.instanceId);
        if (!active) return;
        setPolicies(response.items.map((item) => ({ ...item })));
        setReady(true);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载集成授权失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [props.instanceId]);

  const hasInvalidPolicy = useMemo(() => policies.some((item) => !item.subjectId.trim()), [policies]);

  async function handleSave() {
    if (hasInvalidPolicy) {
      setErrorText("主体标识不能为空");
      return;
    }
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await putIntegrationPolicies(
        props.instanceId,
        policies.map((item) => ({ ...item, subjectId: item.subjectId.trim() }))
      );
      setPolicies(response.items.map((item) => ({ ...item })));
      setSuccessText("集成授权已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存集成授权失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PolicyRulesEditor
      title="授权"
      description="按单个集成实例维护角色、部门和用户的 allow / deny 策略。"
      emptyText="当前集成还没有显式授权策略。"
      loadingText="加载集成授权中..."
      saveLabel="保存授权"
      savingLabel="保存中..."
      rules={policies}
      loading={loading}
      saving={saving}
      ready={ready}
      errorText={errorText}
      successText={successText}
      onChange={(nextPolicies) => {
        setPolicies(nextPolicies);
        setSuccessText("");
      }}
      onSave={() => void handleSave()}
    />
  );
}
