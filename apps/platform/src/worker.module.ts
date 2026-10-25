import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PlatformCoreModule } from "./platform-core.module";
import { ReviewProcessor } from "./queue/review.processor";
import { OutboxPublisher } from "./queue/outbox.publisher";
import { SlackNotifier } from "./notifications/slack-notifier";

@Module({
  imports: [PlatformCoreModule, ScheduleModule.forRoot()],
  providers: [ReviewProcessor, OutboxPublisher, SlackNotifier],
})
export class WorkerModule {}
