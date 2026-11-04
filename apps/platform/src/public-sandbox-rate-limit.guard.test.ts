import { describe, expect, it } from "vitest";
import { PublicSandboxRateLimitGuard } from "./public-sandbox-rate-limit.guard";

class FakeRedis {
  count = 0;
  async incr() {
    this.count += 1;
    return this.count;
  }
  async expire() {
    return 1;
  }
}

function context(ip: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as never;
}

describe("PublicSandboxRateLimitGuard", () => {
  it("allows the configured window then rejects additional evaluations", async () => {
    const original = process.env.PUBLIC_SANDBOX_REQUEST_LIMIT;
    process.env.PUBLIC_SANDBOX_REQUEST_LIMIT = "2";
    const guard = new PublicSandboxRateLimitGuard(new FakeRedis() as never);
    await expect(guard.canActivate(context("203.0.113.10"))).resolves.toBe(true);
    await expect(guard.canActivate(context("203.0.113.10"))).resolves.toBe(true);
    await expect(guard.canActivate(context("203.0.113.10"))).rejects.toMatchObject({ status: 429 });
    if (original === undefined) delete process.env.PUBLIC_SANDBOX_REQUEST_LIMIT;
    else process.env.PUBLIC_SANDBOX_REQUEST_LIMIT = original;
  });
});
