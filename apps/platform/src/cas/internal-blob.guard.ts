import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/** CAS blobs contain customer release artifacts and are cluster-internal only. */
@Injectable()
export class InternalBlobGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configuredToken = process.env.INTERNAL_BLOB_TOKEN;
    if (!configuredToken) {
      throw new ServiceUnavailableException(
        "internal blob transport is disabled; set INTERNAL_BLOB_TOKEN to enable it",
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const presentedToken = request.header("x-blob-token");
    if (!presentedToken || !safeEqual(presentedToken, configuredToken)) {
      throw new UnauthorizedException("invalid internal blob credential");
    }
    return true;
  }
}

export function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
