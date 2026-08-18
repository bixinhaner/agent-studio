import { appConfig } from "../config.js";
import { getDbClient } from "../db/client.js";
import { PublicBrandKnowledgeProjectionService } from "../public-brands/knowledge-projection.js";
import { FilesystemKnowledgeSetStorage } from "../resources/storage/filesystem-knowledge-set-storage.js";
import { SystemSettingsRepository } from "../system-settings/repository.js";
import { createDefaultSystemSettingsPayload } from "../system-settings/types.js";

const BAILEY_HOSTS = ["bailey.baicells.com", "aiagent.indonesiacentral.cloudapp.azure.com"];

function emailAddress(value: string | undefined): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  const bracketed = input.match(/<([^>]+)>/);
  return (bracketed?.[1] ?? input).trim() || undefined;
}

async function main() {
  const db = getDbClient();
  try {
    const settings = new SystemSettingsRepository(db);
    const published = await settings.getCurrentPublished();
    const payload = published?.payload ?? createDefaultSystemSettingsPayload();
    const plans = await db.subscriptionPlan.findMany({ where: { status: "active" }, select: { id: true } });
    const fromAddress = emailAddress(appConfig.authEmail.from);
    const stripe = await db.integrationInstance.findUnique({
      where: { type_slug: { type: "stripe", slug: "billing-stripe" } },
      include: { secret: true }
    });

    const bailey = await db.publicBrand.upsert({
      where: { key: "bailey" },
      create: {
        key: "bailey",
        name: "Bailey",
        status: "active",
        primaryBaseUrl: "https://bailey.baicells.com",
        primaryColor: "#FF4614",
        accentColor: "#FF833D",
        platformName: payload.branding.platformName,
        headerSubtitle: payload.branding.headerSubtitle,
        externalLoginCopy: payload.branding.externalLoginCopy,
        logoUrl: payload.branding.logoUrl || null,
        iconUrl: payload.branding.iconUrl || null,
        loginBackgroundUrl: payload.branding.loginBackgroundUrl || null,
        portalWelcomeIllustrationUrl: payload.branding.portalWelcomeIllustrationUrl || null,
        assistantName: payload.branding.assistantName,
        assistantAvatarUrl: payload.branding.assistantAvatarUrl || null,
        portalWelcomeMessageDesktop: payload.behavior.portalWelcomeMessageDesktop,
        portalWelcomeMessageMobile: payload.behavior.portalWelcomeMessageMobile,
        portalWelcomeSuggestions: payload.behavior.portalWelcomeSuggestions,
        answerFeedbackEnabled: payload.behavior.answerFeedback.enabledForExternalUsers,
        answerFeedbackPrompt: payload.behavior.answerFeedback.prompt,
        externalOnly: false,
        accessRequestEnabled: true,
        accessSalesContactLabel: "Baicells Sales Contact",
        billingEnabled: true,
        billingSuccessUrl: "https://bailey.baicells.com/?billing=success",
        billingCancelUrl: "https://bailey.baicells.com/?billing=cancel",
        billingPortalUrl: "https://bailey.baicells.com/?billing=manage",
        emailFromName: payload.branding.platformName,
        emailFromAddress: fromAddress,
        emailSenderVerified: Boolean(appConfig.authEmail.host && fromAddress),
        billingMerchantName: "Bailey",
        paymentAccountMode: "shared",
        paymentAccountReady: Boolean(stripe?.secret?.hasSecrets),
        resourceBindingMode: "organization_policy",
        knowledgeIsolationMode: "direct",
        outputProtectionEnabled: false,
        subscriptionPlanIds: plans.map((plan) => plan.id)
      },
      update: {
        status: "active",
        resourceBindingMode: "organization_policy",
        emailFromAddress: fromAddress,
        emailSenderVerified: Boolean(appConfig.authEmail.host && fromAddress),
        paymentAccountReady: Boolean(stripe?.secret?.hasSecrets),
        subscriptionPlanIds: plans.map((plan) => plan.id)
      }
    });

    for (const [index, hostname] of BAILEY_HOSTS.entries()) {
      await db.publicBrandDomain.upsert({
        where: { hostname },
        create: { publicBrandId: bailey.id, hostname, status: "active", isPrimary: index === 0 },
        update: { publicBrandId: bailey.id, status: "active", isPrimary: index === 0 }
      });
    }

    const ranley = await db.publicBrand.findUnique({ where: { key: "ranley" } });
    if (ranley) {
      await db.publicBrand.update({
        where: { id: ranley.id },
        data: {
          accessSalesContactLabel: "CloudRAN.AI Sales Contact",
          supportEmail: "support@cloud-ran.ai",
          supportUrl: "https://cloud-ran.ai",
          emailFromName: "Ranley",
          emailFromAddress: "support@cloud-ran.ai",
          emailReplyTo: "support@cloud-ran.ai",
          emailSenderVerified: false,
          billingMerchantName: "Ranley",
          billingSupportEmail: "support@cloud-ran.ai",
          paymentAccountMode: "shared",
          paymentAccountReady: false,
          resourceBindingMode: "brand_managed",
          knowledgeIsolationMode: "brand_projection",
          knowledgeReplacementRules: [
            { source: "Baicells", target: "CloudRAN.AI", mode: "replace" },
            { source: "Bailey", target: "Ranley", mode: "replace" },
            { source: "Agent Studio", target: "Ranley", mode: "replace" }
          ],
          knowledgeProjectionStatus: "pending",
          outputProtectionEnabled: true,
          outputForbiddenTerms: ["Baicells", "Bailey", "Agent Studio"]
        }
      });
    }

    const [organizations, accessRequests, loginChallenges] = await db.$transaction([
      db.organization.updateMany({ where: { publicBrandId: null }, data: { publicBrandId: bailey.id } }),
      db.accessRequest.updateMany({ where: { publicBrandId: null }, data: { publicBrandId: bailey.id } }),
      db.loginChallenge.updateMany({ where: { publicBrandId: null }, data: { publicBrandId: bailey.id } })
    ]);

    const projection = ranley
      ? await new PublicBrandKnowledgeProjectionService(
          db,
          new FilesystemKnowledgeSetStorage(appConfig.knowledgeSetStorageRoot)
        ).regenerate(ranley.id)
      : null;

    console.log(JSON.stringify({
      ok: true,
      bailey: { id: bailey.id, domains: BAILEY_HOSTS },
      ranley: ranley ? { id: ranley.id, projection } : null,
      migrated: { organizations: organizations.count, accessRequests: accessRequests.count, loginChallenges: loginChallenges.count }
    }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
