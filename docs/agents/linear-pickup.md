# Linear pickup: issue to pull request

Two project skills take a Linear issue in team `XEN` from `Todo` to a reviewed pull request:

```
Todo ──/linear-start──▶ In Progress ──/goal (issue description)──▶ /linear-finish ──▶ In Review + PR
                                              │
                                              └─ stuck ─▶ /linear-finish --blocked ──▶ Todo + needs-info
```

| Piece                                                                                | What it does                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`/linear-start [ID]`](../../.claude/skills/linear-start/SKILL.md)                   | Picks the issue (or the next ready one), moves it to `In Progress`, branches, saves the description verbatim and writes the `/goal` condition.                                                                                                  |
| `/goal …`                                                                            | Claude Code's built-in loop. It keeps working until the condition holds. The condition carries the full issue description (inline up to the 4,000 character limit, otherwise a pointer to the saved copy) and ends by running `/linear-finish`. |
| [`/linear-finish ID [--blocked "why"]`](../../.claude/skills/linear-finish/SKILL.md) | Verifies, pushes, opens the PR (`Closes XEN-n`), links it on the issue and moves the issue to `In Review`. With `--blocked`, it comments and moves the issue back to `Todo` with `needs-info` instead.                                          |
| [`run.mjs`](../../.claude/skills/linear-start/run.mjs)                               | The headless runner. Runs all three steps in one session, because a skill cannot call `/goal` itself.                                                                                                                                           |
| [`.claude/linear.json`](../../.claude/linear.json)                                   | Team, state names, pickup labels, and install and verify commands.                                                                                                                                                                              |

## Which issues get picked up

When no ID is given, the next issue picked is in `Todo`, carries `ready-for-agent`, and has none of `needs-info`, `needs-triage`, `ready-for-human` or `wontfix`. Ties go to the highest priority, then the oldest. Adding `ready-for-agent` is the triage step that hands an issue to the agent (see [triage-labels.md](triage-labels.md)). To take every `Todo` issue, set `pickup.requireLabel` to `null`.

## Running it

**In a session**, type:

```
/linear-start XEN-12
/goal Meet every condition in .claude/linear-runs/XEN-12.goal. Print that file in full first.
```

**Headless** (cron, CI, or behind a webhook). Sign in with a claude.ai account so the Linear connector loads. Connectors do not load with an API key or `CLAUDE_CODE_OAUTH_TOKEN`.

```sh
node .claude/skills/linear-start/run.mjs            # next ready issue
node .claude/skills/linear-start/run.mjs XEN-12     # a specific one
LINEAR_AGENT_CLAUDE_ARGS="--permission-mode auto --max-budget-usd 20" node .claude/skills/linear-start/run.mjs
```

**On a schedule, with no machine of your own**: create a Routine at claude.ai/code/routines with this repo, the Linear connector, an hourly trigger and this prompt:

```
/goal Ship the next ready Linear issue for this repository. First run /linear-start with no argument. If it prints "No ready issues", the goal is met and nothing else is needed. Otherwise print .claude/linear-runs/<ID>.goal in full, where <ID> is the issue it started, and meet every condition in that file.
```

Each run takes at most one issue. A new issue is picked up within the hour.

**On issue creation, instantly**: Claude Code hooks only fire on events inside a running session, so they cannot react to Linear. For instant pickup, point a Linear webhook (Issue → create) at a small relay that checks the `Linear-Signature` header. The relay then either runs `run.mjs <ID>`, or calls the Routine's API trigger (`POST /v1/claude_code/routines/<id>/fire`).

## Notes

- `.claude/linear-runs/` is scratch space for each run (description, goal, result). It is gitignored.
- The goal evaluator cannot read files; it only judges what is in the conversation. That is why `/linear-start` prints the description, and why the condition requires a printed checklist and verify output.
- Issue text becomes the agent's instructions. Only add `ready-for-agent` to issues written by people you trust.
