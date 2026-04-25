import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const adminEmail = (process.env.DEV_ADMIN_EMAIL || "admin@local.agent-studio.test").trim().toLowerCase();
const customerEmail = (process.env.DEV_CUSTOMER_EMAIL || "customer@local.agent-studio.test").trim().toLowerCase();
const defaultModel = (process.env.DEFAULT_MODEL || "gpt-5.4").trim() || "gpt-5.4";

const permissionKeys = [
  "alert.read",
  "alert.write",
  "audit.read",
  "collaboration.assign",
  "collaboration.broadcast.publish",
  "collaboration.capture_mark.write",
  "collaboration.comment",
  "collaboration.read",
  "collaboration.share",
  "integration.read",
  "integration.write",
  "knowledge_set.file_manage",
  "knowledge_set.read",
  "knowledge_set.reindex",
  "knowledge_set.upload",
  "knowledge_set.write",
  "monitoring.read",
  "permission.assign",
  "permission.read",
  "quota.read",
  "quota.write",
  "resource_policy.read",
  "resource_policy.write",
  "role.clone",
  "role.disable",
  "role.read",
  "role.write",
  "system_settings.publish",
  "system_settings.read",
  "system_settings.write",
  "user.read",
  "user.role.assign"
];

function titleFromKey(key: string): string {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function categoryFromKey(key: string): string {
  return key.split(".")[0] || "platform";
}

async function upsertGlobalRole(slug: string, name: string, description: string) {
  const existing = await prisma.role.findFirst({
    where: { slug, organizationId: null }
  });
  if (existing) {
    return prisma.role.update({
      where: { id: existing.id },
      data: {
        name,
        description,
        isSystem: true,
        isActive: true
      }
    });
  }
  return prisma.role.create({
    data: {
      organizationId: null,
      slug,
      name,
      description,
      isSystem: true,
      isActive: true
    }
  });
}

async function upsertAllowPolicy(input: {
  organizationId?: string | null;
  subjectType: "role" | "department" | "user";
  subjectId: string;
  resourceType: "agent_mode" | "run_profile" | "skill_package" | "workspace" | "knowledge_set";
  resourceId: string;
}) {
  await prisma.resourcePolicy.deleteMany({
    where: {
      organizationId: input.organizationId ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      resourceType: input.resourceType,
      resourceId: input.resourceId
    }
  });
  await prisma.resourcePolicy.create({
    data: {
      organizationId: input.organizationId ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      effect: "allow"
    }
  });
}

async function main() {
  const now = new Date();
  const internalOrg = await prisma.organization.upsert({
    where: { slug: "internal" },
    update: {
      name: "Internal Organization",
      type: "internal",
      status: "active"
    },
    create: {
      slug: "internal",
      name: "Internal Organization",
      type: "internal",
      status: "active"
    }
  });

  const customerOrg = await prisma.organization.upsert({
    where: { slug: "local-customer" },
    update: {
      name: "Local Customer",
      type: "customer",
      status: "active"
    },
    create: {
      slug: "local-customer",
      name: "Local Customer",
      type: "customer",
      status: "active"
    }
  });

  const [superAdminRole, adminRole] = await Promise.all([
    upsertGlobalRole("super_admin", "Super Admin", "Local development super admin"),
    upsertGlobalRole("admin", "Admin", "Local development admin")
  ]);

  const runProfile = await prisma.runProfile.upsert({
    where: { slug: "local-dev-default" },
    update: {
      name: "Local Dev Default",
      description: "Default local development runtime profile",
      status: "active",
      defaultModel,
      allowedModels: [defaultModel],
      defaultReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "live"
    },
    create: {
      slug: "local-dev-default",
      name: "Local Dev Default",
      description: "Default local development runtime profile",
      status: "active",
      defaultModel,
      allowedModels: [defaultModel],
      defaultReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "live"
    }
  });

  const agentMode = await prisma.agentMode.upsert({
    where: { slug: "local-dev-assistant" },
    update: {
      name: "Local Dev Assistant",
      description: "Default local development assistant mode",
      status: "active",
      visibleToUsers: true,
      runProfileId: runProfile.id
    },
    create: {
      slug: "local-dev-assistant",
      name: "Local Dev Assistant",
      description: "Default local development assistant mode",
      status: "active",
      visibleToUsers: true,
      runProfileId: runProfile.id
    }
  });

  await prisma.workspace.upsert({
    where: { slug: "local-dev-workspace" },
    update: {
      name: "Local Dev Workspace",
      description: "Repository workspace for local development sessions",
      status: "active",
      sourceType: "filesystem",
      rootPath: process.env.DEFAULT_WORKSPACE || ".."
    },
    create: {
      slug: "local-dev-workspace",
      name: "Local Dev Workspace",
      description: "Repository workspace for local development sessions",
      status: "active",
      sourceType: "filesystem",
      rootPath: process.env.DEFAULT_WORKSPACE || ".."
    }
  });

  for (const subjectId of ["org_internal_user", "org_internal_admin", "org_external_user", "org_external_admin", "super_admin", "admin"]) {
    await upsertAllowPolicy({
      subjectType: "role",
      subjectId,
      resourceType: "run_profile",
      resourceId: runProfile.id
    });
    await upsertAllowPolicy({
      subjectType: "role",
      subjectId,
      resourceType: "agent_mode",
      resourceId: agentMode.id
    });
  }

  const permissions = await Promise.all(
    permissionKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {
          name: titleFromKey(key),
          category: categoryFromKey(key),
          isSystem: true,
          isActive: true
        },
        create: {
          key,
          name: titleFromKey(key),
          category: categoryFromKey(key),
          isSystem: true,
          isActive: true
        }
      })
    )
  );

  for (const role of [superAdminRole, adminRole]) {
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }

  const adminUser = await prisma.user.upsert({
    where: { externalId: "local-dev-admin" },
    update: {
      email: adminEmail,
      displayName: "Local Admin",
      userType: "internal_employee",
      primaryOrganizationId: internalOrg.id,
      role: "super_admin",
      status: "active",
      statusSource: "local_seed",
      syncState: "active",
      manualDisabled: false
    },
    create: {
      externalId: "local-dev-admin",
      email: adminEmail,
      displayName: "Local Admin",
      userType: "internal_employee",
      primaryOrganizationId: internalOrg.id,
      role: "super_admin",
      status: "active",
      statusSource: "local_seed",
      syncState: "active",
      manualDisabled: false
    }
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: superAdminRole.id
      }
    },
    update: { isPrimary: true },
    create: {
      userId: adminUser.id,
      roleId: superAdminRole.id,
      isPrimary: true
    }
  });

  await prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: internalOrg.id,
        userId: adminUser.id
      }
    },
    update: {
      membershipType: "employee",
      status: "active",
      joinedAt: now
    },
    create: {
      organizationId: internalOrg.id,
      userId: adminUser.id,
      membershipType: "employee",
      status: "active",
      joinedAt: now
    }
  });

  await prisma.authIdentity.upsert({
    where: {
      provider_providerSubject: {
        provider: "email_magic_link",
        providerSubject: adminEmail
      }
    },
    update: {
      userId: adminUser.id,
      email: adminEmail,
      emailVerifiedAt: now
    },
    create: {
      userId: adminUser.id,
      provider: "email_magic_link",
      providerSubject: adminEmail,
      email: adminEmail,
      emailVerifiedAt: now
    }
  });

  const customerUser = await prisma.user.upsert({
    where: { externalId: "local-dev-customer" },
    update: {
      email: customerEmail,
      displayName: "Local Customer",
      userType: "external_user",
      primaryOrganizationId: customerOrg.id,
      role: "employee",
      status: "active",
      statusSource: "local_seed",
      syncState: "active",
      manualDisabled: false
    },
    create: {
      externalId: "local-dev-customer",
      email: customerEmail,
      displayName: "Local Customer",
      userType: "external_user",
      primaryOrganizationId: customerOrg.id,
      role: "employee",
      status: "active",
      statusSource: "local_seed",
      syncState: "active",
      manualDisabled: false
    }
  });

  await prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: customerOrg.id,
        userId: customerUser.id
      }
    },
    update: {
      membershipType: "customer_admin",
      status: "active",
      joinedAt: now
    },
    create: {
      organizationId: customerOrg.id,
      userId: customerUser.id,
      membershipType: "customer_admin",
      status: "active",
      joinedAt: now
    }
  });

  await prisma.authIdentity.upsert({
    where: {
      provider_providerSubject: {
        provider: "email_magic_link",
        providerSubject: customerEmail
      }
    },
    update: {
      userId: customerUser.id,
      email: customerEmail,
      emailVerifiedAt: now
    },
    create: {
      userId: customerUser.id,
      provider: "email_magic_link",
      providerSubject: customerEmail,
      email: customerEmail,
      emailVerifiedAt: now
    }
  });

  const plan = await prisma.subscriptionPlan.upsert({
    where: { slug: "local-dev-unlimited" },
    update: {
      name: "Local Dev Unlimited",
      status: "active",
      featureType: "chat",
      monthlyCompletedTurnLimit: null,
      monthlyTokenLimit: null
    },
    create: {
      slug: "local-dev-unlimited",
      name: "Local Dev Unlimited",
      description: "Local development subscription for testing external users",
      status: "active",
      featureType: "chat",
      monthlyCompletedTurnLimit: null,
      monthlyTokenLimit: null
    }
  });

  await prisma.subscriptionGrant.upsert({
    where: {
      principalType_principalId: {
        principalType: "organization",
        principalId: customerOrg.id
      }
    },
    update: {
      planId: plan.id,
      status: "active",
      startsAt: now,
      cycleAnchorAt: now,
      expiresAt: null,
      completedTurnLimitOverride: null,
      tokenLimitOverride: null,
      note: "Local development seed"
    },
    create: {
      principalType: "organization",
      principalId: customerOrg.id,
      planId: plan.id,
      status: "active",
      startsAt: now,
      cycleAnchorAt: now,
      expiresAt: null,
      completedTurnLimitOverride: null,
      tokenLimitOverride: null,
      note: "Local development seed",
      createdByUserId: adminUser.id
    }
  });

  console.info("Local development seed ready:");
  console.info(`  Admin email: ${adminEmail}`);
  console.info(`  Customer email: ${customerEmail}`);
  console.info("  Sign-in codes are printed by AUTH_EMAIL_DEBUG=true in the API console.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
