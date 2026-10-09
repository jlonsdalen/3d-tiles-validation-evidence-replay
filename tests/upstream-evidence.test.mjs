import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {runUpstreamEvidenceSuite} from "../lib/upstream-evidence.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packetRoot = path.resolve(here, "..");
const suitePath = path.join(packetRoot, "fixtures", "v4", "fixture-suite.v1.json");
const sha256 = value => createHash("sha256").update(value).digest("hex");

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "cesium-upstream-evidence-test-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

async function createFakeValidator(t, {allPass = false, exitFailure = false} = {}) {
  const root = await temporaryRoot(t);
  await copyFile(path.join(packetRoot, "witness-lock", "package.json"), path.join(root, "package.json"));
  await copyFile(path.join(packetRoot, "witness-lock", "package-lock.json"), path.join(root, "package-lock.json"));
  const validatorRoot = path.join(root, "node_modules", "3d-tiles-validator");
  const gltfRoot = path.join(root, "node_modules", "gltf-validator");
  await mkdir(path.join(validatorRoot, "build", "tileFormats"), {recursive: true});
  await mkdir(gltfRoot, {recursive: true});
  await writeFile(path.join(validatorRoot, "package.json"), '{"version":"0.6.1"}\n');
  await writeFile(path.join(gltfRoot, "package.json"), '{"version":"2.0.0-dev.3.10"}\n');
  await writeFile(path.join(validatorRoot, "build", "main.js"), "module.exports = {};\n");
  await writeFile(path.join(validatorRoot, "build", "tileFormats", "GltfValidator.js"), 'require("gltf-validator");\n');
  const fakeSource = `
const fs = require("node:fs");
const path = require("node:path");
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const id = path.basename(process.cwd());
const controlledExitFailure = ${JSON.stringify(exitFailure)} && id === "binary-invalid";
if (controlledExitFailure) {
  fs.writeSync(1, "controlled failure stdout\\n");
  fs.writeSync(2, "controlled failure stderr\\n");
  process.exitCode = 17;
}
if (!controlledExitFailure) {
let issues;
if (!${JSON.stringify(allPass)} && id === "binary-invalid") {
  issues = [{type:"CONTENT_VALIDATION_ERROR",path:"tile.gltf",message:"tile.gltf caused validation errors",severity:"ERROR",causes:[{type:"CONTENT_VALIDATION_ERROR",path:"/asset/version",message:"Unknown glTF major asset version: 1.",severity:"ERROR"}]}];
} else if (!${JSON.stringify(allPass)} && id === "semantic-invalid") {
  issues = [{type:"TILE_REFINE_MISSING_IN_ROOT",path:"/root",message:"The refine property must be set",severity:"ERROR"}];
}
const report = {date:String(process.hrtime.bigint()),numErrors:issues ? 1 : 0,numWarnings:0,numInfos:0};
if (issues) report.issues = issues;
fs.writeFileSync(args.get("--reportFile"), JSON.stringify(report, null, 2));
process.stdout.write("fake validator " + id + "\\n");
}
`;
  await writeFile(path.join(validatorRoot, "build", "main"), fakeSource);
  return root;
}

test("normalization is deterministic while raw timestamp-bearing reports retain distinct integrity", async t => {
  const validatorRoot = await createFakeValidator(t);
  const outputRoot = await temporaryRoot(t);
  const first = path.join(outputRoot, "first");
  const second = path.join(outputRoot, "second");
  const firstResult = await runUpstreamEvidenceSuite({suitePath, validatorRoot, outputDirectory: first});
  const secondResult = await runUpstreamEvidenceSuite({suitePath, validatorRoot, outputDirectory: second});
  assert.equal(firstResult.status, "PASS_EXPECTATIONS");
  assert.deepEqual(secondResult.deterministic_outputs, firstResult.deterministic_outputs);
  for (const name of ["summary.json", "results.sarif", "report.md"]) {
    assert.deepEqual(await readFile(path.join(second, name)), await readFile(path.join(first, name)));
  }
  const firstRaw = await readFile(path.join(first, "raw", "positive.cesium-report.json"));
  const secondRaw = await readFile(path.join(second, "raw", "positive.cesium-report.json"));
  assert.notEqual(sha256(firstRaw), sha256(secondRaw));
});

test("missing negative oracle evidence fails closed", async t => {
  const validatorRoot = await createFakeValidator(t, {allPass: true});
  const outputRoot = await temporaryRoot(t);
  await assert.rejects(
    runUpstreamEvidenceSuite({suitePath, validatorRoot, outputDirectory: path.join(outputRoot, "output")}),
    /required issue type absent/u,
  );
});

test("nonzero validator exit retains bounded diagnostics and never claims success", async t => {
  const validatorRoot = await createFakeValidator(t, {exitFailure: true});
  const outputRoot = await temporaryRoot(t);
  const output = path.join(outputRoot, "output");
  await assert.rejects(
    runUpstreamEvidenceSuite({suitePath, validatorRoot, outputDirectory: output}),
    /validator process failed: code=17 signal=none; diagnostics retained for fixture binary-invalid/u,
  );
  const stdout = await readFile(path.join(output, "raw", "binary-invalid.stdout.txt"));
  const stderr = await readFile(path.join(output, "raw", "binary-invalid.stderr.txt"));
  const receipt = JSON.parse(await readFile(path.join(output, "integrity", "binary-invalid.failure.json")));
  assert.equal(stdout.toString("utf8"), "controlled failure stdout\n");
  assert.equal(stderr.toString("utf8"), "controlled failure stderr\n");
  assert.equal(receipt.schema, "cesium_validation_evidence_failed_execution_receipt.v1");
  assert.equal(receipt.fixture_id, "binary-invalid");
  assert.equal(receipt.exit_code, 17);
  assert.equal(receipt.signal, null);
  assert.equal(receipt.stdout.bytes, stdout.length);
  assert.equal(receipt.stdout.sha256, sha256(stdout));
  assert.equal(receipt.stderr.bytes, stderr.length);
  assert.equal(receipt.stderr.sha256, sha256(stderr));
  assert.equal(receipt.success_claimed, false);
  await assert.rejects(readFile(path.join(output, "summary.json")), {code: "ENOENT"});
});
