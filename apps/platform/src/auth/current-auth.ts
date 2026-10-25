import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthContext } from "./api-key.guard";

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<{ auth: AuthContext }>();
    return req.auth;
  },
);
