import type { Prisma, PrismaClient } from "@prisma/client";

import {
  publicBrandInputSchema,
  type PublicBrandInput,
  type PublicBrandReadiness,
  type PublicBrandRecord
} from "./types.js";

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)))
    : [];
}

function welcomeSuggestions(value: unknown): Array<{ label: string; prompt: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const label = trimOrUndefined((item as { label?: string }).label);
    const prompt = trimOrUndefined((item as { prompt?: string }).prompt);
    return label && prompt ? [{ label, prompt }] : [];
  });
}

type BrandRow = Prisma.PublicBrandGetPayload<{
  include: {
    domains: true;
    organizations: { select: { id: true } };
  };
}>;

function mapBrand(row: NonNullable<BrandRow>): PublicBrandRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    status: row.status,
    primaryBaseUrl: trimOrUndefined(row.primaryBaseUrl),
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    platformName: row.platformName,
    headerSubtitle: row.headerSubtitle,
    externalLoginCopy: row.externalLoginCopy,
    logoUrl: trimOrUndefined(row.logoUrl),
    iconUrl: trimOrUndefined(row.iconUrl),
    loginBackgroundUrl: trimOrUndefined(row.loginBackgroundUrl),
    portalWelcomeIllustrationUrl: trimOrUndefined(row.portalWelcomeIllustrationUrl),
    assistantName: row.assistantName,
    assistantAvatarUrl: trimOrUndefined(row.assistantAvatarUrl),
    portalWelcomeMessageDesktop: row.portalWelcomeMessageDesktop,
    portalWelcomeMessageMobile: row.portalWelcomeMessageMobile,
    portalWelcomeSuggestions: welcomeSuggestions(row.portalWelcomeSuggestions),
    answerFeedbackEnabled: row.answerFeedbackEnabled,
    answerFeedbackPrompt: row.answerFeedbackPrompt,
    externalOnly: row.externalOnly,
    accessRequestEnabled: row.accessRequestEnabled,
    billingEnabled: row.billingEnabled,
    billingSuccessUrl: trimOrUndefined(row.billingSuccessUrl),
    billingCancelUrl: trimOrUndefined(row.billingCancelUrl),
    billingPortalUrl: trimOrUndefined(row.billingPortalUrl),
    agentModeId: trimOrUndefined(row.agentModeId),
    knowledgeSetIds: stringArray(row.knowledgeSetIds),
    subscriptionPlanIds: stringArray(row.subscriptionPlanIds),
    createdByUserId: trimOrUndefined(row.createdByUserId),
    updatedByUserId: trimOrUndefined(row.updatedByUserId),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    domains: (row.domains ?? []).map((domain) => ({
      id: domain.id,
      hostname: domain.hostname,
      status: domain.status,
      isPrimary: domain.isPrimary,
      createdAt: toIsoString(domain.createdAt),
      updatedAt: toIsoString(domain.updatedAt)
    })),
    organizationIds: (row.organizations ?? []).map((organization) => organization.id)
  };
}

function brandData(input: PublicBrandInput, actorUserId: string) {
  return {
    key: input.key,
    name: input.name,
    status: input.status,
    primaryBaseUrl: input.primaryBaseUrl,
    primaryColor: input.primaryColor.toUpperCase(),
    accentColor: input.accentColor.toUpperCase(),
    platformName: input.platformName,
    headerSubtitle: input.headerSubtitle,
    externalLoginCopy: input.externalLoginCopy,
    logoUrl: input.logoUrl,
    iconUrl: input.iconUrl,
    loginBackgroundUrl: input.loginBackgroundUrl,
    portalWelcomeIllustrationUrl: input.portalWelcomeIllustrationUrl,
    assistantName: input.assistantName,
    assistantAvatarUrl: input.assistantAvatarUrl,
    portalWelcomeMessageDesktop: input.portalWelcomeMessageDesktop,
    portalWelcomeMessageMobile: input.portalWelcomeMessageMobile,
    portalWelcomeSuggestions: input.portalWelcomeSuggestions,
    answerFeedbackEnabled: input.answerFeedbackEnabled,
    answerFeedbackPrompt: input.answerFeedbackPrompt,
    externalOnly: input.externalOnly,
    accessRequestEnabled: input.accessRequestEnabled,
    billingEnabled: input.billingEnabled,
    billingSuccessUrl: input.billingSuccessUrl,
    billingCancelUrl: input.billingCancelUrl,
    billingPortalUrl: input.billingPortalUrl,
    agentModeId: input.agentModeId,
    knowledgeSetIds: input.knowledgeSetIds,
    subscriptionPlanIds: input.subscriptionPlanIds,
    updatedByUserId: actorUserId
  };
}

export function normalizeRequestHostname(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value.split(",")[0]?.trim().toLowerCase() : "";
  if (!raw) return undefined;
  try {
    return new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

export class PublicBrandService {
  constructor(private readonly db: PrismaClient) {}

  async resolveByHostname(hostname: string | undefined): Promise<PublicBrandRecord | undefined> {
    const normalized = normalizeRequestHostname(hostname);
    if (!normalized) return undefined;
    const row = await this.db.publicBrand.findFirst({
      where: {
        status: "active",
        domains: { some: { hostname: normalized, status: "active" } }
      },
      include: { domains: { orderBy: [{ isPrimary: "desc" }, { hostname: "asc" }] }, organizations: { select: { id: true } } }
    });
    return row ? mapBrand(row) : undefined;
  }

  async getById(id: string | null | undefined): Promise<PublicBrandRecord | undefined> {
    const normalized = trimOrUndefined(id);
    if (!normalized) return undefined;
    const row = await this.db.publicBrand.findUnique({
      where: { id: normalized },
      include: { domains: { orderBy: [{ isPrimary: "desc" }, { hostname: "asc" }] }, organizations: { select: { id: true } } }
    });
    return row ? mapBrand(row) : undefined;
  }

  async getForOrganization(organizationId: string | null | undefined): Promise<PublicBrandRecord | undefined> {
    const normalized = trimOrUndefined(organizationId);
    if (!normalized) return undefined;
    const organization = await this.db.organization.findUnique({
      where: { id: normalized },
      select: { publicBrandId: true }
    });
    return this.getById(organization?.publicBrandId);
  }

  async list(): Promise<PublicBrandRecord[]> {
    const rows = await this.db.publicBrand.findMany({
      include: { domains: { orderBy: [{ isPrimary: "desc" }, { hostname: "asc" }] }, organizations: { select: { id: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });
    return rows.map((row) => mapBrand(row));
  }

  async create(input: unknown, actorUserId: string): Promise<PublicBrandRecord> {
    const parsed = publicBrandInputSchema.parse(input);
    const created = await this.db.$transaction(async (tx) => {
      await this.validateBindings(tx, parsed);
      const brand = await tx.publicBrand.create({
        data: {
          ...brandData(parsed, actorUserId),
          createdByUserId: actorUserId,
          domains: { create: parsed.domains }
        }
      });
      if (parsed.organizationIds.length) {
        await tx.organization.updateMany({
          where: { id: { in: parsed.organizationIds }, type: "customer" },
          data: { publicBrandId: brand.id }
        });
      }
      return brand;
    });
    return (await this.getById(created.id))!;
  }

  async update(id: string, input: unknown, actorUserId: string): Promise<PublicBrandRecord> {
    const brandId = trimOrUndefined(id);
    if (!brandId) throw new Error("Brand does not exist");
    const parsed = publicBrandInputSchema.parse(input);
    await this.db.$transaction(async (tx) => {
      const existing = await tx.publicBrand.findUnique({ where: { id: brandId } });
      if (!existing) throw new Error("Brand does not exist");
      await this.validateBindings(tx, parsed);
      await tx.publicBrand.update({ where: { id: brandId }, data: brandData(parsed, actorUserId) });
      await tx.publicBrandDomain.deleteMany({ where: { publicBrandId: brandId } });
      await tx.publicBrandDomain.createMany({
        data: parsed.domains.map((domain) => ({ ...domain, publicBrandId: brandId }))
      });
      await tx.organization.updateMany({
        where: { publicBrandId: brandId, ...(parsed.organizationIds.length ? { id: { notIn: parsed.organizationIds } } : {}) },
        data: { publicBrandId: null }
      });
      if (parsed.organizationIds.length) {
        await tx.organization.updateMany({
          where: { id: { in: parsed.organizationIds }, type: "customer" },
          data: { publicBrandId: brandId }
        });
      }
    });
    return (await this.getById(brandId))!;
  }

  async readiness(brand: PublicBrandRecord): Promise<PublicBrandReadiness> {
    const [agentMode, knowledgeSetCount, planCount] = await Promise.all([
      brand.agentModeId
        ? this.db.agentMode.findFirst({ where: { id: brand.agentModeId, status: "active", visibleToUsers: true }, select: { id: true } })
        : Promise.resolve(null),
      brand.knowledgeSetIds.length
        ? this.db.knowledgeSet.count({ where: { id: { in: brand.knowledgeSetIds }, status: "active" } })
        : Promise.resolve(0),
      brand.subscriptionPlanIds.length
        ? this.db.subscriptionPlan.count({ where: { id: { in: brand.subscriptionPlanIds }, status: "active" } })
        : Promise.resolve(0)
    ]);
    const checks = [
      { key: "domain", ok: brand.domains.some((domain) => domain.status === "active" && domain.isPrimary), detail: "Active primary domain" },
      { key: "branding", ok: Boolean(brand.logoUrl && brand.assistantAvatarUrl), detail: "Logo and assistant avatar" },
      { key: "agent", ok: Boolean(agentMode), detail: "Active customer-visible agent" },
      {
        key: "knowledge",
        ok: brand.knowledgeSetIds.length > 0 && knowledgeSetCount === brand.knowledgeSetIds.length,
        detail: "Active knowledge sets"
      },
      {
        key: "plans",
        ok: brand.subscriptionPlanIds.length > 0 && planCount === brand.subscriptionPlanIds.length,
        detail: "Active subscription plans"
      },
      { key: "urls", ok: Boolean(brand.primaryBaseUrl), detail: "Primary public URL" }
    ];
    return { ready: checks.every((check) => check.ok), checks };
  }

  async listWithReadiness() {
    const brands = await this.list();
    return Promise.all(brands.map(async (brand) => ({ ...brand, readiness: await this.readiness(brand) })));
  }

  async lookups() {
    const [agentModes, knowledgeSets, plans, organizations] = await Promise.all([
      this.db.agentMode.findMany({ where: { status: "active", visibleToUsers: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
      this.db.knowledgeSet.findMany({ where: { status: "active" }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
      this.db.subscriptionPlan.findMany({ where: { status: "active" }, select: { id: true, name: true, slug: true, billingStatus: true }, orderBy: { name: "asc" } }),
      this.db.organization.findMany({ where: { type: "customer" }, select: { id: true, name: true, slug: true, publicBrandId: true, status: true }, orderBy: { name: "asc" } })
    ]);
    return { agentModes, knowledgeSets, plans, organizations };
  }

  private async validateBindings(db: Prisma.TransactionClient, input: PublicBrandInput): Promise<void> {
    const [agentMode, knowledgeSetCount, planCount, organizationCount] = await Promise.all([
      input.agentModeId ? db.agentMode.findUnique({ where: { id: input.agentModeId }, select: { id: true } }) : Promise.resolve(null),
      input.knowledgeSetIds.length ? db.knowledgeSet.count({ where: { id: { in: input.knowledgeSetIds } } }) : Promise.resolve(0),
      input.subscriptionPlanIds.length ? db.subscriptionPlan.count({ where: { id: { in: input.subscriptionPlanIds } } }) : Promise.resolve(0),
      input.organizationIds.length ? db.organization.count({ where: { id: { in: input.organizationIds }, type: "customer" } }) : Promise.resolve(0)
    ]);
    if (input.agentModeId && !agentMode) throw new Error("Selected agent mode does not exist");
    if (knowledgeSetCount !== input.knowledgeSetIds.length) throw new Error("One or more knowledge sets do not exist");
    if (planCount !== input.subscriptionPlanIds.length) throw new Error("One or more subscription plans do not exist");
    if (organizationCount !== input.organizationIds.length) throw new Error("One or more customer organizations do not exist");
  }
}
