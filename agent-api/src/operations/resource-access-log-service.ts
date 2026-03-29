import type {
  CreateResourceAccessLogInput,
  ResourceAccessLogRecord,
  ResourceAccessLogRepository
} from "../persistence/resource-access-log-repository.js";

export class ResourceAccessLogService {
  constructor(private readonly repository: Pick<ResourceAccessLogRepository, "create">) {}

  async record(input: CreateResourceAccessLogInput): Promise<ResourceAccessLogRecord> {
    return this.repository.create(input);
  }
}
