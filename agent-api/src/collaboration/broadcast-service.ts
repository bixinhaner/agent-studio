import type {
  BroadcastDraftInput,
  BroadcastRecord,
  BroadcastRepository,
  BroadcastTargetRecord,
  BroadcastUpdateInput
} from "../persistence/broadcast-repository.js";
import type { CollaborationInboxProjectionInput, InboxProjectionService } from "./inbox-projection-service.js";

type BroadcastRecipientDirectory = {
  listAllUserIds?: () => Promise<string[]>;
  listUserIdsForDepartment?: (departmentId: string) => Promise<string[]>;
  listUserIdsForRole?: (roleId: string) => Promise<string[]>;
};

type BroadcastNotificationDispatcher = {
  dispatchBroadcast?: (input: {
    broadcast: BroadcastRecord;
    recipientUserIds: string[];
  }) => Promise<void>;
};

type BroadcastAuthorizer = {
  canCreateBroadcast?: (input: { actorUserId: string }) => Promise<boolean>;
  canUpdateBroadcast?: (input: { actorUserId: string; broadcastId: string }) => Promise<boolean>;
  canPublishBroadcast?: (input: { actorUserId: string; broadcastId: string }) => Promise<boolean>;
};

function uniqueUserIds(userIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const userId of userIds) {
    const value = typeof userId === "string" ? userId.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export class BroadcastService {
  constructor(
    private readonly deps: {
      broadcasts: Pick<BroadcastRepository, "createDraft" | "updateDraft" | "publish">;
      inboxProjection?: Pick<InboxProjectionService, "projectCollaborationEvent">;
      recipientDirectory?: BroadcastRecipientDirectory;
      notifications?: BroadcastNotificationDispatcher;
      authorizer?: BroadcastAuthorizer;
    }
  ) {}

  async createDraft(
    input: Omit<BroadcastDraftInput, "createdByUserId"> & {
      actorUserId: string;
    }
  ): Promise<BroadcastRecord> {
    if (!(await this.canCreate(input.actorUserId))) {
      throw new Error("broadcast create access denied");
    }
    return this.deps.broadcasts.createDraft({
      ...input,
      createdByUserId: input.actorUserId
    });
  }

  async updateDraft(
    input: BroadcastUpdateInput & {
      actorUserId: string;
    }
  ): Promise<BroadcastRecord> {
    if (!(await this.canUpdate(input.actorUserId, input.id))) {
      throw new Error("broadcast update access denied");
    }
    return this.deps.broadcasts.updateDraft(input);
  }

  async publish(input: { actorUserId: string; broadcastId: string }): Promise<BroadcastRecord> {
    if (!(await this.canPublish(input.actorUserId, input.broadcastId))) {
      throw new Error("broadcast publish access denied");
    }
    const broadcast = await this.deps.broadcasts.publish({
      id: input.broadcastId,
      publishedByUserId: input.actorUserId
    });
    const recipientUserIds = await this.resolveRecipients(broadcast.targets);

    if (recipientUserIds.length > 0 && this.deps.inboxProjection) {
      const projectionInput: CollaborationInboxProjectionInput = {
        eventType: "broadcast.published",
        actorUserId: input.actorUserId,
        recipientUserIds,
        title: broadcast.title,
        body: broadcast.bodyMarkdown,
        relatedEntityType: "broadcast_message",
        relatedEntityId: broadcast.id,
        payload: { broadcastId: broadcast.id },
        category: "broadcast"
      };
      await this.deps.inboxProjection.projectCollaborationEvent(projectionInput);
    }

    if (broadcast.dingtalkDeliveryEnabled) {
      await this.deps.notifications?.dispatchBroadcast?.({
        broadcast,
        recipientUserIds
      });
    }

    return broadcast;
  }

  private async canPublish(actorUserId: string, broadcastId: string): Promise<boolean> {
    if (!this.deps.authorizer?.canPublishBroadcast) {
      return true;
    }
    return this.deps.authorizer.canPublishBroadcast({ actorUserId, broadcastId });
  }

  private async canCreate(actorUserId: string): Promise<boolean> {
    if (!this.deps.authorizer?.canCreateBroadcast) {
      return true;
    }
    return this.deps.authorizer.canCreateBroadcast({ actorUserId });
  }

  private async canUpdate(actorUserId: string, broadcastId: string): Promise<boolean> {
    if (!this.deps.authorizer?.canUpdateBroadcast) {
      return true;
    }
    return this.deps.authorizer.canUpdateBroadcast({ actorUserId, broadcastId });
  }

  private async resolveRecipients(targets: BroadcastTargetRecord[]): Promise<string[]> {
    const recipients: string[] = [];
    for (const target of targets) {
      if (target.targetType === "all_users") {
        recipients.push(...((await this.deps.recipientDirectory?.listAllUserIds?.()) ?? []));
        continue;
      }
      if (target.targetType === "department") {
        recipients.push(...((await this.deps.recipientDirectory?.listUserIdsForDepartment?.(target.targetId ?? "")) ?? []));
        continue;
      }
      recipients.push(...((await this.deps.recipientDirectory?.listUserIdsForRole?.(target.targetId ?? "")) ?? []));
    }
    return uniqueUserIds(recipients);
  }
}
