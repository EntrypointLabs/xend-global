# 0039: The backend is quiet while nobody uses the app

**Status:** Accepted
**Date:** 2026-11-19
**Deciders:** Prydd
**Tags:** backend, infrastructure, cost

## Context and Problem Statement

The wallet launches to a few dozen sparse users, without Pay with Prydd, on a
host where the cheapest Postgres is a scale-to-zero one: it bills per hour
awake and suspends after five idle minutes. The backend never let it suspend.
Timed jobs queried Postgres every 30 seconds to 10 minutes whether or not
anyone was using the app, and the container health check pinged Postgres and
Redis every 30 seconds. An idle database stayed awake around the clock, which
on Neon is roughly $20 a month against close to nothing.

The Helius webhook was already the primary path for incoming transfers and
their push notifications. Most of the timers were safety nets for it.

## Decision Drivers

- No Postgres or Redis query while nobody is using the app, so a scale-to-zero
  database can sleep.
- Keep every safety net the timers provided where a user would notice its
  absence: a send stuck at "Sending", a deposit missing from activity, a
  settings change nobody announced.
- The Settings time lock only protects a Consumer who hears about a change in
  time, so that notice must not get slower.
- Pay with Prydd is not live; its jobs have nothing to do until it is.

## Considered Options

1. **Keep polling, slower**: stretch every interval to an hour or more.
2. **Arm each safety net from the event that needs it**: do the work when a
   request or a webhook delivery says there is work, and only then.
3. **Move the timers to an external scheduler**: a platform cron that calls an
   endpoint.

## Decision Outcome

Chosen option: **"Arm each safety net from the event that needs it"**, because
it is the only option that reaches zero idle queries without making any
user-visible correction slower.

| Job                                                                                                                        | Before                                     | After                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pending sends (`ReconcilerService.tick`)                                                                                   | every 30s                                  | Armed when a send is submitted; first look 30s later, then every 30s while a send is still PENDING (every 10 min once every PENDING send is over an hour old); stops when none are. One check at boot for sends a restart left PENDING. |
| Missed-deposit replay (`ReconcilerService.sweep`)                                                                          | every 5 min, every wallet                  | Removed. Boot replay stays. A Consumer's own wallets are replayed when they fetch their activity (`GET /transfers`, first page), at most once per 5 minutes each, waiting up to 3s before answering.                                    |
| Unannounced settings changes (`AccountChangeWatcher`)                                                                      | every 5 min, every Account                 | Each Account's Settings address is subscribed to the activity webhook, and any delivery touching it is checked immediately. A full sweep runs hourly as the backstop.                                                                   |
| Abandoned sign-ups (`SignupReaper`)                                                                                        | every 10 min                               | Daily.                                                                                                                                                                                                                                  |
| Pay jobs: settlement confirmation, Merchant webhook retries, Payment expiry and repair, off-ramp reconcile, capacity purge | 30s to daily                               | Off unless `PAY_WITH_PRYDD_ENABLED` is set, and the routes that create or move Payments refuse while it is off.                                                                                                                         |
| Naira sandbox stale sweeps (accounts, transfers)                                                                           | every 60s, in every environment            | Only where the sandbox is available, never in production.                                                                                                                                                                               |
| Container health check                                                                                                     | `GET /health` (Postgres + Redis) every 30s | `GET /health/live`, which touches neither. `GET /health` stays as the readiness check.                                                                                                                                                  |

The sandbox simulator worker and the Nomba requery loop already return before
any query outside a configured non-production sandbox, and are unchanged.

### Consequences

- ✅ **Good:** an idle backend makes no database query, so Postgres can suspend
  between uses. A send-free, sign-in-free hour costs one hourly settings sweep,
  which wakes the database for about five minutes.
- ✅ **Good:** an unannounced settings change is noticed when its transaction is
  delivered, not up to five minutes later.
- ✅ **Good:** a stuck send is finalized on the same schedule as before.
- ⚠️ **Bad:** if Helius drops a deposit's webhook delivery while the process is
  up, its push notification is lost and the activity row appears only when the
  Consumer next opens the app (or at the next restart). Before, the five-minute
  sweep sent the push late. Balances read from chain and are unaffected.
- ⚠️ **Bad:** the pending check and the catch-up window live in process memory.
  With more than one instance, a send is watched by the instance that took it,
  and a restart drops the timer until the boot check re-arms it.
- ⚠️ **Bad:** Accounts created before this change have no Settings
  subscription; for them the hourly sweep is the only watcher.
- ⚠️ **Bad:** Pay with Prydd cannot go live without `PAY_WITH_PRYDD_ENABLED`.
  With it unset, the routes that create or move Payments (the Merchant API,
  Checkout, refunds, and preparing or submitting a pending Payment) answer
  404, so no Payment is accepted that the disabled jobs would then strand.
  Reading pending Payments stays open and returns none.
- ⚠️ **Bad:** the platform's health check has to be pointed at
  `GET /health/live`; left on `GET /health` it keeps the database awake.

## Pros and Cons of the Options

### Keep polling, slower

- ✅ Smallest change.
- ❌ Every interval still wakes the database, so the saving is partial.
- ❌ A slower settings poll eats into the time lock a Consumer has to react.

### Arm each safety net from the event that needs it

- ✅ Zero idle queries.
- ✅ Settings notice gets faster, sends are no slower.
- ❌ A dropped deposit webhook now waits for the Consumer to open the app.
- ❌ More moving parts than a cron decorator: timers, a per-user rate limit, a
  webhook-to-watcher signal.

### Move the timers to an external scheduler

- ✅ Survives restarts and works across instances.
- ❌ Still runs on a schedule, so still wakes the database.
- ❌ Another service to configure and secure.

## More Information

- Pending check and catch-up: `apps/backend/src/activity/reconciler.service.ts`
- Settings watcher and the webhook signal: `apps/backend/src/account/account-change.watcher.ts`, `apps/backend/src/activity/settings-activity.signal.ts`
- Pay flag: `apps/backend/src/config/pay-with-prydd.ts`
- Liveness: `apps/backend/src/health/health.controller.ts`
