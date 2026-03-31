import { useEffect, useState } from "react";
import { Alert, Card, Space, Spin, Tag, Tree, Typography } from "antd";
import type { TreeDataNode } from "antd";

import { fetchDepartmentTree } from "./api";
import type { AdminDepartmentNode } from "./types";

function toTreeData(node: AdminDepartmentNode): TreeDataNode {
  return {
    key: node.id,
    title: (
      <Space size={8}>
        <Typography.Text strong>{node.name}</Typography.Text>
        <Typography.Text type="secondary">{node.externalId}</Typography.Text>
        <Tag>{node.memberCount} 人</Tag>
      </Space>
    ),
    children: node.children.map(toTreeData)
  };
}

function collectExpandedKeys(nodes: AdminDepartmentNode[]): string[] {
  const keys: string[] = [];
  function visit(input: AdminDepartmentNode[]) {
    for (const node of input) {
      keys.push(node.id);
      if (node.children.length > 0) visit(node.children);
    }
  }
  visit(nodes);
  return keys;
}

export function DepartmentTreeView() {
  const [departments, setDepartments] = useState<AdminDepartmentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const response = await fetchDepartmentTree();
        if (active) setDepartments(response.departments);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载部门树失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card className="admin-card antd-admin-card">
      <Typography.Title level={4} className="admin-card-heading">
        部门树
      </Typography.Title>
      <Typography.Paragraph>部门结构和成员计数来自最近一次组织同步。</Typography.Paragraph>
      {loading ? <Spin size="small" /> : null}
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      <Tree
        showLine
        blockNode
        treeData={departments.map(toTreeData)}
        expandedKeys={collectExpandedKeys(departments)}
      />
    </Card>
  );
}
