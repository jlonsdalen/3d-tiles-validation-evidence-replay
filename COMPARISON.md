# Scope and non-duplication comparison

The pack is an evidence-control layer around existing authoritative tools. It
does not replace their validation logic or claim a new conformance authority.

| Capability | CesiumGS 3D Tiles Validator 0.6.1 | Embedded Khronos glTF Validator | This pack |
|---|---|---|---|
| 3D Tiles diagnostics | Authoritative upstream implementation | Not applicable | Preserves and normalizes upstream results |
| glTF diagnostics | Invokes the embedded Khronos package for tile content | Authoritative glTF implementation used by CesiumGS | Preserves the nested diagnostics; no second glTF run |
| Exact dependency identity | Package metadata and lock resolution | Nested locked dependency | Binds versions, integrity values, and the complete lock |
| Fixture provenance | Caller responsibility | Caller responsibility | Requires byte hashes, source, license, and redistribution status |
| Raw evidence retention | Optional caller behavior | Returned through the CesiumGS path | Stores upstream report, stdout, stderr, and SHA-256 receipts |
| Deterministic review formats | Upstream report contains a timestamp | Nested in upstream output | Emits normalized JSON, SARIF, and Markdown |
| Expected negative outcomes | Caller interprets diagnostics | Caller interprets diagnostics | Matches fixture-specific diagnostic oracles and fails closed |
| Security or certification | Not inferred here | Not inferred here | Explicitly not claimed |

## Why not call both validators directly?

CesiumGS already calls the locked Khronos validator for glTF content. A second
direct run would duplicate work and could create two competing representations
of the same evidence. The pack instead proves the embedded path from the retained
nested output and records the exact Khronos package version.

## Current boundary

The current candidate covers three authored fixtures and the exact Linux x64,
Node.js 22 fixture profile documented in the demo. It does not demonstrate
3DTILES/SQLite package validation, hostile-input safety, complete 3D Tiles rule
coverage, rendering or spatial correctness, production-scale performance,
authenticated Cesium ion access, cross-viewer fidelity, or certification.

The proposed grant work expands the evidence set and documentation while keeping
the upstream validators authoritative. See `PROJECT_PLAN.md` for that future
scope.
