import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CreateFeedback, CreateFeedbackResponse } from './dtos';
import { FeedbackRateLimitedError } from './feedback.errors';
import { FEEDBACK_STORE, type FeedbackStore } from './feedback.store';

const MAX_MESSAGES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps what a Consumer tells the team about the app.
 *
 * Stored and nothing else: unlike a support request nobody is waiting on an
 * answer, so nothing is mailed and the team reads it in the console.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(@Inject(FEEDBACK_STORE) private readonly store: FeedbackStore) {}

  async create(
    userId: string,
    request: CreateFeedback,
    now = new Date(),
  ): Promise<CreateFeedbackResponse> {
    const id = await this.store.oneAtATime(userId, async () => {
      const recent = await this.store.countSince(
        userId,
        new Date(now.getTime() - DAY_MS),
      );
      if (recent >= MAX_MESSAGES_PER_DAY) throw new FeedbackRateLimitedError();
      return this.store.insert({
        userId,
        message: request.message,
        rating: request.rating ?? null,
        appVersion: request.appVersion ?? null,
        platform: request.platform ?? null,
        createdAt: now,
      });
    });
    this.logger.log(`feedback.stored id=${id} user_id=${userId}`);
    return { id };
  }
}
