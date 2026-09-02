import fs from "node:fs/promises";
import path from "node:path";

import { getDbClient } from "../db/client.js";

const BRAND_KEY = "ranley";
const HOSTNAME = "ranley.cloud-ran.ai";
const BASE_URL = `https://${HOSTNAME}`;
const PLAN_SLUGS = [
  "trial-for-plus",
  "primary-annual",
  "plus-annual",
  "pro-annual"
];

async function main() {
  const db = getDbClient();
  try {
    const [agentMode, knowledgeSet, plans, prompt] = await Promise.all([
      db.agentMode.findFirst({ where: { slug: "ranley", status: "active" }, select: { id: true, name: true } }),
      db.knowledgeSet.findFirst({ where: { slug: "crai-docs", status: "active" }, select: { id: true, name: true } }),
      db.subscriptionPlan.findMany({
        where: { slug: { in: PLAN_SLUGS }, status: "active" },
        select: { id: true, slug: true, name: true }
      }),
      fs.readFile(path.resolve(process.cwd(), "templates", "agents-md", "ranley.md"), "utf8")
    ]);

    if (!agentMode) throw new Error("Active agent mode 'ranley' does not exist");
    if (!knowledgeSet) throw new Error("Active knowledge set 'crai-docs' does not exist");
    const foundPlanSlugs = new Set(plans.map((plan) => plan.slug));
    const missingPlanSlugs = PLAN_SLUGS.filter((slug) => !foundPlanSlugs.has(slug));
    if (missingPlanSlugs.length) {
      throw new Error(`Active subscription plans do not exist: ${missingPlanSlugs.join(", ")}`);
    }

    const brand = await db.$transaction(async (tx) => {
      const saved = await tx.publicBrand.upsert({
        where: { key: BRAND_KEY },
        create: {
          key: BRAND_KEY,
          name: "Ranley",
          status: "active",
          primaryBaseUrl: BASE_URL,
          primaryColor: "#0066FF",
          accentColor: "#2CCFF0",
          platformName: "Ranley",
          headerSubtitle: "CloudRAN Technical Support",
          externalLoginCopy: "Sign in with your work email to access Ranley technical support.",
          logoUrl: "/brands/ranley/ranley-logo.png",
          iconUrl: "/brands/ranley/assistant.png",
          portalWelcomeIllustrationUrl: "/brands/ranley/assistant.png",
          assistantName: "Ranley",
          assistantAvatarUrl: "/brands/ranley/assistant.png",
          portalWelcomeMessageDesktop: "Hello, I'm {{assistantName}}, your CloudRAN technical support assistant. How can I help?",
          portalWelcomeMessageMobile: "Ask Ranley about CloudRAN products, deployment, or troubleshooting.",
          portalWelcomeSuggestions: [
            { label: "Check product fit", prompt: "Help me identify the right CloudRAN product and version for this deployment scenario." },
            { label: "Review deployment", prompt: "Review this CloudRAN deployment plan and identify risks, missing prerequisites, and verification steps." },
            { label: "Troubleshoot an issue", prompt: "Help me troubleshoot this CloudRAN alarm, KPI, log, or service symptom." },
            { label: "Prepare escalation", prompt: "Help me organize the technical details needed to escalate this issue to CloudRAN support." }
          ],
          answerFeedbackEnabled: true,
          answerFeedbackPrompt: "Was this answer helpful?",
          externalOnly: true,
          employeeEmailDomains: ["cloud-ran.ai"],
          accessRequestEnabled: true,
          billingEnabled: true,
          billingSuccessUrl: `${BASE_URL}/?billing=success`,
          billingCancelUrl: `${BASE_URL}/?billing=cancel`,
          billingPortalUrl: `${BASE_URL}/?billing=manage`,
          agentModeId: agentMode.id,
          knowledgeSetIds: [knowledgeSet.id],
          subscriptionPlanIds: plans.map((plan) => plan.id)
        },
        update: {
          status: "active",
          primaryBaseUrl: BASE_URL,
          primaryColor: "#0066FF",
          accentColor: "#2CCFF0",
          platformName: "Ranley",
          headerSubtitle: "CloudRAN Technical Support",
          externalLoginCopy: "Sign in with your work email to access Ranley technical support.",
          logoUrl: "/brands/ranley/ranley-logo.png",
          iconUrl: "/brands/ranley/assistant.png",
          portalWelcomeIllustrationUrl: "/brands/ranley/assistant.png",
          assistantName: "Ranley",
          assistantAvatarUrl: "/brands/ranley/assistant.png",
          portalWelcomeMessageDesktop: "Hello, I'm {{assistantName}}, your CloudRAN technical support assistant. How can I help?",
          portalWelcomeMessageMobile: "Ask Ranley about CloudRAN products, deployment, or troubleshooting.",
          portalWelcomeSuggestions: [
            { label: "Check product fit", prompt: "Help me identify the right CloudRAN product and version for this deployment scenario." },
            { label: "Review deployment", prompt: "Review this CloudRAN deployment plan and identify risks, missing prerequisites, and verification steps." },
            { label: "Troubleshoot an issue", prompt: "Help me troubleshoot this CloudRAN alarm, KPI, log, or service symptom." },
            { label: "Prepare escalation", prompt: "Help me organize the technical details needed to escalate this issue to CloudRAN support." }
          ],
          answerFeedbackEnabled: true,
          answerFeedbackPrompt: "Was this answer helpful?",
          externalOnly: true,
          employeeEmailDomains: ["cloud-ran.ai"],
          accessRequestEnabled: true,
          billingEnabled: true,
          billingSuccessUrl: `${BASE_URL}/?billing=success`,
          billingCancelUrl: `${BASE_URL}/?billing=cancel`,
          billingPortalUrl: `${BASE_URL}/?billing=manage`,
          agentModeId: agentMode.id,
          knowledgeSetIds: [knowledgeSet.id],
          subscriptionPlanIds: plans.map((plan) => plan.id)
        }
      });

      await tx.publicBrandDomain.upsert({
        where: { hostname: HOSTNAME },
        create: { publicBrandId: saved.id, hostname: HOSTNAME, status: "active", isPrimary: true },
        update: { publicBrandId: saved.id, status: "active", isPrimary: true }
      });
      await tx.publicBrandDomain.updateMany({
        where: { publicBrandId: saved.id, hostname: { not: HOSTNAME } },
        data: { isPrimary: false }
      });

      await tx.agentModeInstructionSource.deleteMany({
        where: { agentModeId: agentMode.id, sourceType: "workspace_agents_md" }
      });
      await tx.agentModeInstructionSource.create({
        data: {
          agentModeId: agentMode.id,
          sourceType: "workspace_agents_md",
          sourceRef: JSON.stringify({ version: 1, kind: "inline", content: prompt }),
          sortOrder: 0
        }
      });
      return saved;
    });

    console.log(JSON.stringify({
      ok: true,
      brand: { id: brand.id, key: brand.key, hostname: HOSTNAME },
      agentMode: { id: agentMode.id, name: agentMode.name },
      knowledgeSet: { id: knowledgeSet.id, name: knowledgeSet.name },
      plans: plans.map((plan) => ({ id: plan.id, slug: plan.slug }))
    }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
