import type { PortalRuntimeOptionSkill } from "../../portal/runtime-option-service.js";

type DwsCapabilityCopy = {
  displayName: string;
  summary: string;
  useCases: string[];
  usageSteps: string[];
  examplePrompts: string[];
  dataScope: string;
};

const DWS_CAPABILITY_COPY: Record<"zh-CN" | "en", DwsCapabilityCopy> = {
  "zh-CN": {
    displayName: "钉钉",
    summary: "使用当前钉钉账号处理联系人、群聊、日程、待办、文档和云盘等工作",
    useCases: ["查找同事和组织信息", "查看或安排日程与待办", "处理群聊、消息、文档和云盘文件"],
    usageSteps: [
      "直接描述需要在钉钉完成的事情",
      "首次使用时，按对话提示完成钉钉设备授权",
      "发送、删除等高影响操作会在执行前请求确认"
    ],
    examplePrompts: ["查看我今天的日程和待办。", "帮我查找张三的钉钉信息。"],
    dataScope: "仅访问当前用户授权的钉钉账号，以及该账号在所属组织内有权访问的数据。"
  },
  en: {
    displayName: "Dingtalk",
    summary: "Use your current Dingtalk account for contacts, chats, calendars, tasks, documents, Drive, and more",
    useCases: [
      "Find coworkers and organization information",
      "Review or arrange calendars and tasks",
      "Work with chats, messages, documents, and Drive files"
    ],
    usageSteps: [
      "Describe what you need to accomplish in Dingtalk",
      "Complete Dingtalk device authorization when prompted on first use",
      "Confirm sending, deletion, and other high-impact actions before execution"
    ],
    examplePrompts: ["Show my calendar and tasks for today.", "Find Zhang San's Dingtalk profile."],
    dataScope: "Only the current user's authorized Dingtalk account and data that account can access in its organization."
  }
};

function resolveCapabilityLocale(locale: string | undefined): "zh-CN" | "en" {
  const normalized = locale?.trim().toLowerCase();
  return !normalized || normalized.startsWith("zh") ? "zh-CN" : "en";
}

export function createDwsPortalCapability(locale?: string): PortalRuntimeOptionSkill {
  const resolvedLocale = resolveCapabilityLocale(locale);
  const copy = DWS_CAPABILITY_COPY[resolvedLocale];
  return {
    id: "system:dingtalk",
    name: "dingtalk",
    label: copy.displayName,
    description: copy.summary,
    system: true,
    automatic: true,
    scope: "platform",
    presentation: {
      displayName: copy.displayName,
      summary: copy.summary,
      useCases: [...copy.useCases],
      usageSteps: [...copy.usageSteps],
      examplePrompts: [...copy.examplePrompts],
      dataScope: copy.dataScope,
      iconKey: "dingtalk",
      sortOrder: 35,
      requestedLocale: resolvedLocale,
      resolvedLocale
    }
  };
}

export async function resolveDwsPortalCapabilities(input: {
  userId: string;
  locale?: string;
  isAvailableForUser: (userId: string) => Promise<boolean>;
}): Promise<PortalRuntimeOptionSkill[]> {
  try {
    if (!(await input.isAvailableForUser(input.userId))) return [];
    return [createDwsPortalCapability(input.locale)];
  } catch {
    return [];
  }
}
