import { Module } from "@nestjs/common";
import { PlatformCoreModule } from "./platform-core.module";
import { ApiKeyGuard } from "./auth/api-key.guard";
import { ReviewsController } from "./reviews/reviews.controller";
import { HealthController } from "./health.controller";
import { DashboardController } from "./dashboard.controller";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { BlobsController } from "./cas/blobs.controller";
import { InternalBlobGuard } from "./cas/internal-blob.guard";
import { WorkosAuthController } from "./auth/workos-auth.controller";
import { WorkosAuthService } from "./auth/workos-auth.service";
import { OperatorController } from "./operator/operator.controller";
import { OperatorGuard } from "./operator/operator.guard";
import { PublicSandboxRateLimitGuard } from "./public-sandbox-rate-limit.guard";

@Module({
  imports: [PlatformCoreModule],
  controllers: [
    HealthController,
    DashboardController,
    ReviewsController,
    AccountsController,
    BlobsController,
    WorkosAuthController,
    OperatorController,
  ],
  providers: [
    ApiKeyGuard,
    InternalBlobGuard,
    AccountsService,
    WorkosAuthService,
    OperatorGuard,
    PublicSandboxRateLimitGuard,
  ],
})
export class AppModule {}
