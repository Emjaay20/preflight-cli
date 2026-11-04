import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { WorkOS } from "@workos-inc/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { parseApiKeyRole } from "@preflight/domain";
import { PrismaService } from "../prisma.service";
import type { AuthContext } from "./api-key.guard";

const ATTEMPT_COOKIE = "pf_workos_attempt";
const SESSION_COOKIE = "pf_workos_session";
const ATTEMPT_MAX_AGE_MS = 10 * 60 * 1000;

type LoginAttempt = {
  state: string;
  codeVerifier: string;
  returnTo: string;
  issuedAt: number;
};

export type BrowserUser = {
  id: string;
  email: string;
};

@Injectable()
export class WorkosAuthService {
  private readonly logger = new Logger(WorkosAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return Boolean(this.apiKey && this.clientId && this.redirectUri && this.cookieSecret);
  }

  async beginLogin(response: Response, requestedReturnTo?: string): Promise<string> {
    this.assertEnabled();
    const { url, state, codeVerifier } = await this.client.userManagement.getAuthorizationUrlWithPKCE({
      provider: "authkit",
      clientId: this.clientId,
      redirectUri: this.redirectUri,
    });
    const attempt: LoginAttempt = {
      state,
      codeVerifier,
      returnTo: safeReturnTo(requestedReturnTo),
      issuedAt: Date.now(),
    };
    response.cookie(ATTEMPT_COOKIE, this.sealAttempt(attempt), {
      ...this.cookieOptions,
      maxAge: ATTEMPT_MAX_AGE_MS,
    });
    return url;
  }

  async completeLogin(
    request: Request,
    response: Response,
    code: string | undefined,
    state: string | undefined,
  ): Promise<string> {
    this.assertEnabled();
    if (!code || !state) throw new UnauthorizedException("WorkOS did not return a valid sign-in response");
    const attempt = this.readAttempt(request.cookies?.[ATTEMPT_COOKIE]);
    if (!attempt || !secureEqual(attempt.state, state)) {
      throw new UnauthorizedException("WorkOS sign-in could not be verified; please start again");
    }

    const result = await this.client.userManagement.authenticateWithCode({
      code,
      codeVerifier: attempt.codeVerifier,
      clientId: this.clientId,
      session: { sealSession: true, cookiePassword: this.cookieSecret },
    });
    if (!result.sealedSession) {
      throw new UnauthorizedException("WorkOS did not create a browser session");
    }
    response.cookie(SESSION_COOKIE, result.sealedSession, this.cookieOptions);
    response.clearCookie(ATTEMPT_COOKIE, this.cookieOptions);
    await this.linkKnownUser({ id: result.user.id, email: result.user.email });
    return attempt.returnTo;
  }

  async resolveAuth(request: Request, response?: Response): Promise<AuthContext | null> {
    const user = await this.authenticatedUser(request, response);
    if (!user) return null;

    let identity = await this.prisma.workosIdentity.findUnique({
      where: { workosUserId: user.id },
      include: { apiKey: { include: { organization: true } } },
    });
    if (!identity) {
      await this.linkKnownUser(user);
      identity = await this.prisma.workosIdentity.findUnique({
        where: { workosUserId: user.id },
        include: { apiKey: { include: { organization: true } } },
      });
    }
    if (!identity || identity.apiKey.revokedAt || isExpired(identity.apiKey.expiresAt)) return null;

    await this.prisma.apiKey.update({
      where: { id: identity.apiKeyId },
      data: { lastUsedAt: new Date() },
    });
    if (identity.email !== user.email) {
      await this.prisma.workosIdentity.update({
        where: { id: identity.id },
        data: { email: user.email },
      });
    }
    return {
      organizationId: identity.organizationId,
      organizationSlug: identity.apiKey.organization.slug,
      apiKeyId: identity.apiKeyId,
      apiKeyName: identity.apiKey.name,
      apiKeyPrefix: identity.apiKey.prefix,
      role: parseApiKeyRole(identity.apiKey.role, "admin"),
      authMethod: "workos",
    };
  }

  async status(request: Request, response?: Response) {
    const user = await this.authenticatedUser(request, response);
    return {
      enabled: this.enabled,
      // This deliberately reports names only, never credential values. It
      // makes a hosted misconfiguration diagnosable without exposing secrets.
      missingConfiguration: this.missingConfiguration,
      authenticated: Boolean(user),
      user: user ? { id: user.id, email: user.email } : null,
    };
  }

  async currentBrowserUser(request: Request, response?: Response): Promise<BrowserUser | null> {
    return this.authenticatedUser(request, response);
  }

  async logoutUrl(request: Request, response: Response): Promise<string> {
    if (!this.enabled) return "/";
    const sessionData = request.cookies?.[SESSION_COOKIE];
    response.clearCookie(SESSION_COOKIE, this.cookieOptions);
    response.clearCookie(ATTEMPT_COOKIE, this.cookieOptions);
    if (!sessionData) return "/";
    try {
      const session = this.client.userManagement.loadSealedSession({
        sessionData,
        cookiePassword: this.cookieSecret,
      });
      return await session.getLogoutUrl();
    } catch {
      return "/";
    }
  }

  private get client(): WorkOS {
    return new WorkOS(this.apiKey, {
      clientId: this.clientId,
    });
  }

  private get apiKey(): string {
    return process.env.WORKOS_API_KEY?.trim() ?? "";
  }

  private get clientId(): string {
    return process.env.WORKOS_CLIENT_ID?.trim() ?? "";
  }

  private get redirectUri(): string {
    return process.env.WORKOS_REDIRECT_URI?.trim() ?? "";
  }

  private get cookieSecret(): string {
    return process.env.WORKOS_COOKIE_SECRET?.trim() ?? "";
  }

  private get missingConfiguration(): string[] {
    return [
      ["WORKOS_API_KEY", this.apiKey],
      ["WORKOS_CLIENT_ID", this.clientId],
      ["WORKOS_REDIRECT_URI", this.redirectUri],
      ["WORKOS_COOKIE_SECRET", this.cookieSecret],
    ].filter(([, value]) => !value).map(([name]) => name);
  }

  private get cookieOptions() {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: this.redirectUri.startsWith("https://"),
      path: "/",
    };
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new UnauthorizedException("browser sign-in is not configured");
  }

  private sealAttempt(attempt: LoginAttempt): string {
    const body = Buffer.from(JSON.stringify(attempt)).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }

  private readAttempt(value: unknown): LoginAttempt | null {
    if (typeof value !== "string") return null;
    const [body, signature, extra] = value.split(".");
    if (!body || !signature || extra || !secureEqual(this.sign(body), signature)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LoginAttempt;
      if (
        typeof parsed.state !== "string" ||
        typeof parsed.codeVerifier !== "string" ||
        typeof parsed.issuedAt !== "number" ||
        Date.now() - parsed.issuedAt > ATTEMPT_MAX_AGE_MS
      ) {
        return null;
      }
      return { ...parsed, returnTo: safeReturnTo(parsed.returnTo) };
    } catch {
      return null;
    }
  }

  private sign(value: string): string {
    return createHmac("sha256", this.cookieSecret).update(value).digest("base64url");
  }

  private async authenticatedUser(request: Request, response?: Response): Promise<BrowserUser | null> {
    if (!this.enabled) return null;
    const sessionData = request.cookies?.[SESSION_COOKIE];
    if (typeof sessionData !== "string" || !sessionData) return null;
    try {
      const session = this.client.userManagement.loadSealedSession({
        sessionData,
        cookiePassword: this.cookieSecret,
      });
      const result = await session.authenticate();
      if (result.authenticated) {
        return { id: result.user.id, email: result.user.email };
      }
      {
        const refreshed = await session.refresh();
        if (!refreshed.authenticated) return null;
        if (refreshed.sealedSession) {
          response?.cookie(SESSION_COOKIE, refreshed.sealedSession, this.cookieOptions);
        }
        return { id: refreshed.user.id, email: refreshed.user.email };
      }
    } catch (error) {
      this.logger.warn("Unable to validate WorkOS session");
      response?.clearCookie(SESSION_COOKIE, this.cookieOptions);
      return null;
    }
  }

  private async linkKnownUser(user: BrowserUser): Promise<void> {
    const existing = await this.prisma.workosIdentity.findUnique({
      where: { workosUserId: user.id },
    });
    if (existing) return;

    const candidates = await this.prisma.apiKey.findMany({
      where: {
        email: { equals: user.email, mode: "insensitive" },
        revokedAt: null,
        role: { in: ["admin", "reviewer"] },
      },
      select: { id: true, organizationId: true },
      take: 2,
    });
    // A single matching workspace can be safely linked. Multiple workspaces
    // require explicit workspace selection, which Preflight does not yet expose.
    if (candidates.length !== 1) return;
    try {
      await this.prisma.workosIdentity.create({
        data: {
          workosUserId: user.id,
          email: user.email,
          organizationId: candidates[0].organizationId,
          apiKeyId: candidates[0].id,
        },
      });
    } catch {
      // A concurrent callback can create the same durable link first.
    }
  }
}

function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/#console";
  }
  return value;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isExpired(expiresAt: Date | null): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now());
}
