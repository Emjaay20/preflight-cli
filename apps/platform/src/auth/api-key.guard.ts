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

export type AuthContext = {
  organizationId: string;
  organizationSlug: string;
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  role: ApiKeyRole;
};

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const raw = readKey(req);
    if (!raw) throw new UnauthorizedException("missing API key");
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
    if (!row || row.revokedAt) throw new UnauthorizedException("invalid API key");
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
    };
    return true;
  }
}

function readKey(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return req.header("x-api-key")?.trim();
}
