import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MailDeliveryError, ResendMailer } from './resend.mailer';

const SETTINGS: Record<string, string> = {
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'Prydd <security@prydd.co>',
};

function makeMailer() {
  return new ResendMailer({
    getOrThrow: (key: string) => SETTINGS[key],
  } as unknown as ConfigService);
}

describe('ResendMailer', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"id":"mail_1"}', { status: 200 }));
  });

  afterEach(() => jest.restoreAllMocks());

  const sentBody = () => {
    const [, init] = fetchMock.mock.calls[0];
    return JSON.parse(init?.body as string) as Record<string, unknown>;
  };

  it('posts the mail to Resend under the configured sender and key', async () => {
    await makeMailer().send({
      to: 'consumer@example.com',
      subject: 'Your Prydd recovery code',
      text: '123456',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer re_test_key',
    });
    expect(sentBody()).toEqual({
      from: 'Prydd <security@prydd.co>',
      to: ['consumer@example.com'],
      subject: 'Your Prydd recovery code',
      text: '123456',
    });
  });

  it("carries a reply-to under Resend's own field name when one is given", async () => {
    await makeMailer().send({
      to: 'support@prydd.test',
      subject: 'Support request: Payments',
      text: 'A payment did not arrive.',
      replyTo: 'consumer@example.com',
    });

    expect(sentBody()).toMatchObject({ reply_to: 'consumer@example.com' });
    expect(sentBody()).not.toHaveProperty('replyTo');
  });

  it('sends no reply-to field at all when none is given', async () => {
    await makeMailer().send({ to: 'a@example.com', subject: 's', text: 't' });

    expect(sentBody()).not.toHaveProperty('reply_to');
  });

  it('fails with its own error when the provider refuses the mail', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 422 }));

    await expect(
      makeMailer().send({ to: 'a@example.com', subject: 's', text: 't' }),
    ).rejects.toBeInstanceOf(MailDeliveryError);
  });
});
