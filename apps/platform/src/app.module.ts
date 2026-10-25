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

@Module({
  imports: [PlatformCoreModule],
  controllers: [
    HealthController,
    DashboardController,
    ReviewsController,
    AccountsController,
    BlobsController,
  ],
  providers: [ApiKeyGuard, InternalBlobGuard, AccountsService],
})
export class AppModule {}
