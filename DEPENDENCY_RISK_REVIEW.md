# Dependency risk review

Audit command: `npm audit --omit=dev --json` in `witness-lock/` on October 2,
2026. Registry result: 199 production dependencies, 5 high findings, 0 critical,
0 moderate, and 0 low.

Affected dependency paths reported by npm:

- `3d-tiles-validator@0.6.1` (direct), through `3d-tiles-tools` and `sharp`;
- `3d-tiles-tools`, through `@gltf-transform/functions` and `sharp`;
- `@gltf-transform/functions`, through `ndarray-pixels`;
- `ndarray-pixels`, through `sharp`;
- `sharp@0.32.6`, including the libvips and libheif advisory families linked by
  npm as `GHSA-f88m-g3jw-g9cj` and `GHSA-rgj7-g3m4-5g8c`.

The automated fix offered for the direct validator is `3d-tiles-validator@0.4.1`,
a downgrade that would violate the V4 source and evidence contract. It was not
applied. Publication does not make the lock production-safe. The supported V4
demonstration is limited to the three authored synthetic fixtures in a disposable
environment. Re-run the audit and validate an upstream-compatible repaired lock
before accepting untrusted assets or describing the tool as production-ready.

This is an engineering risk record, not a security certification.
