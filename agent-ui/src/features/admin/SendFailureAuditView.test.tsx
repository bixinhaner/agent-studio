import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { SendFailureAuditView } from "./SendFailureAuditView";

vi.mock("../../lib/api", () => ({ api: vi.fn() }));
beforeAll(() => { window.matchMedia = vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never; });
afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, "", "#admin/conversations"); });
describe("send failure audit", () => {
  it("shows orphan failures and preserves query filters in the URL", async () => {
    vi.mocked(api).mockResolvedValue({ items: [{ id: "f1", threadId: null, userName: "Test User", stage: "thread_create", source: "server", createdAt: "2026-10-09T12:00:00Z", attachments: [], messagePreview: "未发出的文字" }], total: 1, page: 1 });
    render(<SendFailureAuditView />);
    expect(await screen.findByText("Test User")).toBeTruthy();
    expect(String(vi.mocked(api).mock.calls[0][0])).toContain("unlinked=true");
    fireEvent.click(screen.getByText("Test User"));
    expect(await screen.findByText("未发出的文字")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("用户"), { target: { value: "somebody@example.com" } });
    fireEvent.change(screen.getByLabelText("失败阶段"), { target: { value: "thread_create" } });
    fireEvent.click(screen.getByRole("button", { name: /查\s*询/ }));
    await waitFor(() => expect(String(vi.mocked(api).mock.calls.at(-1)?.[0])).toContain("stage=thread_create"));
    expect(window.location.hash).toContain("failure_user=somebody%40example.com");
  });
  it("offers retry after a failed request and renders an empty result", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("暂时不可用")).mockResolvedValueOnce({ items: [], total: 0, page: 1 });
    render(<SendFailureAuditView />);
    expect(await screen.findByText("暂时不可用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    expect(await screen.findByText("没有符合条件的发送失败记录")).toBeTruthy();
  });
});
