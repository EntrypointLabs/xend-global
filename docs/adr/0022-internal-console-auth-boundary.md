# 0022: Internal tool auth boundary: server-rendered console behind a Basic Auth guard

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend platform team
**Tags:** backend, security, ops

## Context and Problem Statement

The Pay pilot needs an internal ops view over the payments, webhook delivery, and API key tables, plus a single action: redeliver a webhook delivery. No internal or admin auth exists anywhere in the backend today (grep-verified: no guard, no basic auth, no roles). Every existing auth path is either the consumer JWT (for app users) or the merchant API key and internal shared-secret guards (for the merchant-facing surfaces). An operator is none of those, so opening the console needs a new, deliberately scoped auth boundary. Because this is the first internal-tool auth pattern in the codebase, the boundary is worth recording so the next internal tool does not reinvent or over-build it.

The console itself is disposable pilot tooling: a read-only view with one write action, for a single operator, over a one-merchant pilot. It is explicitly NOT the merchant-facing self-serve portal (a fast-follow surface at merchants.xend.global that will consume the same read models and Phase 6 surfaces). This console neither becomes that portal nor constrains it.

## Decision Drivers

- One operator, one internal tool, disposable pilot scope. No multi-operator identity or audit requirements yet.
- The backend has no internal/admin auth precedent to reuse; whatever ships here is the precedent.
- Smallest thing that works: an internal tool earns no new workspace, deploy target, CORS surface, or client bundle.
- Keep the consumer and merchant auth surfaces uncontaminated: an operator is not a Consumer and not a Merchant.
- Fail-safe by default: an unconfigured console must not be reachable.

## Considered Options

1. **HTTP Basic Auth guard + browser-native prompt**: one `CanActivate` guard reading `CONSOLE_USER`/`CONSOLE_PASSWORD`; the 401 `WWW-Authenticate` challenge is the entire login UI.
2. **Session-cookie login page**: a rendered login form, a session store, and cookie management.
3. **Reuse the consumer JWT guard**: protect the console with the existing app-user auth.
4. **Network-level protection only**: no app-level auth; rely on private networking / VPN.

## Decision Outcome

Chosen option: **"HTTP Basic Auth guard + browser-native prompt"**, because it is the minimum app-level identity that gives a real credential check with zero new infrastructure. The browser's native Basic Auth dialog removes the need for any login page or client code, and a single ~40-line guard is trivially deletable when the console is retired or replaced by the portal.

The guard reads `CONSOLE_USER` and `CONSOLE_PASSWORD` from config. When either is unset or empty the console does not exist and every request is denied (fail-safe). Credentials are compared with `timingSafeEqual` over SHA-256 digests (digesting first equalizes lengths so the constant-time compare never throws). A denied request sets `WWW-Authenticate: Basic realm="Xend Console"` so the browser prompts natively. The console is read-only except for the single webhook redelivery POST, which calls Phase 6's in-process redelivery capability.

This scope is revisited when the console grows a write surface beyond redelivery, or when more than one operator needs distinct identities or an audit trail. At that point session-based auth with per-operator accounts becomes justified; it is not justified now.

### Consequences

- ✅ **Good:** Net-new auth is one small guard with no new dependencies, no login page, no session store.
- ✅ **Good:** Fail-safe: an environment without the two console vars has no reachable console at all.
- ✅ **Good:** The consumer JWT and merchant auth surfaces stay uncontaminated by operator concerns.
- ✅ **Good:** Deleting the ConsoleModule removes the tool and its auth in one step.
- ⚠️ **Bad:** Basic Auth is a shared single credential with no per-operator identity or audit line; acceptable at pilot, insufficient for multi-operator use.
- ⚠️ **Bad:** Credential rotation means an env change and redeploy; there is no in-app credential management.

## Pros and Cons of the Options

### HTTP Basic Auth guard + browser-native prompt

- ✅ Minimal code and zero new infrastructure.
- ✅ Browser-native prompt is the whole login UI.
- ✅ Fail-safe when unconfigured.
- ❌ Single shared credential; no per-operator identity or audit.

### Session-cookie login page

- ✅ Supports per-operator accounts and audit later.
- ❌ Login page, session store, and cookie handling are scale tooling for one operator today.
- ❌ More surface to secure (CSRF, session fixation) for no pilot benefit.

### Reuse the consumer JWT guard

- ✅ No new auth code.
- ❌ Consumers are not operators; conflating them is the same scope confusion that keeps merchant auth built beside, not on top of, the consumer JWT.
- ❌ Would grant any app user a path toward operator surfaces.

### Network-level protection only

- ✅ No app code at all.
- ❌ No app-level identity or audit line; a single network misconfiguration exposes everything.
- ❌ Does not satisfy "a visitor without credentials gets 401 on every console route."

## More Information

- Plan: `.claude/plans/pay-with-xend/phases/08-p2-surfaces/PLAN.md` (task 8.1)
- Source: `apps/backend/src/console/console-auth.guard.ts`, `apps/backend/src/console/console.controller.ts`, `apps/backend/src/console/console.service.ts`, `apps/backend/src/console/console-html.ts`
- Related: [ADR-0010](./0010-no-load-bearing-provider.md) (owned-interface posture), [ADR-0017](./0017-webhook-contract.md) (the delivery subsystem whose redelivery capability the console calls)
