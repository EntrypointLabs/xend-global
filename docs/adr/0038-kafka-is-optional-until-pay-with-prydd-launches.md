# 0038: Kafka is optional until Pay with Prydd launches

**Status:** Accepted
**Date:** 2026-11-19
**Deciders:** Gift Opia
**Tags:** backend, infrastructure, pay

## Context and Problem Statement

[ADR-0012](./0012-pay-platform-topology.md) made a managed Kafka broker a boot requirement: `KAFKA_BROKERS` was required config and the producer connected at startup, so the backend could not start without a reachable broker.

The first launch is the mobile wallet only. Pay with Prydd (merchant checkout, merchant Payouts, Merchant webhooks) does not ship with it. Tracing every publisher and consumer shows that no wallet flow (send, receive, Earn, Swap, Accounts, sign-in) publishes an event. Everything that does publish is Pay: checkout Sessions, Payment intents and authorizations, settlement confirmation, and Payouts. Of the two consumers, Merchant webhook delivery exists only for Pay, and the Activity indexer is a fast path that the chain webhook and the reconciler sweep already cover.

Managed Kafka is the most expensive piece of infrastructure in the stack (the cheapest paid managed tiers start around $200 a month) and it would sit idle for the whole wallet launch.

## Decision Drivers

- The wallet launch must not depend on infrastructure only Pay uses.
- Hosting cost before there is any Pay traffic.
- [ADR-0010](./0010-no-load-bearing-provider.md): the broker already sits behind the `EVENT_PUBLISHER` and `EVENT_CONSUMER` seams, so swapping it is a change in one module.
- Turning Kafka back on must be configuration, not code.

## Considered Options

1. **Keep Kafka required** and provision a broker for the wallet launch.
2. **Make Kafka optional**: without `KAFKA_BROKERS`, events are logged and dropped.
3. **Replace Kafka** with a Postgres outbox (ADR-0012 option 2).

## Decision Outcome

Chosen option: **"Make Kafka optional"**, because it removes an idle paid dependency from the wallet launch while leaving ADR-0012's topology intact for when Pay ships.

`EventsModule` binds Kafka when `KAFKA_BROKERS` is set. When it is unset or blank, `EVENT_PUBLISHER` binds to `LoggingEventPublisher`, which logs each event's topic, key and correlation ID and drops it, and `EVENT_CONSUMER` binds to `DisabledEventConsumer`, whose subscriptions never fire. Both log a warning at boot so a missing broker is visible.

Pay with Prydd must not go live without a broker. Setting `KAFKA_BROKERS` (plus the SASL and TLS values for a managed broker) is a launch requirement for Pay, and ADR-0012 applies in full from then on.

### Consequences

- ✅ **Good:** the backend boots and serves the wallet with Postgres and Redis only.
- ✅ **Good:** enabling Kafka later is configuration only; no publishing or consuming code changes.
- ⚠️ **Bad:** without a broker, Merchant webhooks never fire and Pay events are lost, not queued. Running Pay in that mode would silently break merchants.
- ⚠️ **Bad:** a confirmed Payment reaches Activity through the chain webhook or the reconciler sweep rather than the event fast path. Wallet-only, there are no Payments, so this costs nothing yet.

## Pros and Cons of the Options

### Keep Kafka required

- ✅ No second code path.
- ❌ Pays for and operates a broker that carries no traffic during the wallet launch.

### Make Kafka optional

- ✅ One module changes; ADR-0012's design is untouched.
- ❌ A deployment can forget the broker. The boot warning is the only guard.

### Replace Kafka

- ✅ No broker at all, ever.
- ❌ Reverses ADR-0012's founder decision and rewrites the event layer before Pay has a single user.
