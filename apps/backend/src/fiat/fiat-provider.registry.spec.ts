import { ConfigService } from '@nestjs/config';
import { FiatProviderRegistry } from './fiat-provider.registry';
import { SimulatorFiatProvider } from './providers/simulator-fiat.provider';

describe('FiatProviderRegistry release gates', () => {
  function setup(values: Record<string, string>) {
    const provider = new SimulatorFiatProvider();
    const registry = new FiatProviderRegistry([provider], {
      get: (key: string) => values[key],
    } as ConfigService);
    return { provider, registry };
  }
  it('defaults to no providers', async () => {
    const { registry } = setup({ NODE_ENV: 'test' });
    expect(await registry.routes()).toEqual([]);
    expect(() => registry.provider('simulator')).toThrow();
  });
  it('disables this entire slice in production even when explicitly configured', async () => {
    const { registry, provider } = setup({
      NODE_ENV: 'production',
      FIAT_ENABLED_PROVIDERS: 'simulator,fonbnk',
    });
    const discovery = jest.spyOn(provider, 'routes');
    expect(await registry.routes()).toEqual([]);
    await expect(registry.route('simulator:send')).rejects.toThrow();
    expect(() => registry.provider('simulator')).toThrow();
    expect(discovery).not.toHaveBeenCalled();
  });
  it('exposes only explicitly enabled routes and contains discovery failures', async () => {
    const { registry, provider } = setup({
      NODE_ENV: 'test',
      FIAT_ENABLED_PROVIDERS: ' simulator ',
    });
    expect((await registry.routes()).map((r) => r.id)).toEqual([
      'simulator:receive',
      'simulator:send',
    ]);
    jest
      .spyOn(provider, 'routes')
      .mockRejectedValue(new Error('provider unavailable'));
    expect(await registry.routes()).toEqual([]);
    await expect(registry.route('simulator:receive')).rejects.toThrow();
  });
});
