import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleMailer } from './console.mailer';
import { MAILER } from './mail.interface';
import { ResendMailer } from './resend.mailer';

/**
 * Resend when a key is configured, the log when there is none.
 *
 * The fallback is refused outside development on purpose. Recovery codes are
 * the only mail we send, and a production deployment that prints them to its
 * own logs has replaced a second factor with a log file.
 */
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('RESEND_API_KEY');
        if (apiKey) return new ResendMailer(config);

        // Explicitly development, not merely "not production". NODE_ENV is
        // defaulted rather than required, so a deployment that forgets to set
        // it would otherwise boot writing recovery codes to its own logs,
        // which turns the inbox factor into whoever can read them.
        if (config.get<string>('NODE_ENV') !== 'development') {
          throw new Error(
            'RESEND_API_KEY is unset and NODE_ENV is not development: refusing to log recovery codes',
          );
        }
        new Logger('MailModule').warn(
          'mail.console_fallback RESEND_API_KEY is unset; codes will be logged, not sent',
        );
        return new ConsoleMailer();
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
