import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { InternalBlobGuard, safeEqual } from "./internal-blob.guard";

const originalToken = process.env.INTERNAL_BLOB_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.INTERNAL_BLOB_TOKEN;
  else process.env.INTERNAL_BLOB_TOKEN = originalToken;
});

function contextWithToken(token?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ header: () => token }),
    }),
  } as unknown as ExecutionContext;
}

describe("InternalBlobGuard", () => {
  it("uses constant-time comparison only for equal-length values", () => {
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "nope")).toBe(false);
    expect(safeEqual("short", "longer")).toBe(false);
  });

  it("fails closed when remote CAS transport is not configured", () => {
    delete process.env.INTERNAL_BLOB_TOKEN;
    expect(() => new InternalBlobGuard().canActivate(contextWithToken("anything"))).toThrow(
      ServiceUnavailableException,
    );
  });

  it("accepts only the configured internal credential", () => {
    process.env.INTERNAL_BLOB_TOKEN = "cluster-secret";
    const guard = new InternalBlobGuard();
    expect(guard.canActivate(contextWithToken("cluster-secret"))).toBe(true);
    expect(() => guard.canActivate(contextWithToken("wrong-secret"))).toThrow(
      UnauthorizedException,
    );
  });
});
