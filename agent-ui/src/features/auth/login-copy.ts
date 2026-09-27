import type { PortalLocale } from "../portal/i18n";

const EN = {
  customerInvite: "Customer Invite",
  internalSignIn: "Internal Employee Sign-In",
  inviteSubtitle: "Use your work email to accept the invitation and enter your organization.",
  loadingInvite: "Loading invitation details...",
  invitedYou: "invited you to join",
  invitePending: "Pending acceptance",
  inviteAccepted: "Accepted",
  inviteExpired: "Expired",
  emailPlaceholder: "Email address",
  sending: "Sending...",
  continueWithEmail: "Continue with Email",
  applyTrial: "Apply for Trial Access",
  continueWithDingTalk: "Continue with DingTalk",
  dingTalkHint: "Use DingTalk single sign-on to access the internal workspace and control console.",
  internalEmailNotice: "This email belongs to an internal employee account. Use DingTalk single sign-on to continue.",
  codeSentTo: "We sent a code to {email}",
  enterCode: "Enter the verification code sent to your email.",
  verifying: "Verifying...",
  verify: "Verify & Sign In",
  back: "Back",
  enterEmail: "Enter your email address.",
  enterCodeError: "Enter the verification code.",
  sendCodeFailed: "Failed to send verification code",
  verifyFailed: "Verification failed",
  accessNotReady: "Access Not Ready",
  closeAccessHelp: "Close access help dialog",
  accessNotReadyCopy:
    "This email does not have active access yet. Ask your administrator to resend the invite, or apply for trial access.",
  backToSignIn: "Back to Sign In"
};

export type LoginCopyKey = keyof typeof EN;

const ZH: Record<LoginCopyKey, string> = {
  customerInvite: "客户邀请",
  internalSignIn: "内部员工登录",
  inviteSubtitle: "使用工作邮箱接受邀请并进入你的组织。",
  loadingInvite: "正在加载邀请信息…",
  invitedYou: "邀请你加入",
  invitePending: "待接受",
  inviteAccepted: "已接受",
  inviteExpired: "已过期",
  emailPlaceholder: "邮箱地址",
  sending: "正在发送…",
  continueWithEmail: "使用邮箱继续",
  applyTrial: "申请试用",
  continueWithDingTalk: "使用钉钉登录",
  dingTalkHint: "通过钉钉单点登录进入内部工作台和控制台。",
  internalEmailNotice: "该邮箱属于内部员工账号，请使用钉钉单点登录继续。",
  codeSentTo: "验证码已发送至 {email}",
  enterCode: "请输入邮箱收到的验证码。",
  verifying: "正在验证…",
  verify: "验证并登录",
  back: "返回",
  enterEmail: "请输入邮箱地址。",
  enterCodeError: "请输入验证码。",
  sendCodeFailed: "验证码发送失败",
  verifyFailed: "验证失败",
  accessNotReady: "尚未开通访问",
  closeAccessHelp: "关闭访问帮助",
  accessNotReadyCopy: "该邮箱尚未开通访问权限。请联系管理员重新发送邀请，或申请试用。",
  backToSignIn: "返回登录"
};

export function loginCopy(locale: PortalLocale, key: LoginCopyKey, values?: Record<string, string>): string {
  const template = (locale === "zh-CN" ? ZH : EN)[key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? values[name] : match));
}

const WELCOME_COPY_PATTERN = /^welcome to the intelligent agent world of\s+(.+?)[.。]?$/i;

/**
 * Branding copy is stored in one language. Translate the stock welcome sentence for
 * Chinese visitors; custom copy is shown as configured.
 */
export function localizeBrandingLoginCopy(copy: string, locale: PortalLocale): string {
  const value = copy.trim();
  if (locale !== "zh-CN" || !value) return value;
  const match = value.match(WELCOME_COPY_PATTERN);
  if (match) return `欢迎来到 ${match[1]} 的智能体世界。`;
  return value;
}
