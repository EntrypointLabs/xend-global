#!/usr/bin/env node
// Builds the /goal condition for a Linear issue that /linear-start has saved.
//
//   node .claude/skills/linear-start/goal.mjs XEN-12
//
// Reads  .claude/linear-runs/<ID>.json  {id, title, url, branch}
//        .claude/linear-runs/<ID>.md    the issue description, verbatim
// Writes .claude/linear-runs/<ID>.goal  the condition, with the description inline when it fits
//        .claude/linear-runs/current.json  marks <ID> as this run's issue (read by run.mjs)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// /goal rejects conditions over 4,000 characters; keep some headroom.
const GOAL_LIMIT = 3900;

const id = process.argv[2];
if (!id) {
  console.error("usage: goal.mjs <ISSUE-ID>");
  process.exit(2);
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const runs = join(root, ".claude/linear-runs");
const config = JSON.parse(
  readFileSync(join(root, ".claude/linear.json"), "utf8"),
);
const issue = JSON.parse(readFileSync(join(runs, `${id}.json`), "utf8"));
const description = readFileSync(join(runs, `${id}.md`), "utf8").trim();

const verify = config.verify.map((cmd) => `\`${cmd}\``).join(", ");

const condition = (requirementsSource) =>
  [
    `Ship Linear issue ${id} on branch ${issue.branch}.`,
    `Title: ${issue.title}`,
    `URL: ${issue.url}`,
    "",
    "Met only when this conversation shows all of the following:",
    `1. Every requirement in ${requirementsSource} is implemented: each checklist item, each "Done when" line and each behaviour it describes. Print a checklist that pairs each requirement with the files that implement it. If the description links a design, spec or file, open it and build to it.`,
    `2. ${verify} ran after the last code change and exited 0.`,
    `3. /linear-finish ${id} ran and printed the pull request URL and the Linear state "${config.states.review}".`,
    "",
    `Impossible once /linear-finish ${id} --blocked has run and printed that the issue was handed back. Run it, then stop, if the work needs a decision or access only a person can give, or if ${config.goalMaxTurns} turns pass without meeting the conditions above.`,
  ].join("\n");

const inline = `${condition("the issue description below")}\n\nIssue description:\n<<<\n${description}\n>>>`;
const pointer = condition(
  `the issue description, saved verbatim in .claude/linear-runs/${id}.md (print that file in full before you start),`,
);

const goal = inline.length <= GOAL_LIMIT ? inline : pointer;
writeFileSync(join(runs, `${id}.goal`), goal);
writeFileSync(
  join(runs, "current.json"),
  `${JSON.stringify({ id }, null, 2)}\n`,
);

console.log(
  goal === inline
    ? `Wrote .claude/linear-runs/${id}.goal (${goal.length} chars, description inline).`
    : `Wrote .claude/linear-runs/${id}.goal (${goal.length} chars). The description is ${description.length} chars, too long to inline, so the goal points at .claude/linear-runs/${id}.md.`,
);
