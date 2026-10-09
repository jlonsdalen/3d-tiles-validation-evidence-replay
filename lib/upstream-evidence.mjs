import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {lstat, mkdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {canonicalJson} from "./proof-pack.mjs";
import {parseStrictJson} from "./strict-json.mjs";

const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_STREAM_BYTES = 1024 * 1024;
const PROCESS_TIMEOUT_MS = 30_000;
const EXPECTED_PACKAGE = Object.freeze({
  validator: {name: "3d-tiles-validator", version: "0.6.1"},
  gltf: {name: "gltf-validator", version: "2.0.0-dev.3.10"},
  package_json_sha256: "9eb569c8e4c9bd95ac756fc622d5f8687d9e637ddf1828e7ee14bfaad7b34c01",
  package_lock_sha256: "0122ee13b3adaca0c5aa48731bb0185cd73a2d32884c2ba0a9cd27dd04305da3",
});

const sha256 = value => createHash("sha256").update(value).digest("hex");
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const readBounded = async (filePath, maximumBytes, label) => {
  const info = await stat(filePath);
  assert(info.isFile() && info.size > 0 && info.size <= maximumBytes, `${label} byte boundary invalid`);
  return readFile(filePath);
};
const parseJsonFile = async (filePath, maximumBytes, label) =>
  parseStrictJson(await readBounded(filePath, maximumBytes, label));

function assertRelativePath(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 256, `${label} must be a bounded path`);
  assert(value === value.normalize("NFC"), `${label} must use NFC`);
  assert(!value.includes("\\") && !value.includes("\0") && !value.includes(":") && !value.startsWith("/"), `${label} must be POSIX relative`);
  const segments = value.split("/");
  assert(segments.every(segment => segment && segment !== "." && segment !== ".."), `${label} contains a forbidden segment`);
  assert(path.posix.normalize(value) === value, `${label} is not normalized`);
}

async function assertContainedRegularFile(rootReal, candidate, label) {
  const info = await lstat(candidate);
  assert(info.isFile() && !info.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  const candidateReal = await realpath(candidate);
  assert(candidateReal.startsWith(`${rootReal}${path.sep}`), `${label} escapes its root`);
  return candidateReal;
}

async function admitFixture(manifestPath) {
  const fixtureRoot = path.dirname(manifestPath);
  const fixtureRootReal = await realpath(fixtureRoot);
  await assertContainedRegularFile(fixtureRootReal, manifestPath, "fixture manifest");
  const manifest = await parseJsonFile(manifestPath, 65_536, "fixture manifest");
  assert(manifest?.schema === "three_d_tiles_proof_pack_asset_manifest.v1", "fixture manifest schema mismatch");
  assert(Array.isArray(manifest.resources) && manifest.resources.length >= 2 && manifest.resources.length <= 32, "fixture resources invalid");
  assertRelativePath(manifest.entry_tileset, "entry_tileset");
  const observedPaths = [];
  for (const row of manifest.resources) {
    assert(isObject(row), "fixture resource row invalid");
    assertRelativePath(row.path, "resource path");
    assert(Number.isSafeInteger(row.bytes) && row.bytes > 0, `resource bytes invalid: ${row.path}`);
    assert(/^[0-9a-f]{64}$/u.test(row.sha256), `resource digest invalid: ${row.path}`);
    assert(row.source === "AUTHORED_SYNTHETIC_FIXTURE", `resource provenance invalid: ${row.path}`);
    assert(row.license_expression === "CC0-1.0" && row.redistributable === true && row.synthetic === true, `resource license boundary invalid: ${row.path}`);
    const candidate = path.join(fixtureRoot, ...row.path.split("/"));
    await assertContainedRegularFile(fixtureRootReal, candidate, `resource ${row.path}`);
    const bytes = await readBounded(candidate, 16 * 1024 * 1024, `resource ${row.path}`);
    assert(bytes.length === row.bytes && sha256(bytes) === row.sha256, `resource identity mismatch: ${row.path}`);
    observedPaths.push(row.path);
  }
  assert(JSON.stringify(observedPaths) === JSON.stringify([...observedPaths].sort(compare)), "fixture resources must be sorted");
  assert(new Set(observedPaths).size === observedPaths.length, "fixture resources must be unique");
  assert(observedPaths.includes(manifest.entry_tileset), "entry tileset missing from manifest");
  return {fixtureRoot: fixtureRootReal, entryTileset: path.join(fixtureRootReal, ...manifest.entry_tileset.split("/")), resources: manifest.resources};
}

async function admitValidatorRoot(validatorRoot) {
  const root = await realpath(validatorRoot);
  const lockPath = path.join(root, "package-lock.json");
  const packagePath = path.join(root, "package.json");
  const validatorPackagePath = path.join(root, "node_modules", EXPECTED_PACKAGE.validator.name, "package.json");
  const gltfPackagePath = path.join(root, "node_modules", EXPECTED_PACKAGE.gltf.name, "package.json");
  const executable = path.join(root, "node_modules", EXPECTED_PACKAGE.validator.name, "build", "main");
  const executableSource = path.join(root, "node_modules", EXPECTED_PACKAGE.validator.name, "build", "main.js");
  const embeddedGltfSource = path.join(root, "node_modules", EXPECTED_PACKAGE.validator.name, "build", "tileFormats", "GltfValidator.js");
  for (const [candidate, label] of [[lockPath, "validator lock"], [packagePath, "validator package"], [validatorPackagePath, "installed validator package"], [gltfPackagePath, "installed glTF package"], [executable, "validator executable"], [executableSource, "validator executable source"], [embeddedGltfSource, "embedded glTF adapter source"]]) {
    await assertContainedRegularFile(root, candidate, label);
  }
  const lock = await parseJsonFile(lockPath, 256 * 1024, "validator lock");
  const packageJson = await parseJsonFile(packagePath, 65_536, "validator package");
  const validatorPackage = await parseJsonFile(validatorPackagePath, 65_536, "installed validator package");
  const gltfPackage = await parseJsonFile(gltfPackagePath, 65_536, "installed glTF package");
  assert(packageJson.dependencies?.[EXPECTED_PACKAGE.validator.name] === EXPECTED_PACKAGE.validator.version, "declared validator version mismatch");
  assert(validatorPackage.version === EXPECTED_PACKAGE.validator.version, "installed validator version mismatch");
  assert(gltfPackage.version === EXPECTED_PACKAGE.gltf.version, "installed glTF validator version mismatch");
  assert(lock.packages?.[`node_modules/${EXPECTED_PACKAGE.validator.name}`]?.version === EXPECTED_PACKAGE.validator.version, "locked validator version mismatch");
  assert(lock.packages?.[`node_modules/${EXPECTED_PACKAGE.gltf.name}`]?.version === EXPECTED_PACKAGE.gltf.version, "locked glTF validator version mismatch");
  const packageBytes = await readFile(packagePath);
  const lockBytes = await readFile(lockPath);
  assert(sha256(packageBytes) === EXPECTED_PACKAGE.package_json_sha256, "validator package declaration digest mismatch");
  assert(sha256(lockBytes) === EXPECTED_PACKAGE.package_lock_sha256, "validator lock digest mismatch");
  return {
    root,
    executable,
    identity: {
      validator: EXPECTED_PACKAGE.validator,
      embedded_gltf_validator: EXPECTED_PACKAGE.gltf,
      package_json_sha256: sha256(packageBytes),
      package_lock_sha256: sha256(lockBytes),
      validator_package_json_sha256: sha256(await readFile(validatorPackagePath)),
      gltf_package_json_sha256: sha256(await readFile(gltfPackagePath)),
      validator_entrypoint_sha256: sha256(await readFile(executable)),
      validator_main_sha256: sha256(await readFile(executableSource)),
      embedded_gltf_adapter_sha256: sha256(await readFile(embeddedGltfSource)),
    },
  };
}

function runValidator(executable, tilesetFile, reportFile) {
  return new Promise((resolve, reject) => {
    const cwd = path.dirname(tilesetFile);
    const relativeTileset = path.relative(cwd, tilesetFile);
    assert(relativeTileset && !relativeTileset.startsWith("..") && !path.isAbsolute(relativeTileset), "validator input path escaped cwd");
    const args = [executable, "--tilesetFile", relativeTileset, "--reportFile", reportFile];
    const child = spawn(process.execPath, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "",
        LANG: "C",
        LC_ALL: "C",
        TZ: "UTC",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    const collect = (chunks, key) => chunk => {
      if (key === "stdout") stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes > MAX_STREAM_BYTES || stderrBytes > MAX_STREAM_BYTES) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout, "stdout"));
    child.stderr.on("data", collect(stderr, "stderr"));
    const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const result = {code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr)};
      if (overflow) {
        const error = new Error("validator output limit exceeded");
        error.validatorExecution = result;
        return reject(error);
      }
      if (code !== 0 || signal) {
        const error = new Error(`validator process failed: code=${code} signal=${signal ?? "none"}`);
        error.validatorExecution = result;
        return reject(error);
      }
      resolve(result);
    });
  });
}

async function retainFailedExecution(output, fixtureId, error) {
  const execution = error?.validatorExecution;
  if (!execution) return false;
  const stdoutPath = path.join(output, "raw", `${fixtureId}.stdout.txt`);
  const stderrPath = path.join(output, "raw", `${fixtureId}.stderr.txt`);
  await writeFile(stdoutPath, execution.stdout, {flag: "wx", mode: 0o600});
  await writeFile(stderrPath, execution.stderr, {flag: "wx", mode: 0o600});
  await writeFile(path.join(output, "integrity", `${fixtureId}.failure.json`), canonicalJson({
    schema: "cesium_validation_evidence_failed_execution_receipt.v1",
    fixture_id: fixtureId,
    error: String(error.message),
    stdout: {bytes: execution.stdout.length, sha256: sha256(execution.stdout)},
    stderr: {bytes: execution.stderr.length, sha256: sha256(execution.stderr)},
    exit_code: execution.code,
    signal: execution.signal,
    success_claimed: false,
  }), {flag: "wx", mode: 0o600});
  return true;
}

function normalizeIssue(issue, ordinalPath) {
  assert(isObject(issue), `issue malformed at ${ordinalPath}`);
  assert(typeof issue.type === "string" && issue.type.length > 0, `issue type malformed at ${ordinalPath}`);
  assert(["ERROR", "WARNING", "INFO"].includes(issue.severity), `issue severity malformed at ${ordinalPath}`);
  assert(typeof issue.path === "string" && typeof issue.message === "string", `issue text malformed at ${ordinalPath}`);
  const causes = issue.causes === undefined ? [] : issue.causes;
  assert(Array.isArray(causes) && causes.length <= 10_000, `issue causes malformed at ${ordinalPath}`);
  return {
    ordinal: ordinalPath,
    type_raw: issue.type,
    severity_raw: issue.severity,
    path_raw: issue.path,
    message_raw: issue.message,
    causes: causes.map((cause, index) => normalizeIssue(cause, `${ordinalPath}.${index}`)),
  };
}

function flattenIssues(issues) {
  const rows = [];
  const visit = issue => {
    rows.push(issue);
    issue.causes.forEach(visit);
  };
  issues.forEach(visit);
  return rows;
}

function normalizeRawReport(bytes, fixture) {
  const raw = parseStrictJson(bytes);
  assert(isObject(raw), "validator report must be an object");
  for (const key of ["numErrors", "numWarnings", "numInfos"]) {
    assert(Number.isSafeInteger(raw[key]) && raw[key] >= 0, `validator report ${key} invalid`);
  }
  const rawIssues = raw.issues === undefined ? [] : raw.issues;
  assert(Array.isArray(rawIssues) && rawIssues.length <= 10_000, "validator report issues invalid");
  if (rawIssues.length === 0) assert(raw.numErrors + raw.numWarnings + raw.numInfos === 0, "validator omitted nonzero issues");
  const issues = rawIssues.map((issue, index) => normalizeIssue(issue, String(index)));
  const topCounts = {ERROR: 0, WARNING: 0, INFO: 0};
  issues.forEach(issue => { topCounts[issue.severity_raw] += 1; });
  assert(topCounts.ERROR === raw.numErrors && topCounts.WARNING === raw.numWarnings && topCounts.INFO === raw.numInfos, "validator report count mismatch");
  const observedResult = raw.numErrors > 0 ? "FAIL" : raw.numWarnings > 0 ? "PASS_WITH_WARNINGS" : "PASS";
  const flattened = flattenIssues(issues);
  for (const required of fixture.required_issue_types) {
    assert(flattened.some(issue => issue.type_raw === required), `required issue type absent: ${required}`);
  }
  for (const required of fixture.required_issue_paths) {
    assert(flattened.some(issue => issue.path_raw === required), `required issue path absent: ${required}`);
  }
  const expectationMatched = fixture.expected_result === observedResult;
  return {
    schema: "cesium_validation_evidence_normalized_fixture.v1",
    fixture_id: fixture.id,
    expected_result: fixture.expected_result,
    observed_result: observedResult,
    expectation_matched: expectationMatched,
    counts: {errors: raw.numErrors, warnings: raw.numWarnings, infos: raw.numInfos},
    issues,
    raw_date_excluded_from_deterministic_projection: typeof raw.date === "string",
  };
}

function toSarif(results, toolIdentity) {
  const rows = results.flatMap(result => flattenIssues(result.issues).map(issue => ({fixture: result.fixture_id, issue})));
  const ruleIds = [...new Set(rows.map(row => row.issue.type_raw))].sort(compare);
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {driver: {
        name: "3D Tiles Validation Evidence & Replay Pack",
        version: "0.4.0",
        informationUri: "https://github.com/CesiumGS/3d-tiles-validator",
        rules: ruleIds.map(id => ({id, shortDescription: {text: id.replaceAll("_", " ")}})),
        properties: {upstream: toolIdentity},
      }},
      results: rows.map(({fixture, issue}) => ({
        ruleId: issue.type_raw,
        level: issue.severity_raw === "ERROR" ? "error" : issue.severity_raw === "WARNING" ? "warning" : "note",
        message: {text: issue.message_raw},
        locations: [{physicalLocation: {artifactLocation: {uri: `fixtures/v4/${fixture}/tileset.json`}, region: {snippet: {text: issue.path_raw || "/"}}}}],
        properties: {fixture_id: fixture, upstream_path: issue.path_raw, ordinal: issue.ordinal},
      })),
    }],
  };
}

const markdownEscape = value => String(value).replaceAll("|", "\\|").replace(/[\r\n]+/gu, " ");
function toMarkdown(summary) {
  return [
    "# 3D Tiles Validation Evidence & Replay Pack",
    "",
    `Suite status: **${summary.status}**`,
    "",
    "| Fixture | Expected | Observed | Errors | Warnings | Infos |",
    "|---|---:|---:|---:|---:|---:|",
    ...summary.results.map(row => `| ${markdownEscape(row.fixture_id)} | ${row.expected_result} | ${row.observed_result} | ${row.counts.errors} | ${row.counts.warnings} | ${row.counts.infos} |`),
    "",
    "Raw CesiumGS reports, stdout, and stderr are retained separately with byte counts and SHA-256 receipts. The deterministic projection excludes the upstream report date.",
    "",
    "The CesiumGS validator is the validation authority in this pack and invokes the Khronos glTF Validator internally. This wrapper adds fixture admission, replay, integrity, normalization, and review formats; it is not another validator or a certification claim.",
    "",
  ].join("\n");
}

export async function runUpstreamEvidenceSuite({suitePath, validatorRoot, outputDirectory}) {
  const suiteFile = path.resolve(suitePath);
  const suite = await parseJsonFile(suiteFile, 65_536, "fixture suite");
  assert(suite?.schema === "cesium_validation_evidence_fixture_suite.v1", "fixture suite schema mismatch");
  assert(suite.license_expression === "CC0-1.0" && suite.provenance === "AUTHORED_SYNTHETIC_FIXTURES", "fixture suite provenance invalid");
  assert(Array.isArray(suite.fixtures) && suite.fixtures.length === 3, "fixture suite must contain exactly three fixtures");
  const fixtureIds = suite.fixtures.map(row => row.id);
  assert(JSON.stringify(fixtureIds) === JSON.stringify([...fixtureIds].sort(compare)), "fixtures must be sorted");
  assert(new Set(fixtureIds).size === fixtureIds.length, "fixture IDs must be unique");
  for (const fixture of suite.fixtures) {
    assert(isObject(fixture) && /^[a-z][a-z0-9-]{1,63}$/u.test(fixture.id), "fixture ID invalid");
    assert(["PASS", "FAIL"].includes(fixture.expected_result), `fixture expectation invalid: ${fixture.id}`);
    assert(Array.isArray(fixture.required_issue_types) && Array.isArray(fixture.required_issue_paths), `fixture oracle invalid: ${fixture.id}`);
    assertRelativePath(fixture.manifest, `fixture manifest path: ${fixture.id}`);
  }
  const validator = await admitValidatorRoot(path.resolve(validatorRoot));
  const output = path.resolve(outputDirectory);
  await mkdir(output, {recursive: false});
  for (const subdirectory of ["raw", "integrity", "normalized"]) await mkdir(path.join(output, subdirectory));

  const normalizedResults = [];
  const suiteRoot = path.dirname(suiteFile);
  for (const fixture of suite.fixtures) {
    const manifestPath = path.join(suiteRoot, ...fixture.manifest.split("/"));
    const admitted = await admitFixture(manifestPath);
    const reportPath = path.join(output, "raw", `${fixture.id}.cesium-report.json`);
    let execution;
    try {
      execution = await runValidator(validator.executable, admitted.entryTileset, reportPath);
    } catch (error) {
      const retained = await retainFailedExecution(output, fixture.id, error);
      if (retained) {
        throw new Error(`${error.message}; diagnostics retained for fixture ${fixture.id}`, {cause: error});
      }
      throw error;
    }
    const rawReport = await readBounded(reportPath, MAX_REPORT_BYTES, "raw validator report");
    const normalized = normalizeRawReport(rawReport, fixture);
    const normalizedBytes = canonicalJson({...normalized, upstream_tool: validator.identity});
    await writeFile(path.join(output, "raw", `${fixture.id}.stdout.txt`), execution.stdout, {flag: "wx", mode: 0o600});
    await writeFile(path.join(output, "raw", `${fixture.id}.stderr.txt`), execution.stderr, {flag: "wx", mode: 0o600});
    await writeFile(path.join(output, "normalized", `${fixture.id}.json`), normalizedBytes, {flag: "wx", mode: 0o600});
    await writeFile(path.join(output, "integrity", `${fixture.id}.json`), canonicalJson({
      schema: "cesium_validation_evidence_raw_integrity_receipt.v1",
      fixture_id: fixture.id,
      raw_report: {bytes: rawReport.length, sha256: sha256(rawReport)},
      stdout: {bytes: execution.stdout.length, sha256: sha256(execution.stdout)},
      stderr: {bytes: execution.stderr.length, sha256: sha256(execution.stderr)},
      exit_code: execution.code,
      signal: execution.signal,
      raw_receipt_is_not_part_of_deterministic_projection: true,
    }), {flag: "wx", mode: 0o600});
    normalizedResults.push({...normalized, normalized_sha256: sha256(normalizedBytes)});
  }

  const passed = normalizedResults.every(result => result.expectation_matched);
  const summary = {
    schema: "cesium_validation_evidence_replay_summary.v1",
    status: passed ? "PASS_EXPECTATIONS" : "FAIL_EXPECTATIONS",
    tool: {
      name: "3D Tiles Validation Evidence & Replay Pack",
      version: "0.4.0",
      upstream: validator.identity,
      gltf_execution_path: "EMBEDDED_IN_CESIUMGS_3D_TILES_VALIDATOR",
      redundant_second_gltf_run: false,
    },
    fixtures: normalizedResults.length,
    results: normalizedResults.map(({issues, raw_date_excluded_from_deterministic_projection, ...result}) => result),
    claim_boundary: {
      proven: [
        "EXACT_LOCK_LOCAL_CESIUMGS_VALIDATOR_EXECUTION",
        "EMBEDDED_KHRONOS_GLTF_VALIDATION_PATH",
        "THREE_PROVENANCE_BOUND_FIXTURE_ORACLES",
        "RAW_REPORT_BYTE_INTEGRITY_RECEIPTS",
        "DETERMINISTIC_NORMALIZED_JSON_SARIF_MARKDOWN",
      ],
      not_proven: [
        "COMPLETE_3D_TILES_OR_GLTF_CONFORMANCE",
        "RENDERING_GEOMETRIC_OR_SPATIAL_CORRECTNESS",
        "CROSS_VIEWER_INTEROPERABILITY",
        "OGC_CESIUM_OR_KHRONOS_CERTIFICATION",
        "ADOPTION_PRODUCTION_SCALE_OR_EXTERNAL_VALIDATION",
        "ZERO_EGRESS_WITHOUT_AN_EXTERNAL_OS_SANDBOX",
      ],
    },
  };
  const summaryBytes = canonicalJson(summary);
  const sarifBytes = canonicalJson(toSarif(normalizedResults, validator.identity));
  const markdownBytes = toMarkdown(summary);
  await writeFile(path.join(output, "summary.json"), summaryBytes, {flag: "wx", mode: 0o600});
  await writeFile(path.join(output, "results.sarif"), sarifBytes, {flag: "wx", mode: 0o600});
  await writeFile(path.join(output, "report.md"), markdownBytes, {flag: "wx", mode: 0o600});
  return {
    status: summary.status,
    fixture_count: normalizedResults.length,
    deterministic_outputs: {
      summary_sha256: sha256(summaryBytes),
      sarif_sha256: sha256(sarifBytes),
      markdown_sha256: sha256(markdownBytes),
    },
  };
}

export const UPSTREAM_EVIDENCE_LIMITS = Object.freeze({
  report_bytes: MAX_REPORT_BYTES,
  stream_bytes: MAX_STREAM_BYTES,
  timeout_ms: PROCESS_TIMEOUT_MS,
});
