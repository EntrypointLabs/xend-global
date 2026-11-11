import { ConfigService } from '@nestjs/config';
import { FeaturesController } from './features.controller';

function controllerWith(switches: Record<string, boolean>): FeaturesController {
  const config = {
    get: (key: string) => switches[key],
  } as unknown as ConfigService;
  return new FeaturesController(config);
}

describe('FeaturesController', () => {
  it('allows every feature when no kill switch is set', () => {
    expect(controllerWith({}).current()).toEqual({
      swap: true,
      earnDeposits: true,
      hideMyWallet: true,
    });
  });

  it.each([
    ['SWAP_KILLSWITCH', 'swap'],
    ['EARN_DEPOSITS_KILLSWITCH', 'earnDeposits'],
    ['HIDE_MY_WALLET_KILLSWITCH', 'hideMyWallet'],
  ])('%s switches off %s and nothing else', (key, feature) => {
    const features = controllerWith({ [key]: true }).current();

    expect(features).toEqual({
      swap: feature !== 'swap',
      earnDeposits: feature !== 'earnDeposits',
      hideMyWallet: feature !== 'hideMyWallet',
    });
  });

  it('keeps a feature on when its switch is explicitly off', () => {
    expect(controllerWith({ SWAP_KILLSWITCH: false }).current().swap).toBe(
      true,
    );
  });
});
