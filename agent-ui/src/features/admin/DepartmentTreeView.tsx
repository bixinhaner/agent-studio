import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Avatar, Button, Card, Empty, Input, Spin, Switch, Tag, Tooltip, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import { Building2, RefreshCcw, Search, UserRound } from "lucide-react";

import { fetchDepartmentTree } from "./api";
import type { AdminDepartmentNode } from "./types";

type DirectoryTreeNode = AdminDepartmentNode & {
  children: DirectoryTreeNode[];
};

function highlightedText(value: string, query: string) {
  const index = query ? value.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="admin-directory-highlight">{value.slice(index, index + query.length)}</mark>
      {value.slice(index + query.length)}
    </>
  );
}

function matchesUser(user: AdminDepartmentNode["users"][number], query: string): boolean {
  return [user.displayName, user.email, user.title]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function filterDirectory(nodes: AdminDepartmentNode[], rawQuery: string): DirectoryTreeNode[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const departmentMatches = node.name.toLowerCase().includes(query);
    const children = filterDirectory(node.children, rawQuery);
    const users = departmentMatches ? node.users : node.users.filter((user) => matchesUser(user, query));
    if (!departmentMatches && children.length === 0 && users.length === 0) return [];
    return [{ ...node, users, children }];
  });
}

function collectDepartmentKeys(nodes: AdminDepartmentNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...collectDepartmentKeys(node.children)]);
}

function toTreeData(node: DirectoryTreeNode, query: string, showUsers: boolean): DataNode {
  const userNodes: DataNode[] = showUsers
    ? node.users.map((user) => ({
        key: `user:${node.id}:${user.id}`,
        selectable: false,
        isLeaf: true,
        title: (
          <div className="admin-directory-row admin-directory-person-row">
            <div className="admin-directory-person">
              <Avatar size={26} src={user.avatarUrl || undefined} icon={<UserRound size={13} />} />
              <div className="admin-directory-person-copy">
                <span className="admin-directory-person-name">{highlightedText(user.displayName, query)}</span>
                <span className="admin-directory-person-detail">
                  {[user.email, user.title].filter(Boolean).map((value, index) => (
                    <span key={`${value}:${index}`}>{highlightedText(String(value), query)}</span>
                  ))}
                </span>
              </div>
              {user.isLeader ? <Tag color="blue">部门负责人</Tag> : null}
            </div>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </div>
        )
      }))
    : [];

  return {
    key: node.id,
    title: (
      <div className="admin-directory-row admin-directory-department-row">
        <div className="admin-tree-node-title">
          <Building2 size={15} />
          <Typography.Text strong>{highlightedText(node.name, query)}</Typography.Text>
          {node.status !== "active" ? <Tag>已停用</Tag> : null}
        </div>
        <span className="admin-directory-count">{node.memberCount}</span>
        <span className="admin-directory-count">{node.subtreeMemberCount}</span>
      </div>
    ),
    children: [...node.children.map((child) => toTreeData(child, query, showUsers)), ...userNodes]
  };
}

function countDepartments(nodes: AdminDepartmentNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countDepartments(node.children), 0);
}

export function DepartmentTreeView() {
  const [departments, setDepartments] = useState<AdminDepartmentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [showUsers, setShowUsers] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetchDepartmentTree();
      setDepartments(response.departments);
      setExpandedKeys(response.departments.map((department) => department.id));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载部门树失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredDepartments = useMemo(
    () => filterDirectory(departments, searchValue),
    [departments, searchValue]
  );
  const treeData = useMemo(
    () => filteredDepartments.map((department) => (
      toTreeData(department, searchValue.trim(), showUsers || Boolean(searchValue.trim()))
    )),
    [filteredDepartments, searchValue, showUsers]
  );
  const visibleExpandedKeys = searchValue.trim() ? collectDepartmentKeys(filteredDepartments) : expandedKeys;
  const departmentCount = useMemo(() => countDepartments(departments), [departments]);
  const activeUserCount = useMemo(() => {
    const ids = new Set<string>();
    const visit = (nodes: AdminDepartmentNode[]) => {
      for (const node of nodes) {
        for (const user of node.users) ids.add(user.id);
        visit(node.children);
      }
    };
    visit(departments);
    return ids.size;
  }, [departments]);

  return (
    <Card className="admin-tree-card admin-directory-card antd-admin-card" bordered={false} bodyStyle={{ padding: 0 }}>
      <div className="admin-tree-header admin-directory-header">
        <Typography.Title level={4}>部门结构树</Typography.Title>
        <div className="admin-directory-toolbar">
          <Input
            aria-label="搜索部门、姓名或邮箱"
            placeholder="搜索部门、姓名或邮箱"
            prefix={<Search size={15} />}
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            allowClear
          />
          <label className="admin-directory-switch">
            <Switch checked={showUsers} onChange={setShowUsers} size="small" />
            <span>显示人员</span>
          </label>
          <Tooltip title="刷新组织树">
            <Button aria-label="刷新组织树" icon={<RefreshCcw size={15} />} onClick={() => void load()} loading={loading} />
          </Tooltip>
        </div>
      </div>
      <div className="admin-directory-summary">
        <span>{departmentCount} 个部门</span>
        <span><strong>{activeUserCount}</strong> 名在职员工</span>
      </div>
      <div className="admin-directory-column-head" aria-hidden="true">
        <span>名称</span>
        <span>直属人数</span>
        <span>含下级人数</span>
      </div>
      <div className="admin-tree-container">
        {errorText ? <Alert type="error" showIcon message={errorText} /> : null}
        {loading ? (
          <div className="admin-directory-loading"><Spin size="large" /></div>
        ) : treeData.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的部门或员工" />
        ) : (
          <Tree
            onExpand={(keys) => setExpandedKeys(keys)}
            expandedKeys={visibleExpandedKeys}
            autoExpandParent={Boolean(searchValue.trim())}
            treeData={treeData}
            blockNode
            showLine={{ showLeafIcon: false }}
            className="admin-directory-tree"
          />
        )}
      </div>
    </Card>
  );
}
