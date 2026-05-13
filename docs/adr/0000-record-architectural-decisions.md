# 0000: Record architectural decisions

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** meta, process

## Context and Problem Statement

The `fuse-android` monorepo has accumulated meaningful architectural decisions — choice of styling system, theme strategy, auth flow, monorepo layout, dual-client pattern between mobile and the NestJS backend — but those decisions live only in PR descriptions, chat history, and contributors' heads. New contributors (or future-us) repeatedly ask "wait, why is it shaped this way?" and have to spelunk through git or guess.

We need a lightweight, durable place to capture **why** we made decisions, not just **what** we built.

## Decision Drivers

- Low ceremony — the format must be writable in 15 minutes, not 2 hours, or we won't use it.
- Discoverable — sits in the repo, not a wiki, so it shows up in code search and survives team changes.
- Versioned — lives next to the code it constrains, evolves with the codebase, history is git-native.
- Immutable per record — decisions don't get rewritten retroactively; superseding is explicit.
- Conventionally formatted — readers familiar with ADRs elsewhere should not have to learn a new shape.

## Considered Options

1. **MADR (Markdown Any Decision Record)** — Structured markdown template with explicit Context, Decision Drivers, Considered Options, Decision Outcome, Consequences sections. Widely adopted. Tooling exists (`adr-tools`, `log4brains`).
2. **Lightweight Nygard format** — Original three-section format (Context / Decision / Consequences). Faster to write but loses the "decision drivers" and "considered options" detail that protects against decision rot.
3. **Confluence / Notion / external wiki** — Centralized doc site. Easier to format but lives outside the codebase, no versioning, and contributors forget it exists.
4. **No formal record** — Continue relying on PR descriptions and chat. Status quo.

## Decision Outcome

Chosen option: **"MADR (Markdown Any Decision Record)"**, because it gives enough structure to make a decision durable without the friction of a heavier process, and contributors arriving from other JavaScript / TypeScript ecosystems are likely already familiar with the format.

### Consequences

- ✅ Decisions are versioned alongside the code they constrain — `docs/adr/` lives in the repo.
- ✅ Future contributors discover ADRs by grepping or reading `docs/adr/README.md`.
- ✅ Superseding is explicit — a new ADR cites the old one and the old one's status flips to `Superseded`.
- ✅ Format is conventional — onboarding to "how we record decisions" is one paragraph.
- ⚠️ Discipline required — ADRs are useful only if we actually write them when decisions happen.
- ⚠️ Drift risk — if a decision changes silently in code without an ADR update, the record becomes misleading.

## Pros and Cons of the Options

### MADR

- ✅ Structured enough to capture rationale, lightweight enough that 15 minutes per ADR is realistic.
- ✅ Active community, public template, adopted by many TypeScript/Node projects.
- ❌ "Considered Options" section sometimes feels heavy for decisions with only one real option — we accept this minor verbosity.

### Lightweight Nygard

- ✅ Faster to write than MADR.
- ❌ Loses the "what alternatives did we reject and why" detail, which is the part that ages best.
- ❌ Less familiar to contributors arriving from MADR-shaped codebases.

### Confluence / Notion / external wiki

- ❌ Lives outside the repo — broken when the wiki goes down, gets stale during team changes, easily forgotten.
- ❌ No git-native versioning of the decisions themselves.

### No formal record

- ❌ Continues the current pain — knowledge stays in heads and PRs, new contributors repeatedly ask why.

## More Information

- [MADR specification](https://adr.github.io/madr/)
- [Michael Nygard's original blog post on ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [adr-tools CLI](https://github.com/npryce/adr-tools)
- `docs/adr/README.md` — index, conventions, and "when to write an ADR" guidance
- `docs/adr/TEMPLATE.md` — copy this when starting a new ADR
