import { Controller, Get, Header, ServiceUnavailableException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import type Redis from "ioredis";
import { PrismaService } from "./prisma.service";
import { TOKENS } from "./tokens";
import { registry } from "./observability/metrics";
import { OperationsService } from "./observability/operations.service";

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOKENS.Redis) private readonly redis: Redis,
    private readonly operations: OperationsService,
  ) {}

  @Get("health/live")
  live() {
    return { status: "ok" };
  }

  @Get("health/ready")
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const pong = await this.redis.ping();
      if (pong !== "PONG") throw new Error("redis not pong");
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException({ status: "not_ready" });
    }
  }

  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4")
  async metrics() {
    await this.operations.snapshot();
    return registry.metrics();
  }

  @Get("health/operations")
  async operationsSnapshot() {
    return this.operations.snapshot();
  }
}
