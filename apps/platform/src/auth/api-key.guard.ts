import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { parseApiKey, parseApiKeyRole, type ApiKeyRole } from "@preflight/domain";
import { PrismaService } from "../prisma.service";
import { verifySecret } from "../crypto";
import { WorkosAuthService } from "./workos-auth.service";

export type AuthContext = {
  organizationId: string;
  organizationSlug: string;
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  role: ApiKeyRole;
  authMethod: "api_key" | "workos";
};

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workos: WorkosAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { auth?: AuthContext }>();
    const response = http.getResponse();
    const raw = readKey(req);
    if (!raw) {
      const sessionAuth = await this.workos.resolveAuth(req, response);
      if (!sessionAuth) throw new UnauthorizedException("missing API key or browser session");
      req.auth = sessionAuth;
      return true;
    }
    let parsed;
    try {
      parsed = parseApiKey(raw);
    } catch {
      throw new UnauthorizedException("invalid API key");
    }
    const row = await this.prisma.apiKey.findUnique({
      where: { prefix: parsed.prefix },
      include: { organization: true },
    });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
      throw new UnauthorizedException("invalid API key");
    }
    const ok = await verifySecret(parsed.secret, row.hash);
    if (!ok) throw new UnauthorizedException("invalid API key");
    await this.prisma.apiKey.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });
    req.auth = {
      organizationId: row.organizationId,
      organizationSlug: row.organization.slug,
      apiKeyId: row.id,
      apiKeyName: row.name,
      apiKeyPrefix: row.prefix,
      role: parseApiKeyRole(row.role, "admin"),
      authMethod: "api_key",
    };
    return true;
  }
}

function readKey(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return req.header("x-api-key")?.trim();
}
