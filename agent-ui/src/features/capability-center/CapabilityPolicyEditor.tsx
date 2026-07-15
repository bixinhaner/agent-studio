import { useEffect, useMemo, useState } from "react";

import { PolicyRulesEditor } from "../admin/components/PolicyRulesEditor";
import { fetchCapabilityPolicies, putCapabilityPolicies } from "./api";
import type { CapabilityPolicyInput, CapabilityResourceType, ResourcePolicyEffect, ResourcePolicySubjectType } from "./types";

type EditablePolicy = {
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  effect: ResourcePolicyEffect;
};

type CapabilityPolicyEditorProps = {
  resourceType: CapabilityResourceType;
  resourceId: string;
  title?: string;
};

function normalizePolicies(policies: CapabilityPolicyInput[]) {
  return policies.map((policy) => ({
    subjectType: policy.subjectType,
    subjectId: policy.subjectId,
    effect: policy.effect
  }));
}

export function CapabilityPolicyEditor({
  resourceType,
  resourceId,
  title = "能力授权"
}: CapabilityPolicyEditorProps) {
  const [policies, setPolicies] = useState<EditablePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [policiesReady, setPoliciesReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setPoliciesReady(false);
      setErrorText("");
      setSuccessText("");
      try {
        const response = await fetchCapabilityPolicies(resourceType, resourceId);
        if (!active) return;
        setPolicies(normalizePolicies(response.policies));
        setPoliciesReady(true);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载能力授权失败");
          setPoliciesReady(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [resourceId, resourceType]);

  const hasInvalidPolicy = useMemo(() => policies.some((policy) => !policy.subjectId.trim()), [policies]);

  async function handleSave() {
    if (hasInvalidPolicy) {
      setErrorText("主体标识不能为空");
      return;
    }

    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await putCapabilityPolicies(
        resourceType,
        resourceId,
        policies.map((policy) => ({
          subjectType: policy.subjectType,
          subjectId: policy.subjectId.trim(),
          effect: policy.effect
        }))
      );
      setPolicies(normalizePolicies(response.policies));
      setSuccessText("能力授权已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存能力授权失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PolicyRulesEditor
      title={title}
      addLabel="添加例外"
      saveLabel="保存规则"
      description="添加需要额外允许或拒绝的角色、部门或用户；拒绝规则会优先执行。"
      emptyText="当前没有额外访问规则。"
      loadingText="加载能力授权中..."
      savingLabel="保存中..."
      rules={policies}
      loading={loading}
      saving={saving}
      ready={policiesReady}
      errorText={errorText}
      successText={successText}
      addInDrawer
      referenceAccessLayout
      onChange={(nextPolicies) => {
        setPolicies(nextPolicies);
        setSuccessText("");
      }}
      onSave={() => void handleSave()}
    />
  );
}
