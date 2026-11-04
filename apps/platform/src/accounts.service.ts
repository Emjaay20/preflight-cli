import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  Injectable,
} from "@nestjs/common";
import {
  mintApiKey,
  parseAccountType,
  parseApiKeyRole,
  slugify,
  uniqueSlug,
  type AccountType,
  type ApiKeyRole,
} from "@preflight/domain";
import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { hashSecret, sha256 } from "./crypto";
import type { AuthContext } from "./auth/api-key.guard";

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async signup(input: {
    accountType?: string;
    organization?: string;
    project: string;
    actorName?: string;
    email?: string;
    defaultClaims?: unknown;
  }) {
    let accountType: AccountType;
    try {
      accountType = parseAccountType(input.accountType, "organization");
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "invalid accountType");
    }

    const actorName = (input.actorName ?? "").trim();
    const orgName =
      accountType === "individual"
        ? (input.organization ?? "").trim() || actorName
        : (input.organization ?? "").trim();
    const projectName = (input.project ?? "").trim();
    const email = (input.email ?? "").trim() || null;

    if (!orgName || !projectName) {
      throw new ConflictException(
        accountType === "individual"
          ? "your name/handle and project name are required"
          : "organization and project names are required",
      );
    }

    const keyName =
      actorName || (accountType === "individual" ? slugify(orgName) : "org-owner");
    const existing = await this.prisma.organization.findMany({ select: { slug: true } });
    const slug = uniqueSlug(orgName, new Set(existing.map((o) => o.slug)));
    const projectSlug = slugify(projectName);
    const key = mintApiKey();

    const org = await this.prisma.organization.create({
      data: {
        name: orgName,
        slug,
        accountType,
        apiKeys: {
          create: {
            name: keyName,
            email,
            role: "admin",
            prefix: key.prefix,
            hash: await hashSecret(key.secret),
          },
        },
        projects: {
          create: {
            name: projectName,
            slug: projectSlug,
            defaultClaims: (input.defaultClaims ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
          },
        },
      },
      include: { projects: true, apiKeys: true },
    });
    const project = org.projects[0];
    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        accountType: parseAccountType(org.accountType, "organization"),
      },
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        defaultClaims: project.defaultClaims ?? null,
      },
      apiKey: {
        plaintext: key.plaintext,
        prefix: key.prefix,
        name: keyName,
        email,
        role: "admin" as ApiKeyRole,
        shownOnce: true,
      },
    };
  }

  async me(auth: AuthContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      include: {
        projects: { orderBy: { createdAt: "asc" } },
      },
    });
    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        accountType: parseAccountType(org.accountType, "organization"),
        plan: org.plan,
        entitlements: { reviewsPerMonth: org.reviewLimit, projects: org.projectLimit, artifactBytes: org.artifactLimitBytes, retentionDays: org.retentionDays },
      },
      currentKey: {
        id: auth.apiKeyId,
        name: auth.apiKeyName,
        prefix: auth.apiKeyPrefix,
        role: auth.role,
      },
      projects: org.projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        defaultClaims: p.defaultClaims ?? null,
      })),
    };
  }

  async createProject(
    organizationId: string,
    name: string,
    defaultClaims?: unknown,
  ) {
    const trimmed = name.trim();
    if (!trimmed) throw new ConflictException("project name is required");
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const existing = await this.prisma.project.findMany({
      where: { organizationId },
      select: { slug: true },
    });
    if (existing.length >= org.projectLimit) {
      throw new ConflictException(`free evaluation project limit reached (${org.projectLimit}); request an upgrade at yusuf@yusufsaka.dev`);
    }
    const slug = uniqueSlug(trimmed, new Set(existing.map((p) => p.slug)));
    const project = await this.prisma.project.create({
      data: {
        organizationId,
        name: trimmed,
        slug,
        defaultClaims: (defaultClaims ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      defaultClaims: project.defaultClaims ?? null,
    };
  }

  async updateProjectClaims(
    organizationId: string,
    projectId: string,
    defaultClaims: unknown | null,
  ) {
    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!existing) throw new NotFoundException("project not found in this organization");
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        defaultClaims: (defaultClaims ?? null) as Prisma.InputJsonValue,
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      defaultClaims: updated.defaultClaims ?? null,
    };
  }

  async listKeys(organizationId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      email: k.email ?? null,
      role: parseApiKeyRole(k.role, "admin"),
      prefix: k.prefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revoked: Boolean(k.revokedAt),
    }));
  }

  async mintKey(
    organizationId: string,
    name: string,
    rawRole?: string,
    rawEmail?: string,
  ) {
    let role: ApiKeyRole;
    try {
      role = parseApiKeyRole(rawRole, "ci");
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "invalid role");
    }
    const email = (rawEmail ?? "").trim() || null;
    const key = mintApiKey();
    const row = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name: name.trim() || role,
        email,
        role,
        prefix: key.prefix,
        hash: await hashSecret(key.secret),
      },
    });
    return {
      id: row.id,
      name: row.name,
      email: row.email ?? null,
      role,
      prefix: row.prefix,
      plaintext: key.plaintext,
      shownOnce: true,
    };
  }

  async inviteMember(
    organizationId: string,
    input: { name: string; email: string; role?: string },
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    if (parseAccountType(org.accountType, "organization") !== "organization") {
      throw new ConflictException(
        "individual accounts cannot invite organization members; mint a personal CLI/CI key instead",
      );
    }
    const name = input.name.trim();
    const email = input.email.trim();
    if (!name || !email) {
      throw new BadRequestException("member name and email are required");
    }
    let role: ApiKeyRole;
    try {
      role = parseApiKeyRole(input.role, "reviewer");
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "invalid role");
    }
    if (role === "ci") {
      throw new BadRequestException("CI access uses a separately minted CI key; it cannot accept a browser invitation");
    }
    const token = randomBytes(32).toString("base64url");
    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        organizationId,
        name,
        email: email.toLowerCase(),
        role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actor: "workspace-admin",
        action: "member.invited",
        targetType: "invitation",
        targetId: invitation.id,
        metadata: { email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt },
      },
    });
    return {
      id: invitation.id,
      name: invitation.name,
      email: invitation.email,
      role: parseApiKeyRole(invitation.role, "reviewer"),
      expiresAt: invitation.expiresAt,
      token,
    };
  }

  async acceptInvitation(input: { token: string; workosUserId: string; email: string }) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: sha256(input.token) },
      include: { organization: true },
    });
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException("this invitation is invalid or has expired");
    }
    if (invitation.email.toLowerCase() !== input.email.trim().toLowerCase()) {
      throw new ConflictException("sign in with the email address that received this invitation");
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.workosIdentity.findUnique({ where: { workosUserId: input.workosUserId } });
      if (existing && existing.organizationId !== invitation.organizationId) {
        throw new ConflictException("this WorkOS account is already linked to another Preflight workspace");
      }

      let apiKeyId = existing?.apiKeyId;
      if (!apiKeyId) {
        // Browser members never receive a plaintext API key as a side effect
        // of accepting an invite. CLI/CI credentials remain deliberate,
        // separately-issued secrets.
        const key = mintApiKey();
        const row = await tx.apiKey.create({
          data: {
            organizationId: invitation.organizationId,
            name: invitation.name,
            email: invitation.email,
            role: invitation.role,
            prefix: key.prefix,
            hash: await hashSecret(key.secret),
          },
        });
        apiKeyId = row.id;
        await tx.workosIdentity.create({
          data: {
            workosUserId: input.workosUserId,
            email: invitation.email,
            organizationId: invitation.organizationId,
            apiKeyId,
          },
        });
      }

      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: "accepted", acceptedAt: new Date(), acceptedByWorkosId: input.workosUserId },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: invitation.organizationId,
          actor: input.email,
          action: "member.invitation_accepted",
          targetType: "invitation",
          targetId: invitation.id,
          metadata: { role: invitation.role, apiKeyId },
        },
      });
      return {
        organization: { id: invitation.organization.id, name: invitation.organization.name },
        role: parseApiKeyRole(invitation.role, "reviewer"),
      };
    });
  }

  async listInvitations(organizationId: string) {
    return this.prisma.workspaceInvitation.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, email: true, role: true, status: true, expiresAt: true, createdAt: true, acceptedAt: true },
    });
  }

  async revokeKey(organizationId: string, keyId: string, callerKeyId?: string) {
    if (callerKeyId && callerKeyId === keyId) {
      throw new ConflictException("cannot revoke the currently active API key");
    }
    const row = await this.prisma.apiKey.findFirst({
      where: { id: keyId, organizationId },
    });
    if (!row) throw new NotFoundException("api key not found in this organization");
    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    return { id: keyId, revoked: true };
  }

  async rotateKey(organizationId: string, keyId: string) {
    const current = await this.prisma.apiKey.findFirst({ where: { id: keyId, organizationId, revokedAt: null } });
    if (!current) throw new NotFoundException("active API key not found in this organization");
    const replacement = await this.mintKey(organizationId, `${current.name} (rotated)`, current.role, current.email ?? undefined);
    await this.prisma.$transaction([
      this.prisma.apiKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date(), replacedById: replacement.id },
      }),
      // Browser identities are tied to the member's role key. Preserve the
      // linkage across a rotation so rotating CLI/CI material does not evict a
      // legitimate browser session from its workspace.
      this.prisma.workosIdentity.updateMany({
        where: { apiKeyId: keyId },
        data: { apiKeyId: replacement.id },
      }),
    ]);
    await this.prisma.auditEvent.create({ data: { organizationId, actor: current.prefix, action: "key.rotated", targetType: "api_key", targetId: keyId, metadata: { replacementId: replacement.id } } });
    return replacement;
  }

  async requestUpgrade(organizationId: string, email: string, message?: string) {
    const request = await this.prisma.accessRequest.create({ data: { organizationId, email: email.trim(), message: message?.trim() || null } });
    await this.prisma.auditEvent.create({ data: { organizationId, actor: email.trim(), action: "upgrade.requested", targetType: "workspace", targetId: organizationId, metadata: { requestId: request.id } } });
    return { id: request.id, status: request.status, contact: "yusuf@yusufsaka.dev" };
  }

  async auditReport(organizationId: string) {
    return this.prisma.auditEvent.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 1000 });
  }
}
