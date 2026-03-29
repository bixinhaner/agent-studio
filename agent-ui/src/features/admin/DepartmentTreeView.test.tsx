import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchDepartmentTree: vi.fn()
}));

import { fetchDepartmentTree } from "./api";
import { DepartmentTreeView } from "./DepartmentTreeView";

const mockedFetchDepartmentTree = vi.mocked(fetchDepartmentTree);

describe("DepartmentTreeView", () => {
  beforeEach(() => {
    mockedFetchDepartmentTree.mockReset();
  });

  it("renders nested departments and member counts", async () => {
    mockedFetchDepartmentTree.mockResolvedValue({
      departments: [
        {
          id: "department-1",
          externalId: "dept-rd",
          name: "研发",
          sortOrder: 0,
          status: "active",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          children: [
            {
              id: "department-2",
              externalId: "dept-platform",
              name: "平台",
              sortOrder: 0,
              status: "active",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z",
              children: [],
              memberCount: 1
            }
          ],
          memberCount: 3
        }
      ]
    });

    render(<DepartmentTreeView />);

    expect(await screen.findByText(/研发/)).toBeTruthy();
    expect(screen.getByText(/3 人/)).toBeTruthy();
    expect(screen.getByText(/平台/)).toBeTruthy();
    expect(screen.getByText(/1 人/)).toBeTruthy();
  });
});
