import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type Redis from "ioredis";
import { TOKENS } from "./tokens";

/**
 * The hosted sandbox is intentionally public so a visitor can verify a real
 * scanner verdict. It is still a bounded compute endpoint: this Redis-backed
 * counter works across API instances and expires on its own.
 */
@Injectable()
export class PublicSandboxRateLimitGuard implements CanActivate {
  private readonly limit = positiveInt(process.env.PUBLIC_SANDBOX_REQUEST_LIMIT, 20);
  private readonly windowSeconds = positiveInt(process.env.PUBLIC_SANDBOX_WINDOW_SECONDS, 600);

  constructor(@Inject(TOKENS.Redis) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const ip = request.ip || "unknown";
    // Nest is configured to trust exactly one known reverse proxy, so `req.ip`
    // reflects the visitor rather than the AetherHost proxy address.
    const key = `preflight:public-sandbox:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, this.windowSeconds);
    }
    if (count > this.limit) {
      throw new HttpException(
        `public sandbox limit reached; try again in a few minutes (${this.limit} evaluations per ${Math.ceil(this.windowSeconds / 60)} minutes)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
