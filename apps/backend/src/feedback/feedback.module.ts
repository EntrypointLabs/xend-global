import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { DrizzleFeedbackStore, FEEDBACK_STORE } from './feedback.store';

@Module({
  controllers: [FeedbackController],
  providers: [
    { provide: FEEDBACK_STORE, useClass: DrizzleFeedbackStore },
    FeedbackService,
  ],
})
export class FeedbackModule {}
