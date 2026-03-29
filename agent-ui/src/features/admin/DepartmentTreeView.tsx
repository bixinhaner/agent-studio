import { useEffect, useState } from "react";

import { fetchDepartmentTree } from "./api";
import type { AdminDepartmentNode } from "./types";

function DepartmentNode(props: { node: AdminDepartmentNode }) {
  return (
    <li className="department-tree-node">
      <div className="department-tree-row">
        <span className="department-tree-name">{props.node.name}</span>
        <span className="department-tree-meta">{props.node.externalId}</span>
        <span className="department-tree-count">{props.node.memberCount} 人</span>
      </div>
      {props.node.children.length > 0 ? (
        <ul className="department-tree-list">
          {props.node.children.map((child) => (
            <DepartmentNode key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
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
    <section className="admin-card">
      <h2>部门树</h2>
      <p>部门结构和成员计数来自最近一次组织同步。</p>
      {loading ? <p>加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      <ul className="department-tree-list root">
        {departments.map((department) => (
          <DepartmentNode key={department.id} node={department} />
        ))}
      </ul>
    </section>
  );
}
