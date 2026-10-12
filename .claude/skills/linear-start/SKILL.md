---
name: linear-start
description: Pick up a Linear issue for this repo. Moves it from Todo to In Progress, creates its branch, saves its full description and writes the /goal condition that implements it. Use when asked to start, pick up or implement a Linear issue ("start XEN-12", "pick up the next issue").
argument-hint: "[ISSUE-ID]"
allowed-tools: Read, Write, Bash(git *), Bash(node *), Bash(cat *), mcp__claude_ai_Linear__*, mcp__Linear__*
---

# Start a Linear issue

Settings live in `.claude/linear.json`: the team, the state names, which issues are ready, and the install and verify commands. Read it first.

Use the Linear MCP tools. They are `mcp__claude_ai_Linear__*` in the CLI and may be `mcp__Linear__*` in cloud sessions; use whichever is loaded. Send real newlines in Markdown, never `\n`.

## 1. Choose the issue

Argument: `$ARGUMENTS`

**If it names an issue** (e.g. `XEN-12`), use that issue. It must belong to the configured team. If it is already `In Progress` or `In Review`, stop and report its state, assignee and latest comment, unless the user asked you to resume it.

**If it is empty**, pick the next ready issue:

1. `list_issues` with the configured `team`, `state` = `states.ready`, and `label` = `pickup.requireLabel` when that is set.
2. Drop issues that carry any label in `pickup.skipLabels`.
3. Take the highest priority (1 Urgent first, 0 No priority last), then the oldest.

If nothing is left, print `No ready issues in <team>.` and stop. Write no files.

## 2. Read all of it

`get_issue` with attachments and relations, then `list_comments`. Comments from people can add to or change the requirements, so they are part of the spec. Open any linked design or document the description depends on.

## 3. Claim it

Claim it before writing any code, so a second run cannot take the same issue:

- `save_issue`: `state` = `states.started`. If it has no assignee, set `assignee` to `"me"`.
- `save_comment`: `Picked up by Claude Code on branch <branch>.`

## 4. Branch

- If your environment instructions name a working branch, use that.
- Otherwise take Linear's `gitBranchName`, drop its `user/` prefix and add `branchPrefix`. For example, `gifted/xen-12-add-x` becomes `claude/xen-12-add-x`. The issue ID stays in the name so Linear links the pull request.
- `git fetch origin <baseBranch>`, then create the branch from `origin/<baseBranch>`. If the branch already exists, check it out instead, because you are resuming.
- If dependencies are not installed, run `install`.

## 5. Save the spec and build the goal

1. Write `.claude/linear-runs/<ID>.json` containing `{"id", "title", "url", "branch"}`.
2. Write `.claude/linear-runs/<ID>.md` containing the description **verbatim**: no summary, no reformatting. If comments add or change requirements, append them under `## Comments`, with each comment's author.
3. Run `node .claude/skills/linear-start/goal.mjs <ID>`. It writes `.claude/linear-runs/<ID>.goal`, the /goal condition, with the description inline when it fits the 4,000 character limit.
4. Run `cat .claude/linear-runs/<ID>.md`, so the full description is in the conversation where the goal evaluator can see it.

`.claude/linear-runs/` is scratch space. Never commit it.

## 6. Hand off to /goal

A skill cannot run `/goal`. End with exactly:

```
<ID> is In Progress on <branch>.
Next: /goal Meet every condition in .claude/linear-runs/<ID>.goal. Print that file in full first.
```

Stop there. The exception is when you are already working toward a goal that covers this issue (for example, a goal that said to run /linear-start). In that case, print the goal file and carry on with its conditions.

The headless runner `node .claude/skills/linear-start/run.mjs [ID]` does all of this unattended. It passes the goal file's full text to `/goal` in the same session.
