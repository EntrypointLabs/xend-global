import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_MODULE_TEST_ENV } from '../app.module.test-env';

/**
 * Loads the real config module under the given environment and waits on its
 * validation, which runs when the module is loaded.
 */
function boot(env: Record<string, string>): Promise<unknown> {
  delete process.env.SUPPORT_INBOX_EMAIL;
  Object.assign(process.env, APP_MODULE_TEST_ENV, env);
  let validated: Promise<unknown> = Promise.resolve();
  jest.isolateModules(() => {
    const { ConfigModule } = jest.requireActual<
      typeof import('../config/config.module')
    >('../config/config.module');
    [validated] = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ConfigModule,
    ) as Promise<unknown>[];
  });
  return validated;
}

describe('Support inbox configuration', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  });

  it.each([
    ['nothing set', {}],
    ['the inbox blank', { SUPPORT_INBOX_EMAIL: '' }],
    ['an inbox', { SUPPORT_INBOX_EMAIL: 'support@prydd.test' }],
  ])('boots with %s', async (_label, env) => {
    await expect(boot(env)).resolves.toBeDefined();
  });

  it.each([
    ['a name with no domain', 'support'],
    ['two addresses', 'a@prydd.test,b@prydd.test'],
    ['a display name around the address', 'Support <support@prydd.test>'],
  ])('refuses to boot with %s for an inbox', async (_label, value) => {
    await expect(boot({ SUPPORT_INBOX_EMAIL: value })).rejects.toThrow(
      /SUPPORT_INBOX_EMAIL/,
    );
  });
});
