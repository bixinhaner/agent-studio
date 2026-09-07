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

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))
  );
}

function replacementRules(value: unknown): PublicBrandRecord["knowledgeReplacementRules"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = trimOrUndefined((item as { source?: string }).source);
    const target = typeof (item as { target?: unknown }).target === "string" ? (item as { target: string }).target.trim() : "";
    const mode = (item as { mode?: unknown }).mode;
    return source && (mode === "replace" || mode === "remove") ? [{ source, target, mode }] : [];
  });
}

type ProjectionServiceLike = {
  ensure(brand: PublicBrandRecord): Promise<PublicBrandRecord>;
  regenerate(brandId: string): Promise<unknown>;
};

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
    organizations: { select: { id: true; type: true } };
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
    portalDefaultLocale: (["en", "zh-CN"] as string[]).includes(row.portalDefaultLocale)
      ? row.portalDefaultLocale as PublicBrandRecord["portalDefaultLocale"]
      : "browser",
    portalLanguageSwitcherEnabled: row.portalLanguageSwitcherEnabled,
    answerFeedbackEnabled: row.answerFeedbackEnabled,
    answerFeedbackPrompt: row.answerFeedbackPrompt,
    externalOnly: row.externalOnly,
    employeeEmailDomains: stringArray(row.employeeEmailDomains),
    employeeOrganizationId: trimOrUndefined(row.employeeOrganizationId),
    accessRequestEnabled: row.accessRequestEnabled,
    accessSalesContactLabel: row.accessSalesContactLabel,
    billingEnabled: row.billingEnabled,
    billingSuccessUrl: trimOrUndefined(row.billingSuccessUrl),
    billingCancelUrl: trimOrUndefined(row.billingCancelUrl),
    billingPortalUrl: trimOrUndefined(row.billingPortalUrl),
    supportEmail: trimOrUndefined(row.supportEmail),
    supportUrl: trimOrUndefined(row.supportUrl),
    privacyUrl: trimOrUndefined(row.privacyUrl),
    termsUrl: trimOrUndefined(row.termsUrl),
    emailFromName: row.emailFromName,
    emailFromAddress: trimOrUndefined(row.emailFromAddress),
    emailReplyTo: trimOrUndefined(row.emailReplyTo),
    emailSenderVerified: row.emailSenderVerified,
    billingMerchantName: trimOrUndefined(row.billingMerchantName),
    billingSupportEmail: trimOrUndefined(row.billingSupportEmail),
    paymentAccountMode: row.paymentAccountMode === "connected" ? "connected" : "shared",
    paymentStripeAccountId: trimOrUndefined(row.paymentStripeAccountId),
    paymentAccountReady: row.paymentAccountReady,
    resourceBindingMode: row.resourceBindingMode === "organization_policy" ? "organization_policy" : "brand_managed",
    agentModeId: trimOrUndefined(row.agentModeId),
    knowledgeSetIds: stringArray(row.knowledgeSetIds),
    knowledgeIsolationMode: row.knowledgeIsolationMode === "brand_projection" ? "brand_projection" : "direct",
    knowledgeReplacementRules: replacementRules(row.knowledgeReplacementRules),
    knowledgeProjectionStorage: stringMap(row.knowledgeProjectionStorage),
    knowledgeProjectionStatus: (["pending", "building", "ready", "failed"] as string[]).includes(row.knowledgeProjectionStatus)
      ? row.knowledgeProjectionStatus as PublicBrandRecord["knowledgeProjectionStatus"]
      : "not_required",
    knowledgeProjectionItemCount: row.knowledgeProjectionItemCount,
    knowledgeProjectionAt: row.knowledgeProjectionAt?.toISOString(),
    knowledgeProjectionError: trimOrUndefined(row.knowledgeProjectionError),
    outputProtectionEnabled: row.outputProtectionEnabled,
    outputForbiddenTerms: stringArray(row.outputForbiddenTerms),
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
    organizationIds: (row.organizations ?? [])
      .filter((organization) => organization.type === "customer" && organization.id !== row.employeeOrganizationId)
      .map((organization) => organization.id)
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
    portalDefaultLocale: input.portalDefaultLocale,
    portalLanguageSwitcherEnabled: input.portalLanguageSwitcherEnabled,
    answerFeedbackEnabled: input.answerFeedbackEnabled,
    answerFeedbackPrompt: input.answerFeedbackPrompt,
    externalOnly: input.externalOnly,
    employeeEmailDomains: input.employeeEmailDomains,
    accessRequestEnabled: input.accessRequestEnabled,
    accessSalesContactLabel: input.accessSalesContactLabel,
    billingEnabled: input.billingEnabled,
    billingSuccessUrl: input.billingSuccessUrl,
    billingCancelUrl: input.billingCancelUrl,
    billingPortalUrl: input.billingPortalUrl,
    supportEmail: input.supportEmail,
    supportUrl: input.supportUrl,
    privacyUrl: input.privacyUrl,
    termsUrl: input.termsUrl,
    emailFromName: input.emailFromName,
    emailFromAddress: input.emailFromAddress,
    emailReplyTo: input.emailReplyTo,
    billingMerchantName: input.billingMerchantName,
    billingSupportEmail: input.billingSupportEmail,
    paymentAccountMode: input.paymentAccountMode,
    paymentStripeAccountId: input.paymentStripeAccountId,
    paymentAccountReady: input.paymentAccountReady,
    resourceBindingMode: input.resourceBindingMode,
    agentModeId: input.agentModeId,
    knowledgeSetIds: input.knowledgeSetIds,
    knowledgeIsolationMode: input.knowledgeIsolationMode,
    knowledgeReplacementRules: input.knowledgeReplacementRules,
    knowledgeProjectionStatus: input.knowledgeIsolationMode === "brand_projection" ? "pending" : "not_required",
    knowledgeProjectionStorage: input.knowledgeIsolationMode === "brand_projection" ? undefined : {},
    knowledgeProjectionItemCount: input.knowledgeIsolationMode === "brand_projection" ? undefined : 0,
    knowledgeProjectionAt: input.knowledgeIsolationMode === "brand_projection" ? undefined : null,
    knowledgeProjectionError: null,
    outputProtectionEnabled: input.outputProtectionEnabled,
    outputForbiddenTerms: input.outputForbiddenTerms,
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
  private projection?: ProjectionServiceLike;

  constructor(private readonly db: PrismaClient) {}

  setProjectionService(projection: ProjectionServiceLike): void {
    this.projection = projection;
  }

  async ensureKnowledgeProjection(brand: PublicBrandRecord): Promise<PublicBrandRecord> {
    return this.projection?.ensure(brand) ?? brand;
  }

  async regenerateKnowledgeProjection(brandId: string): Promise<PublicBrandRecord> {
    if (!this.projection) throw new Error("Brand knowledge projection is not configured");
    await this.projection.regenerate(brandId);
    const brand = await this.getById(brandId);
    if (!brand) throw new Error("Brand does not exist");
    return brand;
  }

  async resolveByHostname(hostname: string | undefined): Promise<PublicBrandRecord | undefined> {
    const normalized = normalizeRequestHostname(hostname);
    if (!normalized) return undefined;
    const row = await this.db.publicBrand.findFirst({
      where: {
        status: "active",
        domains: { some: { hostname: normalized, status: "active" } }
      },
      include: { domains: { orderBy: [{ isPrimary: "desc" }, { hostname: "asc" }] }, organizations: { select: { id: true, type: true } } }
    });
    return row ? mapBrand(row) : undefined;
  }

  async getById(id: string | null | undefined): Promise<PublicBrandRecord | undefined> {
    const normalized = trimOrUndefined(id);
    if (!normalized) return undefined;
    const row = await this.db.publicBrand.findUnique({
      where: { id: normalized },
      include: { domains: { orderBy: [{ isPrimary: "desc" }, { hostname: "asc" }] }, organizations: { select: { id: true, type: true } } }
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
      include: { domains: { orderBy: [{ isPrimary: "desc" }, { hostname: "asc" }] }, organizations: { select: { id: true, type: true } } },
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
          emailSenderVerified: false,
          createdByUserId: actorUserId,
          domains: { create: parsed.domains }
        }
      });
      await this.ensureEmployeeOrganization(tx, {
        brandId: brand.id,
        brandKey: brand.key,
        brandName: brand.name,
        employeeEmailDomains: parsed.employeeEmailDomains
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
      const emailAddressChanged = trimOrUndefined(existing.emailFromAddress)?.toLowerCase() !== trimOrUndefined(parsed.emailFromAddress)?.toLowerCase();
      await tx.publicBrand.update({
        where: { id: brandId },
        data: {
          ...brandData(parsed, actorUserId),
          emailSenderVerified: emailAddressChanged ? false : existing.emailSenderVerified
        }
      });
      const employeeOrganizationId = await this.ensureEmployeeOrganization(tx, {
        brandId,
        brandKey: parsed.key,
        brandName: parsed.name,
        employeeEmailDomains: parsed.employeeEmailDomains,
        existingOrganizationId: existing.employeeOrganizationId
      });
      if (emailAddressChanged) {
        await tx.publicBrandEmailTransport.updateMany({
          where: { publicBrandId: brandId },
          data: {
            verificationStatus: "pending",
            smtpConnected: false,
            senderAccepted: false,
            deliveryAccepted: false,
            lastTestError: null,
            updatedByUserId: actorUserId
          }
        });
      }
      await tx.publicBrandDomain.deleteMany({ where: { publicBrandId: brandId } });
      await tx.publicBrandDomain.createMany({
        data: parsed.domains.map((domain) => ({ ...domain, publicBrandId: brandId }))
      });
      await tx.organization.updateMany({
        where: {
          publicBrandId: brandId,
          type: "customer",
          id: { notIn: [...parsed.organizationIds, ...(employeeOrganizationId ? [employeeOrganizationId] : [])] }
        },
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
      { key: "domain", ok: brand.domains.some((domain) => domain.status === "active" && domain.isPrimary), detail: "域名与证书" },
      { key: "branding", ok: Boolean(brand.logoUrl && brand.assistantAvatarUrl), detail: "入口体验" },
      { key: "agent", ok: brand.resourceBindingMode === "organization_policy" || Boolean(agentMode), detail: "客户智能体" },
      {
        key: "knowledge",
        ok: brand.resourceBindingMode === "organization_policy" || (brand.knowledgeSetIds.length > 0 && knowledgeSetCount === brand.knowledgeSetIds.length),
        detail: "资料来源"
      },
      {
        key: "projection",
        ok: brand.knowledgeIsolationMode === "direct" || brand.knowledgeProjectionStatus === "ready",
        detail: "资料投影"
      },
      {
        key: "output",
        ok: !brand.outputProtectionEnabled || brand.outputForbiddenTerms.length > 0,
        detail: "输出保护"
      },
      {
        key: "plans",
        ok: brand.subscriptionPlanIds.length > 0 && planCount === brand.subscriptionPlanIds.length,
        detail: "计费套餐"
      },
      { key: "email", ok: Boolean(brand.emailSenderVerified && brand.emailFromAddress), detail: "邮件发送通道" },
      { key: "payment", ok: !brand.billingEnabled || Boolean(brand.paymentAccountReady && brand.billingMerchantName), detail: "支付商户" },
      { key: "urls", ok: Boolean(brand.primaryBaseUrl), detail: "公开入口地址" }
    ];
    return { ready: checks.every((check) => check.ok), checks };
  }

  async listWithReadiness() {
    const brands = await this.list();
    return Promise.all(brands.map(async (brand) => ({ ...brand, readiness: await this.readiness(brand) })));
  }

  async lookups() {
    const [agentModes, knowledgeSets, plans, organizations, employeeBrands] = await Promise.all([
      this.db.agentMode.findMany({ where: { status: "active", visibleToUsers: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
      this.db.knowledgeSet.findMany({ where: { status: "active" }, select: { id: true, name: true, slug: true, _count: { select: { items: true } } }, orderBy: { name: "asc" } }),
      this.db.subscriptionPlan.findMany({ where: { status: "active" }, select: { id: true, name: true, slug: true, billingStatus: true }, orderBy: { name: "asc" } }),
      this.db.organization.findMany({ where: { type: "customer" }, select: { id: true, name: true, slug: true, publicBrandId: true, status: true }, orderBy: { name: "asc" } }),
      this.db.publicBrand.findMany({ where: { employeeOrganizationId: { not: null } }, select: { employeeOrganizationId: true } })
    ]);
    const employeeOrganizationIds = new Set(employeeBrands.map((brand) => brand.employeeOrganizationId).filter(Boolean));
    return {
      agentModes,
      knowledgeSets: knowledgeSets.map(({ _count, ...knowledgeSet }) => ({ ...knowledgeSet, itemCount: _count.items })),
      plans,
      organizations: organizations.filter((organization) => !employeeOrganizationIds.has(organization.id))
    };
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

  private async ensureEmployeeOrganization(
    db: Prisma.TransactionClient,
    input: {
      brandId: string;
      brandKey: string;
      brandName: string;
      employeeEmailDomains: string[];
      existingOrganizationId?: string | null;
    }
  ): Promise<string | undefined> {
    const existingOrganizationId = trimOrUndefined(input.existingOrganizationId);
    if (input.employeeEmailDomains.length === 0) return existingOrganizationId;

    if (existingOrganizationId) {
      const existing = await db.organization.findUnique({ where: { id: existingOrganizationId } });
      if (!existing || existing.publicBrandId !== input.brandId) {
        throw new Error("Brand employee organization is unavailable");
      }
      if (existing.status !== "active") {
        await db.organization.update({ where: { id: existing.id }, data: { status: "active" } });
      }
      return existing.id;
    }

    const slug = `${input.brandKey}-employees`;
    const sameSlug = await db.organization.findUnique({ where: { slug } });
    if (sameSlug && sameSlug.publicBrandId !== input.brandId) {
      throw new Error(`Organization slug ${slug} is already in use`);
    }
    const organization = sameSlug ?? await db.organization.create({
      data: {
        slug,
        name: `${input.brandName} Employees`,
        type: "customer",
        status: "active",
        publicBrandId: input.brandId,
        settingsJson: { managedPurpose: "brand_employee" }
      }
    });
    await db.publicBrand.update({
      where: { id: input.brandId },
      data: { employeeOrganizationId: organization.id }
    });
    return organization.id;
  }
}
