# Triage Labels

The skills speak in terms of canonical triage roles. This file maps those roles to the actual label strings used in Linear team `XEN`.

## Category labels (already in Linear)

| Canonical role | Linear label | Linear label ID                        |
| -------------- | ------------ | -------------------------------------- |
| `bug`          | `Bug`        | `d5a0acc6-c8a6-4351-8856-9df13f3ea338` |
| `enhancement`  | `Feature`    | `9ad10c55-1088-488c-8184-bb7ea7084e33` |

The `Improvement` label (`a5863911-635f-4231-86ea-e21600427ef0`) also exists and may be used for smaller-scope enhancements at the maintainer's discretion.

## State labels

These are not yet created in Linear. Create them on first use via `mcp__claude_ai_Linear__create_issue_label`.

| Canonical role    | Linear label string | Meaning                                  |
| ----------------- | ------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`      | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`        | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`   | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`   | Requires human implementation            |
| `wontfix`         | `wontfix`           | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string above.
