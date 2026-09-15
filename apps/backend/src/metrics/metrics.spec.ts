import { metricsRegistry, paymentIntentTransitions } from './metrics';

describe('paymentIntentTransitions', () => {
  beforeEach(() => paymentIntentTransitions.reset());

  it('counts each from/to pair separately and renders in Prometheus text', async () => {
    paymentIntentTransitions.inc({ from: 'created', to: 'authorized' });
    paymentIntentTransitions.inc({ from: 'created', to: 'authorized' });
    paymentIntentTransitions.inc({ from: 'settling', to: 'succeeded' });

    const metric = await paymentIntentTransitions.get();
    const value = (from: string, to: string) =>
      metric.values.find((v) => v.labels.from === from && v.labels.to === to)
        ?.value;
    expect(value('created', 'authorized')).toBe(2);
    expect(value('settling', 'succeeded')).toBe(1);

    const text = await metricsRegistry.metrics();
    expect(text).toContain(
      'xend_payment_intent_transitions_total{from="created",to="authorized"} 2',
    );
  });
});
