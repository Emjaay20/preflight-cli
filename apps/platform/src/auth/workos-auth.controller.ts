import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { WorkosAuthService } from "./workos-auth.service";

@Controller("v1/auth/workos")
export class WorkosAuthController {
  constructor(private readonly workos: WorkosAuthService) {}

  @Get("status")
  status(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.workos.status(request, response);
  }

  @Get("login")
  async login(
    @Query("return_to") returnTo: string | undefined,
    @Res() response: Response,
  ) {
    const url = await this.workos.beginLogin(response, returnTo);
    return response.redirect(url);
  }

  @Get("callback")
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
  ) {
    if (error) throw new UnauthorizedException("WorkOS sign-in was cancelled or denied");
    const returnTo = await this.workos.completeLogin(request, response, code, state);
    return response.redirect(returnTo);
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    verifySameOrigin(request);
    return { logoutUrl: await this.workos.logoutUrl(request, response) };
  }
}

function verifySameOrigin(request: Request): void {
  const origin = request.header("origin");
  if (!origin) return;
  const host = request.header("x-forwarded-host") ?? request.header("host");
  const protocol = request.header("x-forwarded-proto") ?? request.protocol;
  if (!host || origin !== `${protocol}://${host}`) {
    throw new UnauthorizedException("cross-site sign-out request rejected");
  }
}
