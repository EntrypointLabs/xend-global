#!/usr/bin/env node
// Picks up one Linear issue headlessly and drives it to a pull request.
//
//   node .claude/skills/linear-start/run.mjs [ISSUE-ID]
//
// 1. `claude -p "/linear-start [ID]"` claims the issue (Todo -> In Progress) and writes its goal.
// 2. `/goal <condition>` in the same session implements it. The condition carries the issue
//    description and ends with /linear-finish, which opens the PR and moves the issue to In Review.
// 3. If the goal loop ends without /linear-finish recording a result, the issue is handed back so
//    it never sits in In Progress with nobody on it.
//
// Extra claude flags come from LINEAR_AGENT_CLAUDE_ARGS (default: --permission-mode auto).
// Exits 0 when the issue reached In Review or nothing was ready, 1 otherwise.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const requested = process.argv[2] ?? "";
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const runs = join(root, ".claude/linear-runs");
const flags = (process.env.LINEAR_AGENT_CLAUDE_ARGS ?? "--permission-mode auto")
  .split(/\s+/)
  .filter(Boolean);

// The prompt goes right after -p and the user's flags go last, so a variadic flag such as
// --allowedTools cannot swallow the prompt.
function claude(prompt, args, { capture = false } = {}) {
  const res = spawnSync("claude", ["-p", prompt, ...args, ...flags], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
}

const readJson = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;

// 1. Claim the issue.
rmSync(join(runs, "current.json"), { force: true });
const start = claude(
  `/linear-start ${requested}`.trim(),
  ["--output-format", "json"],
  {
    capture: true,
  },
);
let started;
try {
  started = JSON.parse(start.stdout);
} catch {
  console.error(start.stdout);
  console.error("linear-agent: /linear-start did not return JSON output.");
  process.exit(1);
}
console.log(started.result);

const current = readJson(join(runs, "current.json"));
if (!current) {
  console.log("linear-agent: no issue was picked up.");
  process.exit(started.is_error ? 1 : 0);
}
const { id } = current;
const session = started.session_id;

// 2. Implement it under /goal, in the session that already read the issue.
const resultFile = join(runs, `${id}.result.json`);
rmSync(resultFile, { force: true });
const goal = readFileSync(join(runs, `${id}.goal`), "utf8");
claude(`/goal ${goal}`, [
  "--resume",
  session,
  "--output-format",
  "stream-json",
  "--verbose",
]);

// 3. Safety net: never leave the issue claimed with nobody working on it.
if (!existsSync(resultFile)) {
  claude(
    `/linear-finish ${id} --blocked "The goal loop ended before the issue shipped. See the Claude Code session ${session}."`,
    ["--resume", session],
  );
}

const result = readJson(resultFile);
console.log(
  `linear-agent: ${id} -> ${result ? JSON.stringify(result) : "no result recorded"}`,
);
process.exit(result?.status === "in-review" ? 0 : 1);
