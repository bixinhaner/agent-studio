import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import { CreateWorkspaceFolderModal } from "./CreateWorkspaceFolderModal";

beforeEach(() => {
  window.localStorage.setItem("agent-studio.portal.locale.v1", "zh-CN");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("CreateWorkspaceFolderModal", () => {
  it("creates a trimmed folder name without using a browser prompt", async () => {
    const onCreate = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    render(
      <PortalI18nProvider>
        <CreateWorkspaceFolderModal
          open
          parentName="员工AI培训"
          onCancel={onCancel}
          onCreate={onCreate}
        />
      </PortalI18nProvider>
    );

    expect(screen.getByText("在“员工AI培训”中创建子文件夹。")).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "文件夹名称" });
    fireEvent.change(input, { target: { value: "  01 数据与表格  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith("01 数据与表格");
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  it("keeps the modal open and explains a creation failure", async () => {
    const onCreate = vi.fn(async () => {
      throw new Error("同名文件夹已经存在");
    });
    const onCancel = vi.fn();
    render(
      <PortalI18nProvider>
        <CreateWorkspaceFolderModal open onCancel={onCancel} onCreate={onCreate} />
      </PortalI18nProvider>
    );

    fireEvent.change(screen.getByRole("textbox", { name: "文件夹名称" }), {
      target: { value: "员工AI培训" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建文件夹" }));

    expect((await screen.findByRole("alert")).textContent).toContain("同名文件夹已经存在");
    expect(onCancel).not.toHaveBeenCalled();
  });
});
