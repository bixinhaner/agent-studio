import { useEffect, useState, useMemo } from "react";
import { Alert, Card, Space, Spin, Tag, Tree, Input, Typography } from "antd";
import type { TreeDataNode } from "antd";
import { Search, Building2, Users } from "lucide-react";

import { fetchDepartmentTree } from "./api";
import type { AdminDepartmentNode } from "./types";

function toTreeData(node: AdminDepartmentNode, searchValue: string): TreeDataNode {
  const index = node.name.toLowerCase().indexOf(searchValue.toLowerCase());
  const beforeStr = node.name.substring(0, index);
  const matchStr = node.name.substring(index, index + searchValue.length);
  const afterStr = node.name.substring(index + searchValue.length);

  const title =
    index > -1 ? (
      <span>
        {beforeStr}
        <span style={{ color: 'var(--admin-color-accent)', fontWeight: 600 }}>{matchStr}</span>
        {afterStr}
      </span>
    ) : (
      <span>{node.name}</span>
    );

  return {
    key: node.id,
    title: (
      <div className="admin-tree-node">
        <div className="admin-tree-node-title">
          <Building2 size={14} style={{ color: 'var(--admin-color-subtle)' }} />
          <Typography.Text strong style={{ fontSize: 14 }}>{title}</Typography.Text>
        </div>
        <div className="admin-tree-node-meta">
          <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            {node.externalId}
          </Typography.Text>
          <Tag icon={<Users size={12} />} style={{ border: 'none', background: 'var(--admin-color-bg)' }}>
            {node.memberCount}
          </Tag>
        </div>
      </div>
    ),
    children: node.children.map(child => toTreeData(child, searchValue))
  };
}

function getParentKey(key: string, tree: AdminDepartmentNode[]): string | null {
  let parentKey: string | null = null;
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (node.children) {
      if (node.children.some((item) => item.id === key)) {
        parentKey = node.id;
      } else if (getParentKey(key, node.children)) {
        parentKey = getParentKey(key, node.children);
      }
    }
  }
  return parentKey;
}

export function DepartmentTreeView() {
  const [departments, setDepartments] = useState<AdminDepartmentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [autoExpandParent, setAutoExpandParent] = useState(true);

  // Extract all flat data for search
  const dataList: { key: string; title: string }[] = useMemo(() => {
    const list: { key: string; title: string }[] = [];
    const generateList = (data: AdminDepartmentNode[]) => {
      for (let i = 0; i < data.length; i++) {
        const node = data[i];
        list.push({ key: node.id, title: node.name });
        if (node.children) {
          generateList(node.children);
        }
      }
    };
    generateList(departments);
    return list;
  }, [departments]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const response = await fetchDepartmentTree();
        if (active) {
          setDepartments(response.departments);
          // Expand first level by default
          setExpandedKeys(response.departments.map(d => d.id));
        }
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

  const onExpand = (newExpandedKeys: React.Key[]) => {
    setExpandedKeys(newExpandedKeys);
    setAutoExpandParent(false);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    const newExpandedKeys = dataList
      .map((item) => {
        if (item.title.toLowerCase().includes(value.toLowerCase())) {
          return getParentKey(item.key, departments);
        }
        return null;
      })
      .filter((item, i, self) => item && self.indexOf(item) === i);
    setExpandedKeys(newExpandedKeys as React.Key[]);
    setSearchValue(value);
    setAutoExpandParent(true);
  };

  const treeData = useMemo(() => departments.map(d => toTreeData(d, searchValue)), [departments, searchValue]);

  return (
    <Card className="admin-tree-card" bordered={false} bodyStyle={{ padding: 0 }}>
      <div className="admin-tree-header">
        <Typography.Title level={4} style={{ margin: '0 0 8px 0', fontSize: 18 }}>
          部门结构树
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 16px 0', fontSize: 13 }}>
          展示从身份提供商（如钉钉、飞书）同步的最新组织架构。支持拼音或汉字搜索。
        </Typography.Paragraph>
        <Input 
          placeholder="搜索部门名称..." 
          prefix={<Search size={16} style={{ color: 'var(--admin-color-subtle)' }} />}
          onChange={onChange} 
          style={{ width: '100%', maxWidth: 400 }}
          size="large"
          allowClear
        />
      </div>
      <div className="admin-tree-container">
        {errorText && <Alert type="error" showIcon message={errorText} style={{ marginBottom: 16 }} />}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spin size="large" /></div>
        ) : (
          <Tree
            onExpand={onExpand}
            expandedKeys={expandedKeys}
            autoExpandParent={autoExpandParent}
            treeData={treeData}
            blockNode
            showLine={{ showLeafIcon: false }}
            style={{ background: 'transparent' }}
          />
        )}
      </div>
    </Card>
  );
}
