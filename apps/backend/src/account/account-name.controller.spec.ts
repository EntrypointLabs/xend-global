import {
  AccountNameController,
  RenameAccountSchema,
} from './account-name.controller';
import type { AccountEventsService } from '../activity/account-events.service';

function setup() {
  const recordWalletRenamed = jest.fn().mockResolvedValue(null);
  const controller = new AccountNameController({
    recordWalletRenamed,
  } as unknown as AccountEventsService);
  const req = { user: { userId: 'u1', walletAddress: 'w' } } as never;
  return { controller, recordWalletRenamed, req };
}

describe('AccountNameController', () => {
  it('records the rename so Activity can show it', async () => {
    const { controller, recordWalletRenamed, req } = setup();
    await controller.rename(req, { name: 'GiFTED!', previous: 'Account' });
    expect(recordWalletRenamed).toHaveBeenCalledWith('u1', {
      name: 'GiFTED!',
      previous: 'Account',
    });
  });

  it('records nothing when the name did not change', async () => {
    const { controller, recordWalletRenamed, req } = setup();
    await controller.rename(req, { name: 'Gift', previous: 'Gift' });
    expect(recordWalletRenamed).not.toHaveBeenCalled();
  });

  it('refuses an empty or overlong name', () => {
    expect(
      RenameAccountSchema.safeParse({ name: '   ', previous: null }).success,
    ).toBe(false);
    expect(
      RenameAccountSchema.safeParse({ name: 'x'.repeat(41), previous: null })
        .success,
    ).toBe(false);
  });
});
