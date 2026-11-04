import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Param,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { canManageOrg, canSignOff } from "@preflight/domain";
import { AccountsService } from "./accounts.service";
import { ApiKeyGuard, type AuthContext } from "./auth/api-key.guard";
import { CurrentAuth } from "./auth/current-auth";
import { WorkosAuthService } from "./auth/workos-auth.service";

@ApiTags("account")
@Controller("v1")
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly workos: WorkosAuthService,
  ) {}

  @Post("signup")
  async signup(
    @Body()
    body: {
      accountType?: string;
      organization?: string;
      project?: string;
      actorName?: string;
      email?: string;
      defaultClaims?: unknown;
    },
  ) {
    const isIndividual = body.accountType === "individual";
    const orgOrName = isIndividual ? body.actorName || body.organization : body.organization;
    if (!orgOrName || !body.project) {
      throw new BadRequestException(
        isIndividual
          ? "actorName and project are required for individual signup"
          : "organization and project are required",
      );
    }
    return this.accounts.signup({
      accountType: body.accountType,
      organization: body.organization,
      project: body.project,
      actorName: body.actorName,
      email: body.email,
      defaultClaims: body.defaultClaims,
    });
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Get("me")
  me(@CurrentAuth() auth: AuthContext) {
    return this.accounts.me(auth);
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Post("projects")
  createProject(
    @CurrentAuth() auth: AuthContext,
    @Body() body: { name?: string; defaultClaims?: unknown },
  ) {
    if (!canManageOrg(auth.role)) {
      throw new ForbiddenException("only admin keys can create projects");
    }
    if (!body.name) throw new BadRequestException("name is required");
    return this.accounts.createProject(auth.organizationId, body.name, body.defaultClaims);
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Put("projects/:id/claims")
  updateProjectClaims(
    @CurrentAuth() auth: AuthContext,
    @Param("id") id: string,
    @Body() body: { claims?: unknown },
  ) {
    if (!canSignOff(auth.role)) {
      throw new ForbiddenException("CI keys cannot modify project claims");
    }
    return this.accounts.updateProjectClaims(auth.organizationId, id, body.claims ?? null);
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Get("keys")
  listKeys(@CurrentAuth() auth: AuthContext) {
    return this.accounts.listKeys(auth.organizationId);
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Post("keys")
  mintKey(
    @CurrentAuth() auth: AuthContext,
    @Body() body: { name?: string; role?: string; email?: string },
  ) {
    if (!canManageOrg(auth.role)) {
      throw new ForbiddenException("only admin keys can mint new API keys");
    }
    return this.accounts.mintKey(
      auth.organizationId,
      body.name ?? "ci",
      body.role,
      body.email,
    );
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Post("members/invite")
  inviteMember(
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
    @Body() body: { name?: string; email?: string; role?: string },
  ) {
    if (!canManageOrg(auth.role)) {
      throw new ForbiddenException("only organization admins can invite team members");
    }
    if (!body.name || !body.email) {
      throw new BadRequestException("name and email are required to invite a team member");
    }
    return this.accounts.inviteMember(auth.organizationId, {
      name: body.name,
      email: body.email,
      role: body.role,
    }).then((invitation) => ({
      ...invitation,
      inviteUrl: `${publicAppUrl(request)}/#invite=${encodeURIComponent(invitation.token)}`,
      // Do not return the raw token separately; the URL is the one-time
      // secret the administrator shares with the intended member.
      token: undefined,
    }));
  }

  @Post("invitations/accept")
  async acceptInvitation(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { token?: string },
  ) {
    if (!body.token) throw new BadRequestException("invitation token is required");
    const user = await this.workos.currentBrowserUser(request, response);
    if (!user) throw new ForbiddenException("sign in with WorkOS before accepting an invitation");
    return this.accounts.acceptInvitation({ token: body.token, workosUserId: user.id, email: user.email });
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Get("invitations")
  async listInvitations(@CurrentAuth() auth: AuthContext) {
    if (!canManageOrg(auth.role)) throw new ForbiddenException("only admin keys can view invitations");
    return this.accounts.listInvitations(auth.organizationId);
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Post("keys/:id/revoke")
  revokeKey(@CurrentAuth() auth: AuthContext, @Param("id") id: string) {
    if (!canManageOrg(auth.role)) {
      throw new ForbiddenException("only admin keys can revoke API keys");
    }
    return this.accounts.revokeKey(auth.organizationId, id, auth.apiKeyId);
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Post("keys/:id/rotate")
  rotateKey(@CurrentAuth() auth: AuthContext, @Param("id") id: string) {
    if (!canManageOrg(auth.role)) throw new ForbiddenException("only admin keys can rotate API keys");
    return this.accounts.rotateKey(auth.organizationId, id);
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Post("access-requests")
  requestUpgrade(@CurrentAuth() auth: AuthContext, @Body() body: { email?: string; message?: string }) {
    if (!body.email) throw new BadRequestException("email is required");
    return this.accounts.requestUpgrade(auth.organizationId, body.email, body.message);
  }

  @ApiBearerAuth()
  @UseGuards(ApiKeyGuard)
  @Get("audit-report")
  async auditReport(@CurrentAuth() auth: AuthContext) {
    if (!canManageOrg(auth.role)) throw new ForbiddenException("only admin keys can export audit reports");
    const events = await this.accounts.auditReport(auth.organizationId);
    return { generatedAt: new Date().toISOString(), format: "json", events };
  }
}

function publicAppUrl(request: Request): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = request.header("x-forwarded-host") ?? request.header("host");
  const protocol = request.header("x-forwarded-proto") ?? request.protocol;
  if (!host) throw new BadRequestException("cannot determine public application URL");
  return `${protocol}://${host}`;
}
