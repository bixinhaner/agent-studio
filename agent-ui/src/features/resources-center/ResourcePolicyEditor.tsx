import { useEffect, useMemo, useState } from "react";

import { PolicyRulesEditor } from "../admin/components/PolicyRulesEditor";
import { fetchResourcePolicies, putResourcePolicies } from "./api";
import type {
  ResourcePolicyEffect,
  ResourcePolicyInput,
  ResourcePolicyResourceType,
  ResourcePolicySubjectType
} from "./types";

type EditablePolicy = {
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  effect: ResourcePolicyEffect;
};

type ResourcePolicyEditorProps = {
  resourceType: ResourcePolicyResourceType;
  resourceId: string;
  title?: string;
};

function normalizePolicies(policies: ResourcePolicyInput[]) {
  return policies.map((policy) => ({
    subjectType: policy.subjectType,
    subjectId: policy.subjectId,
    effect: policy.effect
  }));
}

export function ResourcePolicyEditor({ resourceType, resourceId, title = "资源策略" }: ResourcePolicyEditorProps) {
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
        const response = await fetchResourcePolicies(resourceType, resourceId);
        if (!active) return;
        setPolicies(normalizePolicies(response.policies));
        setPoliciesReady(true);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载资源授权失败");
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

  const hasInvalidPolicy = useMemo(() => {
    return policies.some((policy) => !policy.subjectId.trim());
  }, [policies]);

  async function handleSave() {
    if (hasInvalidPolicy) {
      setErrorText("主体标识不能为空");
      return;
    }

    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await putResourcePolicies(
        resourceType,
        resourceId,
        policies.map((policy) => ({
          subjectType: policy.subjectType,
          subjectId: policy.subjectId.trim(),
          effect: policy.effect
        }))
      );
      setPolicies(normalizePolicies(response.policies));
      setSuccessText("资源授权已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存资源授权失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PolicyRulesEditor
      title={title}
      description="按单个资源维护角色、部门和用户的允许或拒绝策略，角色主体支持内部员工/内部管理员/外部 User/外部 Admin。"
      emptyText="当前资源还没有显式授权策略。"
      loadingText="加载资源授权中..."
      saveLabel="保存资源授权"
      savingLabel="保存中..."
      rules={policies}
      loading={loading}
      saving={saving}
      ready={policiesReady}
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
