// Checks every file in tools/ against data/schema.json and builds the website into _site/.
//   node scripts/build.mjs           check, then build
//   node scripts/build.mjs --check   check only (used for pull requests)
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, copyFileSync, appendFileSync } from "node:fs";
import { validateSchema, validateTool, normalizeTool, idFromFile, toolId } from "./rules.mjs";

const checkOnly = process.argv.includes("--check");
const problems = [];
const report = (file, message, line) => problems.push({ file, message, line });

function readJson(file) {
  let text;
  try { text = readFileSync(file, "utf8").replace(/^\uFEFF/, ""); }
  catch { report(file, "File not found."); return null; }
  try { return { data: JSON.parse(text) }; }
  catch (e) { report(file, `Not valid JSON. ${e.message}`, lineOf(text, e.message)); return null; }
}

function lineOf(text, message) {
  const line = /line (\d+)/.exec(message);
  if (line) return Number(line[1]);
  const pos = /position (\d+)/.exec(message);
  return pos ? text.slice(0, Number(pos[1])).split("\n").length : undefined;
}

// Schema
const schemaFile = "data/schema.json";
const schemaJson = readJson(schemaFile);
const schema = schemaJson && schemaJson.data;
if (schema) validateSchema(schema).forEach(m => report(schemaFile, m));

// Tool files
const tools = [];
let fileCount = 0;
if (schema && !problems.length) {
  let entries = [];
  try { entries = readdirSync("tools", { withFileTypes: true }).filter(e => !e.name.startsWith(".")); }
  catch { report("tools/", "The folder tools/ is missing."); }
  const names = new Map();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `tools/${entry.name}`;
    if (!entry.isFile()) { report(file, "Only .json files belong in tools/, no subfolders."); continue; }
    fileCount++;
    const id = idFromFile(entry.name);
    if (!id) {
      const suggestion = toolId(entry.name.replace(/\.json$/i, "")) || "my-tool";
      report(file, `Rename the file to lowercase letters, digits and hyphens, ending in .json, e.g. "${suggestion}.json".`);
      continue;
    }
    const parsed = readJson(file);
    if (!parsed) continue;
    const errors = validateTool(parsed.data, schema);
    errors.forEach(m => report(file, m));
    if (errors.length) continue;
    const key = toolId(parsed.data.name);
    names.set(key, [...(names.get(key) || []), file]);
    tools.push(normalizeTool(parsed.data, schema, id));
  }
  for (const files of names.values()) {
    if (files.length > 1) files.forEach(file => report(file, `Two files describe the same tool: ${files.join(" and ")}. Keep one.`));
  }
}

// Report
const inActions = !!process.env.GITHUB_ACTIONS;
const escape = s => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
for (const p of problems) {
  if (inActions) console.log(`::error file=${p.file}${p.line ? `,line=${p.line}` : ""}::${escape(p.message)}`);
  else console.log(`${p.file}${p.line ? `:${p.line}` : ""}  ${p.message}`);
}
const summary = problems.length
  ? `Found ${problems.length} problem${problems.length > 1 ? "s" : ""}.`
  : `All ${fileCount} tool file${fileCount === 1 ? "" : "s"} are valid.`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = problems.map(p => `- \`${p.file}\`${p.line ? ` line ${p.line}` : ""}: ${p.message}`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Tool check`, "", `**${summary}**`, "", ...lines, ""].join("\n"));
}
if (problems.length) process.exit(1);

// Build
if (!checkOnly) {
  rmSync("_site", { recursive: true, force: true });
  mkdirSync("_site/data", { recursive: true });
  copyFileSync("index.html", "_site/index.html");
  copyFileSync("scripts/rules.mjs", "_site/rules.js");
  copyFileSync(schemaFile, "_site/data/schema.json");
  tools.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  writeFileSync("_site/data/tools.json", JSON.stringify(tools, null, 2) + "\n");
  console.log(`Built _site/ with ${tools.length} tools.`);
}
