import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { LoggerModule } from "nestjs-pino";
import Redis from "ioredis";
import { CliScanner } from "@preflight/scanner";
import { PrismaService } from "./prisma.service";
import { PrismaProjectRepository, PrismaReviewRepository } from "./persistence/prisma-repos";
import { DiskArtifactStorage } from "./persistence/disk-storage";
import { CasArtifactStorage } from "./cas/cas-artifact-storage";
import { CasEngine } from "./cas/cas-engine";
import { BullReviewQueue, REVIEW_QUEUE_NAME } from "./queue/bull-review.queue";
import { ReviewsService } from "./reviews/reviews.service";
import { TOKENS } from "./tokens";
import { OperationsService } from "./observability/operations.service";

export function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

export function redisConnection() {
  const url = new URL(redisUrl());
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    maxRetriesPerRequest: null as null,
  };
}

@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        autoLogging: true,
        redact: ["req.headers.authorization", "req.headers['x-api-key']"],
      },
    }),
    BullModule.forRoot({
      connection: redisConnection(),
    }),
    BullModule.registerQueue({ name: REVIEW_QUEUE_NAME }),
  ],
  providers: [
    PrismaService,
    OperationsService,
    PrismaReviewRepository,
    PrismaProjectRepository,
    { provide: DiskArtifactStorage, useFactory: () => new DiskArtifactStorage() },
    { provide: CasEngine, useFactory: () => new CasEngine() },
    { provide: CasArtifactStorage, useFactory: () => new CasArtifactStorage() },
    BullReviewQueue,
    { provide: TOKENS.ReviewRepository, useExisting: PrismaReviewRepository },
    { provide: TOKENS.ProjectRepository, useExisting: PrismaProjectRepository },
    { provide: TOKENS.ReviewQueue, useExisting: BullReviewQueue },
    {
      provide: TOKENS.ArtifactStorage,
      useFactory: (cas: CasArtifactStorage, disk: DiskArtifactStorage) => {
        return process.env.STORAGE_DRIVER === "disk" ? disk : cas;
      },
      inject: [CasArtifactStorage, DiskArtifactStorage],
    },
    {
      provide: TOKENS.Scanner,
      useFactory: () => new CliScanner({ bin: process.env.PREFLIGHT_BIN ?? "preflight" }),
    },
    {
      provide: TOKENS.Redis,
      useFactory: () => new Redis(redisUrl(), { maxRetriesPerRequest: null }),
    },
    {
      provide: ReviewsService,
      useFactory: (
        reviews: import("@preflight/domain").ReviewRepository,
        projects: import("./reviews/reviews.service").ProjectRepository,
        queue: import("@preflight/domain").ReviewQueue,
        storage: import("./reviews/reviews.service").ArtifactStorage,
      ) => new ReviewsService(reviews, projects, queue, storage),
      inject: [
        TOKENS.ReviewRepository,
        TOKENS.ProjectRepository,
        TOKENS.ReviewQueue,
        TOKENS.ArtifactStorage,
      ],
    },
  ],
  exports: [
    PrismaService,
    OperationsService,
    PrismaReviewRepository,
    PrismaProjectRepository,
    ReviewsService,
    CasEngine,
    CasArtifactStorage,
    DiskArtifactStorage,
    TOKENS.ReviewRepository,
    TOKENS.ProjectRepository,
    TOKENS.ReviewQueue,
    TOKENS.ArtifactStorage,
    TOKENS.Scanner,
    TOKENS.Redis,
    BullModule,
  ],
})
export class PlatformCoreModule {}
