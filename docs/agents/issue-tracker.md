# Issue tracker: Linear

Issues and PRDs for this repo live in Linear, team **XEND** (key `XEN`), workspace `entrypoint`.

- Team URL: https://linear.app/entrypoint/team/XEN/active
- Team ID: `d275df46-2c4d-4566-ae87-9451574f8217`

Use the Linear MCP tools (prefix `mcp__claude_ai_Linear__`) for all operations. Never shell out to `gh` or assume a GitHub-issue workflow.

## Conventions

- **Create an issue**: `mcp__claude_ai_Linear__save_issue` with `team: "XEN"`.
- **Read an issue**: `mcp__claude_ai_Linear__get_issue` + `mcp__claude_ai_Linear__list_comments` for the comment thread.
- **List issues**: `mcp__claude_ai_Linear__list_issues` with `team: "XEN"` and appropriate filters (state, labels, updated-since).
- **Comment on an issue**: `mcp__claude_ai_Linear__save_comment`.
- **Apply / remove labels**: `mcp__claude_ai_Linear__save_issue` with the updated label set. Look up label IDs via `mcp__claude_ai_Linear__list_issue_labels`. Create new labels with `mcp__claude_ai_Linear__create_issue_label` when state labels don't exist yet.
- **Close**: `mcp__claude_ai_Linear__save_issue` setting state to `Done`, `Canceled`, or `Duplicate` (look up status IDs via `mcp__claude_ai_Linear__list_issue_statuses`).

## Workflow states (team XEN)

| Name        | Type      |
| ----------- | --------- |
| Backlog     | backlog   |
| Todo        | unstarted |
| In Progress | started   |
| Done        | completed |
| Canceled    | canceled  |
| Duplicate   | canceled  |

## Markdown formatting

When passing string content to Linear MCP tools, send real newlines — never literal `\n`. Markdown renders natively in Linear.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team `XEN` via `mcp__claude_ai_Linear__save_issue`.

## When a skill says "fetch the relevant ticket"

Use `mcp__claude_ai_Linear__get_issue` (and `list_comments` for the thread).
