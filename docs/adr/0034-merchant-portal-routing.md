# 0034: Merchant portal uses a dependency-free history router with a fixed top nav

**Status:** Accepted
**Date:** 2026-09-20
**Deciders:** Pay with Xend
**Tags:** frontend, merchant

## Context and Problem Statement

The Merchant portal switched pages with React state, so the URL never changed. A
refresh always returned to the overview, a page could not be linked to, and the
browser back and forward buttons did nothing useful. The production-readiness
sweep requires stable routes with refresh and deep-link support, predictable
back and forward behavior, and a global navigation that does not relocate
between pages.

## Decision Drivers

- Deep links and refresh must land on the right page.
- Back and forward must behave the way a browser user expects.
- The portal is small (a handful of pages), and its build already carries a large
  vendor chunk, so adding weight needs justification.
- Global navigation must stay in one place on every page; a page may add local
  navigation but must not move the application navigation.

## Considered Options

1. **Dependency-free history router.** A small hook over the History API and
   `popstate`, mapping the pathname to a page.
2. **react-router-dom.** The standard React routing library.
3. **Hash routing.** Encode the page in the URL fragment.

## Decision Outcome

Chosen option: the **dependency-free history router** (`apps/merchant/src/router.ts`).
It reads the pathname through `useSyncExternalStore`, pushes new paths with the
History API, and resolves a pathname to a page, including the payment-detail
route. For a surface this small it is a few dozen lines, adds no dependency to a
bundle that already warns on size, and gives real paths (not hash routes) so the
same URLs work behind the server-side history fallback documented for production.

The global navigation is the existing top bar, made sticky so it stays in place
while a long list scrolls, and rendered once in the shell so it is identical on
every page. The Developers page keeps its own local sub-navigation, which is
allowed as long as it does not move the application navigation.

### Consequences

- Good: no new dependency; deep links, refresh and back/forward all work.
- Good: the URL is the single source of truth for the current page.
- Bad: the router is bespoke, so anything beyond simple path matching (nested
  layouts, loaders) would have to be added by hand or would justify revisiting
  react-router.
- The static host must serve `index.html` for non-asset paths, or a deep link
  404s. This is configured in `apps/merchant/vercel.json` and documented in
  `docs/merchant-portal-production.md`.

## More Information

- Source: `apps/merchant/src/router.ts`, `apps/merchant/src/main.tsx`.
- `docs/merchant-portal-production.md` for the history fallback requirement.
