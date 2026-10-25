import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Param,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { canManageOrg, canSignOff } from "@preflight/domain";
import { AccountsService } from "./accounts.service";
import { ApiKeyGuard, type AuthContext } from "./auth/api-key.guard";
import { CurrentAuth } from "./auth/current-auth";

@ApiTags("account")
@Controller("v1")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

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
    });
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
}
