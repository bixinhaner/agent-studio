import type {
  ExternalConversationBindingRecord,
  ExternalConversationBindingRepository,
  UpsertExternalConversationBindingInput
} from "../persistence/external-conversation-binding-repository.js";
import type {
  StoredMessageItem,
  ThreadRecord,
  ThreadRepository
} from "../persistence/thread-repository.js";

type ThreadStore = Pick<
  ThreadRepository,
  | "appendMessage"
  | "create"
  | "get"
  | "getByExternalId"
  | "getRepository"
  | "list"
  | "listForUser"
  | "replaceMessages"
  | "update"
>;

type ExternalConversationStore = Pick<
  ExternalConversationBindingRepository,
  | "getByExternalConversationKey"
  | "listByThreadIds"
  | "listRecentForIntegration"
  | "touch"
  | "updateThread"
  | "upsert"
>;

export type AppendConversationMessageInput = StoredMessageItem & {
  threadId: string;
};

export type ReplaceConversationMessagesInput = {
  threadId: string;
  headId?: string | null;
  messages: StoredMessageItem[];
};

export class ConversationRecordService {
  constructor(
    private readonly deps: {
      threads: ThreadStore;
      externalConversations: ExternalConversationStore;
    }
  ) {}

  async listThreads(input: { organizationId?: string; includeArchived?: boolean } = {}): Promise<ThreadRecord[]> {
    return this.deps.threads.list(input.organizationId, input.includeArchived ?? false);
  }

  async listThreadsForUser(input: {
    userId: string;
    organizationId?: string;
    includeArchived?: boolean;
  }): Promise<ThreadRecord[]> {
    return this.deps.threads.listForUser(input.userId, input.organizationId, input.includeArchived ?? false);
  }

  async getThread(threadId: string, organizationId?: string): Promise<ThreadRecord | undefined> {
    return this.deps.threads.get(threadId, organizationId);
  }

  async getThreadByExternalId(externalId: string, organizationId?: string): Promise<ThreadRecord | undefined> {
    return this.deps.threads.getByExternalId(externalId, organizationId);
  }

  async createThread(input: Parameters<ThreadStore["create"]>[0]): Promise<ThreadRecord> {
    return this.deps.threads.create(input);
  }

  async updateThread(threadId: string, patch: Parameters<ThreadStore["update"]>[1]): Promise<ThreadRecord> {
    return this.deps.threads.update(threadId, patch);
  }

  async appendMessage(input: AppendConversationMessageInput): Promise<ThreadRecord> {
    return this.deps.threads.appendMessage(input.threadId, {
      parentId: input.parentId,
      message: input.message,
      runConfig: input.runConfig,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    });
  }

  async replaceMessages(input: ReplaceConversationMessagesInput): Promise<ThreadRecord> {
    return this.deps.threads.replaceMessages(input.threadId, {
      headId: input.headId,
      messages: input.messages
    });
  }

  async getMessageRepository(threadId: string): Promise<{ headId?: string | null; messages: StoredMessageItem[] }> {
    return this.deps.threads.getRepository(threadId);
  }

  async getExternalConversationBinding(externalConversationKey: string): Promise<ExternalConversationBindingRecord | undefined> {
    return this.deps.externalConversations.getByExternalConversationKey(externalConversationKey);
  }

  async upsertExternalConversation(input: UpsertExternalConversationBindingInput): Promise<ExternalConversationBindingRecord> {
    return this.deps.externalConversations.upsert(input);
  }

  async updateExternalConversationThread(input: {
    externalConversationKey: string;
    threadId: string;
    lastExternalMessageId?: string | null;
    lastMessageAt?: string | Date | null;
    metadata?: unknown;
  }): Promise<ExternalConversationBindingRecord> {
    return this.deps.externalConversations.updateThread(input);
  }

  async touchExternalConversation(input: {
    externalConversationKey: string;
    lastExternalMessageId?: string | null;
    lastMessageAt?: string | Date | null;
    metadata?: unknown;
  }): Promise<ExternalConversationBindingRecord> {
    return this.deps.externalConversations.touch(input);
  }

  async listRecentExternalConversations(
    integrationInstanceId: string,
    take?: number
  ): Promise<ExternalConversationBindingRecord[]> {
    return this.deps.externalConversations.listRecentForIntegration(integrationInstanceId, take);
  }

  async listExternalConversationBindingsByThreadIds(threadIds: string[]): Promise<ExternalConversationBindingRecord[]> {
    return this.deps.externalConversations.listByThreadIds(threadIds);
  }
}
