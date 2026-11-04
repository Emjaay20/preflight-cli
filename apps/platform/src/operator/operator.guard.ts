import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { WorkosAuthService } from "../auth/workos-auth.service";

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(private readonly workos: WorkosAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse();
    const user = await this.workos.currentBrowserUser(request, response);
    const allowList = (process.env.PLATFORM_OPERATOR_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (!user || allowList.length === 0 || !allowList.includes(user.email.toLowerCase())) {
      throw new ForbiddenException("platform operator access is not enabled for this account");
    }
    (request as Request & { operatorEmail?: string }).operatorEmail = user.email;
    return true;
  }
}
