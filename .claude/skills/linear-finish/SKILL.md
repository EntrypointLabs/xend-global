---
name: linear-finish
description: Ship a Linear issue started with /linear-start. Verifies the work, pushes the branch, opens the pull request, links it on the issue and moves the issue to In Review. With --blocked, hands the issue back to a person instead. Use when the issue's implementation is complete, or cannot be completed.
argument-hint: 'ISSUE-ID [--blocked "what you need"]'
allowed-tools: Read, Write, Bash(git *), Bash(gh pr *), Bash(cat *), mcp__claude_ai_Linear__*, mcp__Linear__*
---

# Finish a Linear issue

Arguments: `$ARGUMENTS`

The first argument is the issue ID. If `--blocked` follows, go to **Hand back**. Otherwise go to **Ship**.

Read `.claude/linear.json` and `.claude/linear-runs/<ID>.json`, which hold the title, URL and branch. If the run file is missing, `get_issue` and use the current branch. Linear tools are `mcp__claude_ai_Linear__*` or `mcp__Linear__*`, whichever is loaded.

## Ship

1. **Branch.** You must be on the issue's branch. Commit any outstanding work, following the repo's commit convention, and keep unrelated changes out.
2. **Requirements.** Reread `.claude/linear-runs/<ID>.md`. If any requirement is not done, stop and list what is left; do not open the PR.
3. **Verify.** Run every `verify` command. If one fails, fix the code and rerun it. Never open a PR on red. If you cannot get it green, go to **Hand back**.
4. **Push.** Run `git push -u origin <branch>`. On a network error, retry up to 4 times, waiting 2s, 4s, 8s, then 16s.
5. **Pull request.** If a PR is already open for this branch, update it. Otherwise open one against `baseBranch`, ready for review (not a draft). Use `gh pr create` when `gh` is authenticated, or the GitHub MCP `create_pull_request` tool. If the repo has a PR template, fill it in.
   - Title: the repo's commit convention (e.g. `feat(mobile): ...`), ending with ` (<ID>)`.
   - Body: first line `Closes <ID>` followed by the issue URL. Then a short summary, a checklist pairing each requirement with what changed, and the verify commands with their results.
6. **Linear.**
   - `save_issue`: `id` = the issue, `state` = `states.review`, `links` = `[{"url": "<PR URL>", "title": "PR #<n>: <PR title>"}]`.
   - `save_comment`: the PR link, a 2 to 4 line summary, and anything a reviewer should check by hand (for example, visual details that were only built, never viewed).
7. **Record.** Write `.claude/linear-runs/<ID>.result.json` containing `{"status": "in-review", "pr": "<PR URL>"}`.
8. **Report.** Print exactly:

   ```
   PR: <PR URL>
   Linear <ID>: <states.review>
   ```

## Hand back

Use this when the work needs a decision, an answer or access that only a person can give, or when the goal ran out of turns.

1. Commit and push any work in progress to the branch, so nothing is lost. Do not open a PR.
2. `save_comment` on the issue:
   - why you stopped: the text after `--blocked`, made specific
   - what is done, and what is left
   - the branch name
   - how to retry: answer the question, remove the `blockedLabel` label, and leave the issue in `states.ready`
3. `save_issue`: `state` = `states.ready`, `addLabels` = `[blockedLabel]`. If the label does not exist yet, create it in the team with `create_issue_label`. The label keeps /linear-start from picking the issue up again until a person clears it.
4. Write `.claude/linear-runs/<ID>.result.json` containing `{"status": "blocked", "reason": "<reason>"}`.
5. Print exactly: `Linear <ID>: handed back (<blockedLabel>)`.
