import { Logger } from '@nestjs/common';
import { FeedbackRateLimitedError } from './feedback.errors';
import { FeedbackService } from './feedback.service';
import type { FeedbackStore, NewFeedback } from './feedback.store';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = new Date('2027-03-01T09:00:00.000Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

/**
 * Holds feedback the way the table does, and refuses to count or write
 * outside `oneAtATime`, so a limit checked without the lock fails here.
 */
class MemoryStore implements FeedbackStore {
  rows: (NewFeedback & { id: string })[] = [];
  private held: string | null = null;

  async oneAtATime<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    this.held = userId;
    try {
      return await fn();
    } finally {
      this.held = null;
    }
  }

  countSince(userId: string, since: Date): Promise<number> {
    this.requireHeld(userId);
    return Promise.resolve(
      this.rows.filter((r) => r.userId === userId && r.createdAt > since)
        .length,
    );
  }

  insert(row: NewFeedback): Promise<string> {
    this.requireHeld(row.userId);
    const id = `fb_${this.rows.length + 1}`;
    this.rows.push({ ...row, id });
    return Promise.resolve(id);
  }

  private requireHeld(userId: string): void {
    if (this.held !== userId) {
      throw new Error(`counted or wrote for ${userId} outside oneAtATime`);
    }
  }
}

const FEEDBACK = { message: 'The new home screen is much clearer.' };

describe('FeedbackService', () => {
  let store: MemoryStore;
  let service: FeedbackService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    store = new MemoryStore();
    service = new FeedbackService(store);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps the message, the rating and where it came from', async () => {
    const result = await service.create(
      'alice',
      { ...FEEDBACK, rating: 4, appVersion: '1.4.0', platform: 'android' },
      T0,
    );

    expect(result).toEqual({ id: 'fb_1' });
    expect(store.rows).toEqual([
      {
        id: 'fb_1',
        userId: 'alice',
        message: 'The new home screen is much clearer.',
        rating: 4,
        appVersion: '1.4.0',
        platform: 'android',
        createdAt: T0,
      },
    ]);
  });

  it('stores an unrated message with nothing in place of the rating', async () => {
    await service.create('alice', FEEDBACK, T0);

    expect(store.rows[0]).toMatchObject({
      rating: null,
      appVersion: null,
      platform: null,
    });
  });

  describe('the daily limit', () => {
    async function tenFrom(userId = 'alice') {
      for (let i = 0; i < 10; i += 1) {
        await service.create(userId, FEEDBACK, after(i * HOUR));
      }
    }

    it('takes ten in a day and refuses the eleventh', async () => {
      await tenFrom();

      await expect(
        service.create('alice', FEEDBACK, after(12 * HOUR)),
      ).rejects.toBeInstanceOf(FeedbackRateLimitedError);
      expect(store.rows).toHaveLength(10);
    });

    it('still refuses a millisecond before the first is a day old', async () => {
      await tenFrom();

      await expect(
        service.create('alice', FEEDBACK, after(DAY - 1)),
      ).rejects.toBeInstanceOf(FeedbackRateLimitedError);
    });

    it('has room again the moment the first is a day old', async () => {
      await tenFrom();

      await expect(
        service.create('alice', FEEDBACK, after(DAY)),
      ).resolves.toEqual({ id: 'fb_11' });
    });

    it('counts each Consumer on their own', async () => {
      await tenFrom();

      await expect(
        service.create('bob', FEEDBACK, after(12 * HOUR)),
      ).resolves.toEqual({ id: 'fb_11' });
    });
  });
});
