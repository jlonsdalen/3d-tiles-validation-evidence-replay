import {constants as fsConstants} from "node:fs";
import {createHash} from "node:crypto";
import {lstat, mkdir, open, readFile, realpath, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {parseStrictJson} from "./strict-json.mjs";

export const PROOF_PACK_LIMITS = Object.freeze({
  manifestBytes: 65536, resources: 128, tilesetJsonFiles: 32,
  tilesetJsonBytes: 1048576, opaqueResourceBytes: 16777216,
  totalResourceBytes: 33554432, tileNodes: 10000,
  externalTilesetDepth: 16, uriBytes: 2048, jsonDepth: 64,
  jsonValues: 100000, jsonStringCodeUnits: 1048576,
  extensions: 128, findings: 10000,
});

const RULES = Object.freeze({
  MANIFEST_SHAPE: "MANIFEST_SHAPE", MANIFEST_PATH: "MANIFEST_PATH",
  MANIFEST_IDENTITY: "MANIFEST_IDENTITY", MANIFEST_UNREACHED: "MANIFEST_UNREACHED",
  JSON_STRICT: "JSON_STRICT", URI_UNSUPPORTED: "URI_UNSUPPORTED_POC_SCOPE",
  URI_TRAVERSAL: "URI_TRAVERSAL", RESOURCE_MISSING: "RESOURCE_MISSING",
  RESOURCE_BOUNDARY: "RESOURCE_BOUNDARY", GRAPH_CYCLE: "GRAPH_CYCLE",
  GRAPH_DEPTH: "GRAPH_DEPTH", GRAPH_EXTERNAL_WITH_CHILDREN: "GRAPH_EXTERNAL_WITH_CHILDREN",
  VERSION_MISSING: "VERSION_MISSING", VERSION_UNSUPPORTED: "VERSION_UNSUPPORTED_POC_SCOPE",
  EXT_USED_UNDECLARED: "EXT_USED_UNDECLARED", EXT_REQUIRED_NOT_USED: "EXT_REQUIRED_NOT_USED",
  EXT_REQUIRED_UNSUPPORTED: "EXT_REQUIRED_UNSUPPORTED_POC_SCOPE",
  UNSUPPORTED_SURFACE: "UNSUPPORTED_COMPLETENESS_SURFACE",
});

const sha256 = value => createHash("sha256").update(value).digest("hex");
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonical(value[key])]));
  return value;
}
export const canonicalJson = value => `${JSON.stringify(canonical(value), null, 2)}\n`;

function addFinding(findings, rule_id, severity, artifact, json_pointer, message, target_uri = null) {
  if (findings.length >= PROOF_PACK_LIMITS.findings) throw new Error("finding limit exceeded");
  findings.push({rule_id, severity, artifact, json_pointer, target_uri, message});
}

function localPathReason(value) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > PROOF_PACK_LIMITS.uriBytes) return "path must be a bounded non-empty string";
  if (value !== value.normalize("NFC")) return "path must use NFC normalization";
  if (value.includes("\\") || value.includes("\0") || /[\u0000-\u001f\u007f]/u.test(value)) return "path contains a forbidden separator or control";
  if (value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:/u.test(value) || value.includes(":")) return "path must be POSIX relative";
  const segments = value.split("/");
  if (segments.some(segment => segment === "" || segment === "." || segment === "..") || path.posix.normalize(value) !== value) return "path contains an empty, dot, or non-normalized segment";
  return null;
}

function resolveUri(uri, referringPath) {
  if (typeof uri !== "string" || uri.length === 0 || Buffer.byteLength(uri) > PROOF_PACK_LIMITS.uriBytes) return {rule: RULES.URI_UNSUPPORTED, error: "URI must be a bounded non-empty string"};
  if (uri !== uri.normalize("NFC")) return {rule: RULES.URI_UNSUPPORTED, error: "URI must use NFC normalization"};
  if (uri.includes("\\") || uri.includes("\0") || /[\u0000-\u001f\u007f]/u.test(uri) || uri.includes("?") || uri.includes("#")) return {rule: RULES.URI_UNSUPPORTED, error: "URI contains a forbidden separator, control, query, or fragment"};
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(uri) || uri.startsWith("//") || uri.startsWith("/") || /^[A-Za-z]:/u.test(uri)) return {rule: RULES.URI_UNSUPPORTED, error: "URI scheme or absolute form is outside the local POC"};
  if (/[{}]/u.test(uri)) return {rule: RULES.UNSUPPORTED_SURFACE, error: "URI templates are outside the bounded POC"};
  if (/%(?:2f|5c|00|3f|23)/iu.test(uri)) return {rule: RULES.URI_TRAVERSAL, error: "percent-encoded separator, NUL, query, or fragment is rejected"};
  let decoded;
  try { decoded = decodeURIComponent(uri); } catch { return {rule: RULES.URI_UNSUPPORTED, error: "URI percent encoding invalid"}; }
  if ((decoded.includes("/") && !uri.includes("/")) || decoded.includes("\\") || decoded.includes("\0") || decoded.includes("?") || decoded.includes("#") || /[\u0000-\u001f\u007f]/u.test(decoded)) return {rule: RULES.URI_TRAVERSAL, error: "percent-decoded separator, control, query, or fragment is rejected"};
  if (decoded !== decoded.normalize("NFC")) return {rule: RULES.URI_UNSUPPORTED, error: "decoded URI must use NFC normalization"};
  if (decoded.split("/").some(segment => segment === "" || segment === "." || segment === "..")) return {rule: RULES.URI_TRAVERSAL, error: "URI contains an empty or dot segment"};
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(referringPath), decoded));
  if (target.startsWith("../") || target === ".." || path.posix.isAbsolute(target)) return {rule: RULES.URI_TRAVERSAL, error: "URI escapes the evidence root"};
  return {path: target};
}

async function readInitialJson(filePath, maximumBytes, label) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size < 2 || info.size > maximumBytes) throw new Error(`${label} byte boundary invalid`);
  const bytes = await readFile(filePath);
  const value = parseStrictJson(bytes, {depth: PROOF_PACK_LIMITS.jsonDepth, values: PROOF_PACK_LIMITS.jsonValues, stringCodeUnits: PROOF_PACK_LIMITS.jsonStringCodeUnits});
  return {bytes, value};
}

function validateManifest(value, findings) {
  if (!value || value.schema !== "three_d_tiles_proof_pack_asset_manifest.v1" || typeof value.entry_tileset !== "string" || !Array.isArray(value.resources)) {
    addFinding(findings, RULES.MANIFEST_SHAPE, "error", "asset-manifest.v1.json", "", "versioned manifest, entry_tileset, and resources are required");
    return {entry: null, rows: [], map: new Map()};
  }
  if (value.resources.length < 1 || value.resources.length > PROOF_PACK_LIMITS.resources) throw new Error("manifest resource limit exceeded");
  const map = new Map();
  const folds = new Set();
  const rows = [];
  for (const [index, row] of value.resources.entries()) {
    const pointer = `/resources/${index}`;
    const reason = localPathReason(row?.path);
    if (reason) { addFinding(findings, RULES.MANIFEST_PATH, "error", "asset-manifest.v1.json", `${pointer}/path`, reason); continue; }
    const fold = row.path.toLocaleLowerCase("en-US");
    if (map.has(row.path) || folds.has(fold)) { addFinding(findings, RULES.MANIFEST_PATH, "error", "asset-manifest.v1.json", `${pointer}/path`, "manifest paths must be exact and case-fold unique"); continue; }
    if (!["TILESET_JSON", "OPAQUE_CONTENT"].includes(row.kind) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || !/^[0-9a-f]{64}$/u.test(row.sha256 ?? "") || typeof row.source !== "string" || !row.source || typeof row.license_expression !== "string" || !row.license_expression || typeof row.redistributable !== "boolean" || typeof row.synthetic !== "boolean") {
      addFinding(findings, RULES.MANIFEST_SHAPE, "error", "asset-manifest.v1.json", pointer, `manifest identity or provenance fields invalid: ${row.path}`);
    }
    map.set(row.path, row); folds.add(fold); rows.push(row);
  }
  if (JSON.stringify([...map.keys()].sort(compare)) !== JSON.stringify([...map.keys()])) addFinding(findings, RULES.MANIFEST_PATH, "error", "asset-manifest.v1.json", "/resources", "manifest resources must be sorted by code-point path order");
  if (localPathReason(value.entry_tileset) || map.get(value.entry_tileset)?.kind !== "TILESET_JSON") addFinding(findings, RULES.MANIFEST_SHAPE, "error", "asset-manifest.v1.json", "/entry_tileset", "entry_tileset must name one TILESET_JSON row");
  return {entry: value.entry_tileset, rows, map};
}

async function safelyRead(root, row, findings) {
  let cursor = root;
  for (const segment of row.path.split("/")) {
    cursor = path.join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) { addFinding(findings, RULES.RESOURCE_BOUNDARY, "error", row.path, "", "symbolic-link path components are rejected"); return null; }
    } catch { addFinding(findings, RULES.RESOURCE_MISSING, "error", row.path, "", "manifest resource is missing"); return null; }
  }
  const [resolvedRoot, resolved] = await Promise.all([realpath(root), realpath(cursor)]);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) { addFinding(findings, RULES.RESOURCE_BOUNDARY, "error", row.path, "", "resource resolves outside evidence root"); return null; }
  let handle;
  try { handle = await open(cursor, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)); }
  catch { addFinding(findings, RULES.RESOURCE_BOUNDARY, "error", row.path, "", "resource could not be opened without following a link"); return null; }
  try {
    const before = await handle.stat();
    const maximum = row.kind === "TILESET_JSON" ? PROOF_PACK_LIMITS.tilesetJsonBytes : PROOF_PACK_LIMITS.opaqueResourceBytes;
    if (!before.isFile() || before.size < 1 || before.size > maximum) { addFinding(findings, RULES.MANIFEST_IDENTITY, "error", row.path, "", "resource type or byte limit invalid"); return null; }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.length !== before.size) { addFinding(findings, RULES.RESOURCE_BOUNDARY, "error", row.path, "", "resource identity changed during read"); return null; }
    const digest = sha256(bytes);
    if (row.bytes !== bytes.length || row.sha256 !== digest) addFinding(findings, RULES.MANIFEST_IDENTITY, "error", row.path, "", "resource bytes or SHA-256 do not match manifest");
    if (row.kind === "OPAQUE_CONTENT" && (row.path.toLowerCase().endsWith(".json") || /^[\u0009\u000a\u000d\u0020]*[\[{]/u.test(bytes.toString("utf8")))) addFinding(findings, RULES.MANIFEST_SHAPE, "error", row.path, "", "JSON-like resource may not be hidden as opaque content");
    return {bytes, observed: {path: row.path, kind: row.kind, bytes: bytes.length, sha256: digest, source: row.source, license_expression: row.license_expression, redistributable: row.redistributable, synthetic: row.synthetic}};
  } finally { await handle.close(); }
}

function scanJson(value, pointer, extensions, findings, artifact) {
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "schemaUri")) addFinding(findings, RULES.UNSUPPORTED_SURFACE, "error", artifact, `${pointer}/schemaUri`, "schemaUri is outside the bounded POC");
  if (Object.hasOwn(value, "implicitTiling")) addFinding(findings, RULES.UNSUPPORTED_SURFACE, "error", artifact, `${pointer}/implicitTiling`, "implicit tiling is outside the bounded POC");
  if (Object.hasOwn(value, "extensions")) {
    if (!value.extensions || typeof value.extensions !== "object" || Array.isArray(value.extensions)) {
      addFinding(findings, RULES.UNSUPPORTED_SURFACE, "error", artifact, `${pointer}/extensions`, "extensions must be a non-null object; malformed extension containers are unsupported by this POC");
    } else {
      for (const name of Object.keys(value.extensions)) {
        extensions.add(name);
        addFinding(findings, RULES.UNSUPPORTED_SURFACE, "error", artifact, `${pointer}/extensions/${name}`, `extension payload semantics are unsupported by this POC: ${name}`);
      }
    }
  }
  for (const [key, child] of Object.entries(value)) if (key !== "extensions") scanJson(child, `${pointer}/${key}`, extensions, findings, artifact);
}

function collectUris(tileset, artifact, findings, counters) {
  const rows = [];
  const walk = (tile, pointer) => {
    if (!tile || typeof tile !== "object" || Array.isArray(tile)) return;
    counters.tileNodes += 1;
    if (counters.tileNodes > PROOF_PACK_LIMITS.tileNodes) throw new Error("tile-node limit exceeded");
    if (tile.content !== undefined && tile.contents !== undefined) addFinding(findings, RULES.UNSUPPORTED_SURFACE, "error", artifact, pointer, "content and contents together are outside the bounded POC");
    const contentRows = [];
    if (tile.content !== undefined) contentRows.push([tile.content, `${pointer}/content`]);
    if (tile.contents !== undefined) {
      if (!Array.isArray(tile.contents)) addFinding(findings, RULES.UNSUPPORTED_SURFACE, "error", artifact, `${pointer}/contents`, "contents must be an array for graph evidence");
      else tile.contents.forEach((content, index) => contentRows.push([content, `${pointer}/contents/${index}`]));
    }
    for (const [content, at] of contentRows) {
      if (!content || typeof content !== "object" || typeof content.uri !== "string") addFinding(findings, RULES.URI_UNSUPPORTED, "error", artifact, `${at}/uri`, "content uri string required for graph evidence");
      else rows.push({uri: content.uri, pointer: `${at}/uri`, parentHasChildren: Array.isArray(tile.children) && tile.children.length > 0});
    }
    if (tile.children !== undefined) {
      if (!Array.isArray(tile.children)) addFinding(findings, RULES.UNSUPPORTED_SURFACE, "error", artifact, `${pointer}/children`, "children must be an array for graph evidence");
      else tile.children.forEach((child, index) => walk(child, `${pointer}/children/${index}`));
    }
  };
  if (!tileset.root || typeof tileset.root !== "object" || Array.isArray(tileset.root)) addFinding(findings, RULES.UNSUPPORTED_SURFACE, "error", artifact, "/root", "root object required for graph evidence");
  else walk(tileset.root, "/root");
  return rows;
}

function checkExtensions(entry, observed, findings, artifact) {
  const used = entry.extensionsUsed ?? [];
  const required = entry.extensionsRequired ?? [];
  if (!Array.isArray(used) || !used.every(value => typeof value === "string")) addFinding(findings, RULES.EXT_USED_UNDECLARED, "error", artifact, "/extensionsUsed", "extensionsUsed must be an array of strings");
  if (!Array.isArray(required) || !required.every(value => typeof value === "string")) addFinding(findings, RULES.EXT_REQUIRED_NOT_USED, "error", artifact, "/extensionsRequired", "extensionsRequired must be an array of strings");
  if (!Array.isArray(used) || !Array.isArray(required)) return;
  if (used.length > PROOF_PACK_LIMITS.extensions || required.length > PROOF_PACK_LIMITS.extensions) throw new Error("extension limit exceeded");
  const usedSet = new Set(used);
  for (const name of observed) if (!usedSet.has(name)) addFinding(findings, RULES.EXT_USED_UNDECLARED, "error", artifact, "/extensionsUsed", `observed extension not declared by entry tileset: ${name}`);
  for (const name of required) {
    if (!usedSet.has(name)) addFinding(findings, RULES.EXT_REQUIRED_NOT_USED, "error", artifact, "/extensionsRequired", `required extension not present in extensionsUsed: ${name}`);
    addFinding(findings, RULES.EXT_REQUIRED_UNSUPPORTED, "error", artifact, "/extensionsRequired", `required extension semantics are unsupported by this POC: ${name}`);
  }
}

function sortFindings(rows) {
  const rank = {error: 0, warning: 1, note: 2};
  return [...rows].sort((a, b) => rank[a.severity] - rank[b.severity] || compare(a.rule_id, b.rule_id) || compare(a.artifact, b.artifact) || compare(a.json_pointer, b.json_pointer) || compare(a.target_uri ?? "", b.target_uri ?? "") || compare(a.message, b.message));
}

export async function buildProofPack({manifestPath}) {
  if (typeof manifestPath !== "string") throw new Error("asset manifest path required");
  const manifestFile = path.resolve(manifestPath);
  const root = path.dirname(manifestFile);
  const input = await readInitialJson(manifestFile, PROOF_PACK_LIMITS.manifestBytes, "asset manifest");
  const findings = [];
  const manifest = validateManifest(input.value, findings);
  const reached = new Set(), active = new Set();
  const assets = [], edges = [];
  const counters = {tileNodes: 0, tilesets: 0, totalBytes: 0};
  const visit = async (resourcePath, depth, from = null, pointer = "") => {
    if (depth > PROOF_PACK_LIMITS.externalTilesetDepth) { addFinding(findings, RULES.GRAPH_DEPTH, "error", from ?? resourcePath, pointer, "external tileset depth exceeds POC limit", resourcePath); return; }
    const row = manifest.map.get(resourcePath);
    if (!row) { addFinding(findings, RULES.RESOURCE_MISSING, "error", from ?? "asset-manifest.v1.json", pointer, `referenced resource absent from manifest: ${resourcePath}`, resourcePath); return; }
    if (active.has(resourcePath)) { addFinding(findings, RULES.GRAPH_CYCLE, "error", from ?? resourcePath, pointer, `external tileset cycle: ${resourcePath}`, resourcePath); return; }
    if (reached.has(resourcePath)) return;
    reached.add(resourcePath);
    const read = await safelyRead(root, row, findings);
    if (!read) return;
    counters.totalBytes += read.bytes.length;
    if (counters.totalBytes > PROOF_PACK_LIMITS.totalResourceBytes) throw new Error("total resource byte limit exceeded");
    assets.push(read.observed);
    if (row.kind !== "TILESET_JSON") return;
    counters.tilesets += 1;
    if (counters.tilesets > PROOF_PACK_LIMITS.tilesetJsonFiles) throw new Error("tileset JSON file limit exceeded");
    let tileset;
    try { tileset = parseStrictJson(read.bytes, {depth: PROOF_PACK_LIMITS.jsonDepth, values: PROOF_PACK_LIMITS.jsonValues, stringCodeUnits: PROOF_PACK_LIMITS.jsonStringCodeUnits}); }
    catch (error) { addFinding(findings, RULES.JSON_STRICT, "error", resourcePath, "", error.message); return; }
    if (!tileset.asset || typeof tileset.asset.version !== "string") addFinding(findings, RULES.VERSION_MISSING, "error", resourcePath, "/asset/version", "asset.version string required for POC admission");
    else if (tileset.asset.version !== "1.1") addFinding(findings, RULES.VERSION_UNSUPPORTED, "error", resourcePath, "/asset/version", `asset.version unsupported by POC: ${tileset.asset.version}`);
    const observedExtensions = new Set();
    scanJson(tileset, "", observedExtensions, findings, resourcePath);
    checkExtensions(tileset, observedExtensions, findings, resourcePath);
    active.add(resourcePath);
    for (const declaration of collectUris(tileset, resourcePath, findings, counters)) {
      const resolved = resolveUri(declaration.uri, resourcePath);
      if (resolved.error) { addFinding(findings, resolved.rule, "error", resourcePath, declaration.pointer, resolved.error, declaration.uri); continue; }
      edges.push({from: resourcePath, json_pointer: declaration.pointer, uri: declaration.uri, to: resolved.path});
      const target = manifest.map.get(resolved.path);
      if (target?.kind === "TILESET_JSON" && declaration.parentHasChildren) addFinding(findings, RULES.GRAPH_EXTERNAL_WITH_CHILDREN, "error", resourcePath, declaration.pointer, "external-tileset reference tile may not have children", declaration.uri);
      await visit(resolved.path, depth + (target?.kind === "TILESET_JSON" ? 1 : 0), resourcePath, declaration.pointer);
    }
    active.delete(resourcePath);
  };
  if (manifest.entry) await visit(manifest.entry, 0);
  for (const row of manifest.rows) if (!reached.has(row.path)) addFinding(findings, RULES.MANIFEST_UNREACHED, "error", "asset-manifest.v1.json", "/resources", `manifest resource unreachable from entry graph: ${row.path}`, row.path);
  const finalFindings = sortFindings(findings);
  const errors = finalFindings.filter(row => row.severity === "error").length;
  const warnings = finalFindings.filter(row => row.severity === "warning").length;
  const unsupported = finalFindings.some(row => row.rule_id.endsWith("UNSUPPORTED_POC_SCOPE") || row.rule_id === RULES.UNSUPPORTED_SURFACE || row.rule_id === RULES.EXT_REQUIRED_UNSUPPORTED);
  return canonical({
    schema: "three_d_tiles_interoperability_proof_pack_report.v1",
    status: errors === 0 ? "PASS_BOUNDED" : unsupported ? "UNSUPPORTED_FAIL_CLOSED" : "FAIL",
    spec_basis: "OGC_22-025R4_3D_TILES_1_1",
    claim_boundary: {proven: "Bounded local 3D Tiles 1.1 reference-graph admission, manifest identity, provenance, URI containment, extension bookkeeping, and deterministic reporting for the supplied pack.", not_proven: ["COMPLETE_3D_TILES_SCHEMA_CONFORMANCE", "BINARY_OR_GLTF_CONTENT_CONFORMANCE", "RENDERING_OR_SPATIAL_CORRECTNESS", "CROSS_VIEWER_INTEROPERABILITY", "PRODUCTION_SCALE_OR_SECURITY", "UPSTREAM_VALIDATOR_EXECUTION", "OGC_OR_CESIUM_CERTIFICATION"]},
    inputs: {manifest: {bytes: input.bytes.length, sha256: sha256(input.bytes)}},
    summary: {errors, warnings, tile_nodes: counters.tileNodes, tileset_json_files: counters.tilesets, reached_resources: reached.size, manifest_resources: manifest.rows.length, total_resource_bytes: counters.totalBytes},
    assets: assets.sort((a, b) => compare(a.path, b.path)),
    edges: edges.sort((a, b) => compare(a.from, b.from) || compare(a.json_pointer, b.json_pointer) || compare(a.to, b.to)),
    findings: finalFindings,
  });
}

export function toSarif(report) {
  const rules = [...new Set(report.findings.map(row => row.rule_id))].sort(compare);
  return canonical({$schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{tool: {driver: {name: "3D Tiles Interoperability Proof Pack POC", version: "0.1.0", rules: rules.map(id => ({id, shortDescription: {text: id.replaceAll("_", " ")}}))}}, results: report.findings.map(row => ({ruleId: row.rule_id, level: row.severity, message: {text: row.message}, locations: [{physicalLocation: {artifactLocation: {uri: row.artifact}, properties: {jsonPointer: row.json_pointer}}}]}))}]});
}
const md = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("`", "&#96;").replaceAll("[", "&#91;").replaceAll("]", "&#93;").replaceAll("(", "&#40;").replaceAll(")", "&#41;").replaceAll("|", "&#124;").replace(/[\r\n]+/gu, " ");
export function toMarkdown(report) {
  const lines = ["# 3D Tiles Interoperability Proof Pack — bounded POC report", "", `Status: **${report.status}**`, "", `Errors: ${report.summary.errors}; warnings: ${report.summary.warnings}; tilesets: ${report.summary.tileset_json_files}; reached resources: ${report.summary.reached_resources}.`, "", "This is deterministic local evidence, not a replacement for the CesiumGS 3D Tiles Validator or Khronos glTF Validator and not OGC/Cesium certification.", "", "## Assets", "", "| Path | Kind | Bytes | SHA-256 |", "|---|---:|---:|---|", ...report.assets.map(row => `| ${md(row.path)} | ${md(row.kind)} | ${row.bytes} | \`${row.sha256}\` |`), "", "## Findings", "", ...(report.findings.length ? report.findings.map(row => `- **${row.severity.toUpperCase()} ${md(row.rule_id)}** in \`${md(row.artifact)}\` at \`${md(row.json_pointer)}\`: ${md(row.message)}`) : ["- None within the bounded POC checks."]), ""];
  return `${lines.join("\n")}\n`;
}
export async function writeProofPackOutputs(report, outputDirectory) {
  const output = path.resolve(outputDirectory);
  await mkdir(output, {recursive: false});
  const json = canonicalJson(report), sarif = canonicalJson(toSarif(report)), markdown = toMarkdown(report);
  await Promise.all([writeFile(path.join(output, "proof-pack.json"), json, {flag: "wx", mode: 0o600}), writeFile(path.join(output, "proof-pack.sarif"), sarif, {flag: "wx", mode: 0o600}), writeFile(path.join(output, "proof-pack.md"), markdown, {flag: "wx", mode: 0o600})]);
  return canonical({json_sha256: sha256(json), sarif_sha256: sha256(sarif), markdown_sha256: sha256(markdown)});
}
export const PROOF_PACK_RULES = RULES;
