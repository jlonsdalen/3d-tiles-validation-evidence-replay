# Third-party dependency license review

Review scope: the 199 exact package entries installed from
`witness-lock/package-lock.json` on Node 22 Linux x64 for the controlled fixture
profile. Every installed package exposed a license expression in its package
metadata; no null license field was observed.

Observed expressions were Apache-2.0, MIT, BSD-3-Clause, ISC, 0BSD,
`MPL-2.0 OR Apache-2.0`, `MIT OR WTFPL`, `MIT AND Zlib`, and
`BSD-2-Clause OR MIT OR Apache-2.0`. The direct validator is
`3d-tiles-validator@0.6.1` (Apache-2.0); its embedded validator is
`gltf-validator@2.0.0-dev.3.10` (Apache-2.0); and the hydrated native image package
is `sharp@0.32.6` (Apache-2.0).

This is a license review, not a vulnerability clearance. The known advisory result
is documented separately in `DEPENDENCY_RISK_REVIEW.md`. This is an engineering
review of declared package metadata, not legal advice or a
claim that every downstream distribution obligation has been adjudicated. Before
publication, rerun the exact-lock audit, preserve upstream license files in the
installed dependency tree, and stop if the lock or any declared license changes.
