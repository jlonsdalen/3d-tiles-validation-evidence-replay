import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {access, readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const text = relative => readFile(path.join(root, relative), "utf8");
const builtCandidate = await access(path.join(root, "PUBLICATION-MANIFEST.json")).then(() => true, () => false);
const publicationPath = relative => builtCandidate ? relative : path.join("publication", relative);

test("publication manifest and release checksums bind every reviewed source file", async () => {
  if (!builtCandidate) {
    const sourceManifest = JSON.parse(await text("config/cesium-v4-publication-candidate.v1.json"));
    assert.equal(sourceManifest.public_contents.length, 35);
    assert.equal(new Set(sourceManifest.public_contents.map(row => row.target)).size, 35);
    for (const required of [
      "COMPARISON.md", "DEMO.md", "PROJECT_PLAN.md", "tests/publication-readiness.test.mjs",
    ]) assert.ok(sourceManifest.public_contents.some(row => row.target === required), `missing mapping: ${required}`);
    for (const row of sourceManifest.public_contents) await readFile(path.join(root, row.source));
    return;
  }
  const manifest = JSON.parse(await text("PUBLICATION-MANIFEST.json"));
  const checksumRows = (await text("RELEASE-CHECKSUMS.sha256")).trim().split("\n");
  assert.equal(manifest.status, "INTERNAL_STANDALONE_CANDIDATE_NOT_PUBLISHED");
  assert.equal(manifest.publication_authorized, false);
  assert.equal(manifest.submission_authorized, false);
  assert.deepEqual(manifest.generated_files, ["PUBLICATION-MANIFEST.json", "RELEASE-CHECKSUMS.sha256"]);
  assert.equal(checksumRows.length, manifest.files.length);

  const checksumByPath = new Map(checksumRows.map(row => {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(row);
    assert.ok(match, `invalid checksum row: ${row}`);
    return [match[2], match[1]];
  }));
  for (const row of manifest.files) {
    const bytes = await readFile(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes, `byte count changed: ${row.path}`);
    assert.equal(sha256(bytes), row.sha256, `manifest digest changed: ${row.path}`);
    assert.equal(checksumByPath.get(row.path), row.sha256, `release checksum changed: ${row.path}`);
  }
});

test("reviewer packet covers replay, comparison, plan, risk, and privacy boundaries", async () => {
  const documents = await Promise.all([
    "README.md", "DEMO.md", "COMPARISON.md", "PROJECT_PLAN.md",
    "SECURITY.md", "DEPENDENCY_RISK_REVIEW.md",
  ].map(relative => text(publicationPath(relative))));
  const packet = documents.join("\n");
  for (const required of [
    "PASS,FAIL,FAIL", "CesiumGS", "Khronos", "USD 15,000", "Twelve-month maintenance",
    "five known high", "controlled-fixture", "not claim",
  ]) assert.match(packet, new RegExp(required, "iu"), `missing reviewer boundary: ${required}`);
  for (const forbidden of [
    ["/", "home", "/"].join(""), ["work", "space/"].join(""),
    ["Think", "Centre"].join(""), ["Work", "force"].join(""),
    ["Bus", "179"].join(""), ["Bus", "186"].join(""), ["tail", "scale"].join(""),
  ]) assert.doesNotMatch(packet, new RegExp(forbidden, "iu"), `private/internal marker present: ${forbidden}`);
});
