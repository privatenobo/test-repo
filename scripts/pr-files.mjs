// Used by the "Check and merge tools" workflow.
// Decides whether a pull request can be merged without review
// and copies its tool files into the working tree, so they can be checked.
//   node scripts/pr-files.mjs <file list> <commit>
// The file list has one "status path" line per changed file, as returned by the GitHub API.
// Only JSON files are copied. Code from the pull request is never run.
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { idFromFile } from "./rules.mjs";

const MAX_FILES = 10;
const AUTO_STATUS = ["added", "modified"];

const [listFile, commit] = process.argv.slice(2);
const lines = readFileSync(listFile, "utf8").split("\n").filter(l => l.trim());

function decide() {
  if (!/^[0-9a-f]{40}$/.test(commit || "")) return { reason: "Unknown commit." };
  if (!lines.length) return { reason: "The pull request changes no files." };
  if (lines.length > MAX_FILES) return { reason: `The pull request changes more than ${MAX_FILES} files.` };
  const paths = [];
  for (const line of lines) {
    const parts = line.split(" ");
    const [status, path] = parts;
    const name = parts.length === 2 && path.startsWith("tools/") ? path.slice(6) : "";
    if (!idFromFile(name)) return { reason: `The pull request changes files outside tools/ (${line.slice(0, 80)}).` };
    if (!AUTO_STATUS.includes(status)) return { reason: `A file was ${status}: ${path}.` };
    paths.push(path);
  }
  return { paths };
}

const result = decide();
if (result.paths) {
  execFileSync("git", ["checkout", commit, "--", ...result.paths], { stdio: "inherit" });
  console.log(`Copied from the pull request: ${result.paths.join(", ")}`);
} else {
  console.log(`Needs review: ${result.reason}`);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `auto=${result.paths ? "true" : "false"}\n`);
}
