import { describe, expect, it } from "vitest";
import { localizeBrandingLoginCopy, loginCopy } from "./login-copy";

describe("login copy", () => {
  it("localizes fixed sign-in strings", () => {
    expect(loginCopy("zh-CN", "continueWithDingTalk")).toBe("使用钉钉登录");
    expect(loginCopy("en", "continueWithDingTalk")).toBe("Continue with DingTalk");
    expect(loginCopy("zh-CN", "codeSentTo", { email: "a***@b.com" })).toBe("验证码已发送至 a***@b.com");
  });

  it("translates the stock branding welcome sentence only for Chinese", () => {
    const copy = "Welcome to the intelligent agent world of Bailey.";
    expect(localizeBrandingLoginCopy(copy, "zh-CN")).toBe("欢迎来到 Bailey 的智能体世界。");
    expect(localizeBrandingLoginCopy(copy, "en")).toBe(copy);
    expect(localizeBrandingLoginCopy("自定义欢迎语", "zh-CN")).toBe("自定义欢迎语");
  });

  it("tells an expired invitee whom to contact instead of an administrator", () => {
    expect(loginCopy("en", "inviteExpiredCopy", { contact: "lion.li@cloud-ran.ai" })).toBe(
      "Your invitation for this email has expired. Ask lion.li@cloud-ran.ai to send you a new invitation."
    );
    expect(loginCopy("zh-CN", "inviteExpiredCopy", { contact: loginCopy("zh-CN", "inviteExpiredContactFallback") })).toBe(
      "该邮箱收到的邀请已过期。请联系 邀请你的人 重新发送邀请。"
    );
    expect(loginCopy("en", "accessNotReadyCopy")).not.toMatch(/administrator/i);
  });
});
