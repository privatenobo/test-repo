// Rules for tool files. The website and the GitHub check both use this file,
// so a record that passes on the website also passes in the pull request.
// No dependencies: runs in browsers and in Node.js.

export const LIMITS = { name: 80, modeName: 60, modes: 10, text: 200, length: 100000 };
export const KINDS = ["multi", "single", "bool", "length", "text"];
const TOOL_KEYS = ["name", "url", "status", "modes"];
const STATUS = ["example"];

export const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const quote = arr => arr.map(x => `"${x}"`).join(", ");

export function dimensions(schema) {
  return schema.branches.flatMap(b => b.dimensions.map(d => ({ ...d, branch: b.id })));
}

// "A.I. Duet" -> "a-i-duet"
export function toolId(name) {
  return String(name ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// "ai-duet.json" -> "ai-duet", anything else -> null
export function idFromFile(file) {
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.exec(file);
  return m ? m[1] : null;
}

export function validateSchema(schema) {
  if (!isObject(schema) || !isObject(schema.values) || !Array.isArray(schema.branches)) return ['The schema needs "values" and "branches".'];
  const errors = [];
  const seen = new Set();
  schema.branches.forEach((b, i) => {
    if (!isObject(b) || !b.id || !b.label || !Array.isArray(b.dimensions)) { errors.push(`Branch ${i + 1} needs "id", "label" and "dimensions".`); return; }
    b.dimensions.forEach((d, j) => {
      if (!isObject(d) || typeof d.id !== "string" || !d.label) { errors.push(`Dimension ${j + 1} in "${b.id}" needs "id" and "label".`); return; }
      const at = `Dimension "${d.id}"`;
      if (d.id === "name") errors.push(`${at}: "name" is reserved for the mode name.`);
      if (seen.has(d.id)) errors.push(`${at} is defined twice.`);
      seen.add(d.id);
      if (!KINDS.includes(d.kind)) { errors.push(`${at} has kind "${d.kind}". Use one of: ${quote(KINDS)}.`); return; }
      if (["multi", "single", "length"].includes(d.kind)) {
        if (!Array.isArray(d.values) || !d.values.length) errors.push(`${at} needs a list of "values".`);
        else d.values.filter(v => !isObject(schema.values[v])).forEach(v => errors.push(`${at} uses "${v}", which is not defined in "values".`));
      }
    });
  });
  return errors;
}

export function validateTool(tool, schema) {
  if (!isObject(tool)) return ["The file must contain one JSON object: { … }."];
  const errors = [];
  const dims = dimensions(schema);
  Object.keys(tool).filter(k => !TOOL_KEYS.includes(k)).forEach(k => errors.push(`Unknown field "${k}". Allowed: ${quote(TOOL_KEYS)}.`));
  if (typeof tool.name !== "string" || !tool.name.trim()) errors.push('"name" is missing.');
  else if (tool.name.trim().length > LIMITS.name) errors.push(`"name" is longer than ${LIMITS.name} characters.`);
  if (tool.url != null && !isWebUrl(tool.url)) errors.push('"url" must be a web address starting with https://.');
  if (tool.status !== undefined && !STATUS.includes(tool.status)) errors.push('"status" can only be "example". Otherwise leave it out.');
  if (!Array.isArray(tool.modes) || !tool.modes.length) { errors.push('"modes" needs at least one mode.'); return errors; }
  if (tool.modes.length > LIMITS.modes) errors.push(`At most ${LIMITS.modes} modes.`);

  const allowed = ["name", ...dims.map(d => d.id)];
  tool.modes.forEach((m, i) => {
    if (!isObject(m)) { errors.push(`Mode ${i + 1} must be an object: { … }.`); return; }
    const at = typeof m.name === "string" && m.name.trim() ? `Mode ${i + 1} (${m.name.trim()})` : `Mode ${i + 1}`;
    Object.keys(m).filter(k => !allowed.includes(k)).forEach(k => errors.push(`${at}: unknown field "${k}". Allowed: ${quote(allowed)}.`));
    if (typeof m.name !== "string" || !m.name.trim()) errors.push(`${at}: "name" is missing.`);
    else if (m.name.trim().length > LIMITS.modeName) errors.push(`${at}: "name" is longer than ${LIMITS.modeName} characters.`);
    dims.forEach(d => {
      const e = checkValue(d, m[d.id], schema);
      if (e) errors.push(`${at}: ${e}`);
    });
  });
  return errors;
}

function isEmpty(d, v) {
  return v === undefined || v === null
    || (d.kind === "multi" && Array.isArray(v) && !v.length)
    || (d.kind === "text" && typeof v === "string" && !v.trim());
}

function checkValue(d, v, schema) {
  const f = `"${d.id}"`;
  if (isEmpty(d, v)) return d.optional ? null : `${f} is missing.`;
  switch (d.kind) {
    case "multi": {
      if (!Array.isArray(v)) return `${f} must be a list, e.g. ["${d.values[0]}"].`;
      const bad = v.filter(x => !d.values.includes(x));
      if (bad.length) return `${f} contains ${quote(bad.map(String))}. Allowed: ${quote(d.values)}.`;
      if (new Set(v).size !== v.length) return `${f} lists a value twice.`;
      return null;
    }
    case "single":
      return d.values.includes(v) ? null : `${f} must be one of: ${quote(d.values)}.`;
    case "bool":
      return typeof v === "boolean" ? null : `${f} must be true or false (without quotes).`;
    case "length": {
      if (!isObject(v)) return `${f} must look like {"unit": "seconds", "value": 30} or {"unit": "unlimited"}.`;
      if (!d.values.includes(v.unit)) return `${f}: "unit" must be one of: ${quote(d.values)}.`;
      const numeric = !!schema.values[v.unit].numeric;
      const extra = Object.keys(v).filter(k => k !== "unit" && !(numeric && k === "value"));
      if (extra.length) return `${f}: unexpected ${quote(extra)}.`;
      if (numeric && !(typeof v.value === "number" && v.value > 0 && v.value <= LIMITS.length)) return `${f}: "value" must be a number above 0 and up to ${LIMITS.length}.`;
      return null;
    }
    case "text": {
      const max = d.max || LIMITS.text;
      if (typeof v !== "string") return `${f} must be text in quotes.`;
      return v.trim().length > max ? `${f} is longer than ${max} characters.` : null;
    }
  }
  return `${f} has an unknown kind in the schema.`;
}

function isWebUrl(u) {
  if (typeof u !== "string") return false;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; }
}

// Turns a valid tool file into the form the website reads.
export function normalizeTool(tool, schema, id) {
  const out = { id, name: tool.name.trim() };
  if (tool.url) out.url = tool.url;
  if (tool.status) out.status = tool.status;
  out.modes = tool.modes.map(m => {
    const o = { name: m.name.trim() };
    dimensions(schema).forEach(d => {
      const v = m[d.id];
      if (isEmpty(d, v)) o[d.id] = d.kind === "multi" ? [] : null;
      else if (d.kind === "multi") o[d.id] = d.values.filter(x => v.includes(x));
      else if (d.kind === "text") o[d.id] = v.trim();
      else o[d.id] = v;
    });
    return o;
  });
  return out;
}

// Readable JSON: short lists and length values stay on one line.
export function formatRecord(record) {
  return JSON.stringify(record, null, 2)
    .replace(/\[\n\s+([^[\]{}]*?)\n\s*\]/g, (_, inner) => `[${inner.split(/,\n\s*/).join(", ")}]`)
    .replace(/\{\n\s+("unit": "[^"\n]*"(?:,\n\s+"value": [^\n,{}]+)?)\n\s*\}/g, (_, inner) => `{ ${inner.split(/,\n\s*/).join(", ")} }`)
    + "\n";
}
