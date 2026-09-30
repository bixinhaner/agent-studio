import { describe, expect, it } from "vitest";

import { classifyPortalRole } from "./role-profile.js";

describe("classifyPortalRole", () => {
  it.each([
    ["L2协议软件部", "rd_software"],
    ["基站硬件部/Base Station Hardware Dept.", "rd_hardware"],
    ["无线产品质量部", "qa_test"],
    ["产品战略方案和项目经营部/Product Strategy & Project Operations Department", "product"],
    ["方案交付支持中心", "solution_delivery"],
    ["Int'l Market Div. /APEC", "sales_international"],
    ["运营商营销中心", "sales_domestic"],
    ["国内财务组", "finance"],
    ["区域人力行政部", "hr_admin"],
    ["采购部", "supply_chain"],
    ["SMT车间", "manufacturing"],
    ["项目管理部/Project Management Dept.", "project_management"],
    ["中电佰联", "general"]
  ])("%s → %s", (department, expected) => {
    expect(classifyPortalRole(department)).toBe(expected);
  });

  it("falls back to general without a department", () => {
    expect(classifyPortalRole(null)).toBe("general");
  });
});
