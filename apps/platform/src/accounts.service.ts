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
import { PrismaService } from "./prisma.service";
import { hashSecret } from "./crypto";
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
    const existing = await this.prisma.project.findMany({
      where: { organizationId },
      select: { slug: true },
    });
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
    return this.mintKey(organizationId, name, input.role ?? "reviewer", email);
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
}
