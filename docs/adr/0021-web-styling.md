# 0021: Web styling: Tailwind v4 CSS-first for web surfaces, NativeWind stays mobile-only

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend planning
**Tags:** frontend, styling, checkout

## Context and Problem Statement

ADR 0001 consolidated the codebase on NativeWind 4 with CSS-variable tokens as the sole styling system. That decision was made when the only UI in the repo was the Expo mobile app, and NativeWind is a React Native dialect with a runtime. The Pay with Xend work introduces the first web surface, the hosted checkout at pay.xend.global, and more web surfaces (a merchant console) are coming. NativeWind is the wrong tool for a browser surface: it carries a React Native runtime and a dialect that does not belong in a sub-second popup budget, and the checkout bundle size is a product feature.

There is also a third surface class: the merchant SDK (Phase 7), which embeds into arbitrary merchant pages and must ship zero dependencies and no build step. It cannot ship a Tailwind runtime or a stylesheet a merchant has to include.

We need a written record of how each surface class is styled so ADR 0001 is not read as forbidding the web approach, and so future web work does not reach for the mobile Tailwind config.

## Decision Drivers

- The checkout popup has a strict bundle and latency budget; a styling runtime cost is unacceptable.
- NativeWind is a React Native dialect and runtime, unsuited to a browser surface.
- The merchant SDK embeds into third-party pages and must be zero-dependency with no build step, so it cannot ship a Tailwind runtime.
- ADR 0001 must stay valid for mobile while not blocking the web path.

## Considered Options

1. **Tailwind v4 CSS-first for web, NativeWind mobile-only, hand-rolled CSS for the SDK** - each surface class uses the styling approach that fits its constraints.
2. **Extend NativeWind to web** - reuse the mobile styling system on the browser surface.
3. **Share the mobile Tailwind v3 config across web and mobile** - one config to rule them all.
4. **Runtime CSS-in-JS on web** - a JS styling library for the checkout surface.

## Decision Outcome

Chosen option: **"Tailwind v4 CSS-first for web, NativeWind mobile-only, hand-rolled CSS for the SDK"**, because it gives each surface class the approach that fits its constraints without a shared runtime cost.

- ADR 0001's NativeWind consolidation is scoped to the mobile app (`apps/mobile`). Phase 7 adds a scope note on ADR 0001 pointing here so the "sole styling system" wording is read as mobile-scoped.
- Web surfaces (the checkout, the future console) use Tailwind v4 CSS-first via `@tailwindcss/vite`, with design tokens declared in an `@theme` block in CSS. No `tailwind.config.js`, no PostCSS config. The checkout defines its brand tokens (brand black `#0a0a0a`, a single success green, the display font) in `src/index.css`.
- The zero-dependency embeddable merchant SDK hand-rolls scoped CSS, because it cannot ship a Tailwind runtime or a build step into a merchant page.

### Consequences

- Good: the checkout surface pays no styling runtime cost and stays within its bundle and latency budget.
- Good: each surface class uses the right tool; the mobile app is untouched and ADR 0001 stays valid.
- Good: the SDK styling approach is recorded before Phase 7 needs it, so the sentinel flag is reconciled.
- Bad: the repo now has more than one styling approach, so a contributor must know which surface class they are in. This ADR plus the ADR 0001 scope note is the map.
- Bad: tokens are defined per web surface rather than shared, so the checkout and the console will each declare their brand tokens until a shared web token package is worth extracting.

## Pros and Cons of the Options

### Tailwind v4 CSS-first for web, NativeWind mobile-only, hand-rolled CSS for the SDK

- Good: fits each surface's constraints with no shared runtime cost.
- Good: keeps ADR 0001 valid for mobile and unblocks web.
- Bad: more than one styling approach in the repo.

### Extend NativeWind to web

- Good: one styling system across surfaces.
- Bad: ships a React Native dialect and runtime into a sub-second popup budget. Wrong tool for a browser surface.

### Share the mobile Tailwind v3 config

- Good: one config.
- Bad: the mobile config is NativeWind-coupled and Tailwind v3; the current web path is Tailwind v4 CSS-first. Coupling web to the mobile config drags mobile concerns into web.

### Runtime CSS-in-JS on web

- Good: ergonomic component styling.
- Bad: a runtime cost against the bundle budget, which is the exact thing the checkout surface cannot afford.

## More Information

- Plan: `.claude/plans/pay-with-xend/phases/05-checkout-surface/PLAN.md`
- Related: [ADR-0001](./0001-consolidate-on-nativewind-styling.md) (NativeWind consolidation, mobile-scoped), [ADR-0016](./0016-checkout-postmessage-protocol.md) (checkout surface)
- Source: `apps/checkout/src/index.css`, `apps/checkout/vite.config.ts`
