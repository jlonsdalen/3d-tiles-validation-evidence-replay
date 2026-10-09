# Reviewer demo

This walkthrough exercises the exact locked CesiumGS validator and its embedded
Khronos glTF validator against the three included synthetic fixtures. It does not
contact Cesium services or require credentials.

## Requirements

- Linux x64
- Node.js 22 and npm
- bash and curl
- network access during dependency hydration
- a fresh clone with at least 1 GiB of free temporary storage

## Run

From the repository root:

```bash
npm run install:validator
npm test
npm run demo
npm run inspect
```

The installer uses the committed lockfile, installs with lifecycle scripts
disabled, downloads only the two exact sharp native artifacts required by this
fixture profile, verifies their SHA-256 digests, and forbids a node-gyp fallback.
After hydration, the demo reads local fixtures and writes local evidence.

## Expected evidence

The test command checks the deterministic normalizer, negative-oracle failure,
publication manifest hashes, reviewer-document coverage, and private-material
exclusions. The demo prints `PASS_EXPECTATIONS` and the conceptual fixture vector
`PASS,FAIL,FAIL`. The inspect command prints
`PUBLICATION_DEMO_INSPECTION_PASS`.

Review these generated files in `.demo-output/`:

- `summary.json` for the normalized fixture result and exact tool identities;
- `results.sarif` for code-review and CI ingestion;
- `report.md` for a human-readable summary;
- `raw/` and `integrity/` for retained upstream bytes and their receipts.

Raw upstream reports contain timestamps and therefore have run-specific hashes.
The normalized JSON, SARIF, and Markdown outputs are expected to be byte-identical
for the same inputs and locked toolchain.

## Fail closed

Stop if installation integrity fails, node-gyp is requested, a test fails, the
fixture vector changes, inspection fails, or the run exceeds the reviewer's time
budget. Do not reinterpret a failed negative fixture as a failed demo: the two
negative fixtures pass only when the expected upstream diagnostics are present.

The demonstrated internal clean run completed installation and replay well under
ten minutes, but network and host conditions vary. This is controlled-fixture
replay evidence, not a production performance guarantee.
