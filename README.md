# 3D Tiles Validation Evidence & Replay Pack

This is a standalone Apache-2.0 publication candidate for deterministic,
reviewable evidence around the existing CesiumGS 3D Tiles Validator. It does not
replace or duplicate CesiumGS or Khronos validation logic. It pins their exact
versions, admits provenance-bound fixtures, retains raw reports with integrity
receipts, fails closed on incomplete evidence, and emits normalized JSON, SARIF,
and Markdown.

The CesiumGS validator invokes `gltf-validator` internally. This pack deliberately
does not perform a redundant second glTF validation pass.

## Ten-minute replay

Requirements: Linux x64, Node.js 22, npm, bash, curl, and network access while the
exact validator lock is hydrated. The installer prefetches the two pinned sharp
native artifacts with bounded retries and verifies their SHA-256 digests before
the package installers consume them. From a fresh clone:

```bash
npm run install:validator
npm test
npm run demo
npm run inspect
```

The demo must report `PASS_EXPECTATIONS` with the vector `PASS,FAIL,FAIL` and the
inspect command must report `PUBLICATION_DEMO_INSPECTION_PASS`. Outputs are written
to `.demo-output/` and are ignored by Git.

For a command-by-command walkthrough and the exact evidence a reviewer should
inspect, see [`DEMO.md`](DEMO.md). [`COMPARISON.md`](COMPARISON.md) explains what
this pack adds around the upstream validators without duplicating their logic.
[`PROJECT_PLAN.md`](PROJECT_PLAN.md) records the proposed ten-week scope, USD
15,000 budget, milestones, risks, and twelve-month maintenance commitment. These
are proposal commitments, not claims that the current bounded proof of concept
already delivers the full grant scope.

## Evidence boundary

The three included assets are authored synthetic fixtures dedicated under CC0-1.0:
a valid 3D Tiles 1.1 + glTF 2.0 fixture, a tileset semantic failure, and a glTF 1.0
content failure observed through the embedded Khronos path. Their exact bytes,
provenance, license, and expected diagnostics are bound in manifests.

This candidate proves bounded local replay on the included fixtures. It does not
prove complete schema or semantic coverage, rendering or spatial correctness,
production-scale safety, network isolation, Cesium/OGC/Khronos certification,
customer adoption, or compatibility with every viewer. Raw upstream reports carry
a timestamp; raw integrity receipts therefore vary while the normalized JSON,
SARIF, and Markdown projections are deterministic.

See `THIRD_PARTY_LICENSE_REVIEW.md` for declared licenses,
`DEPENDENCY_RISK_REVIEW.md` for the five known high-severity dependency findings,
and `SECURITY.md` for the controlled-fixture-only threat boundary.
