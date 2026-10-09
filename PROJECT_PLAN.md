# Proposed grant plan

This is a ten-week proposal for future work. The current repository is a bounded
proof of concept and must not be described as already delivering this plan.

## Deliverable

A standalone TypeScript CLI, versioned evidence schema, at least 24
provenance-bound positive and negative fixtures across ten representative rule
families, CI examples, tutorials, a contributor guide, and a reviewer-ready proof
packet. Existing CesiumGS and Khronos validators remain authoritative for their
own diagnostics.

## Milestones

| Target | Deliverable and acceptance signal |
|---|---|
| End of week 2 | Ecosystem inventory, non-duplication matrix, schema, rule semantics, and fixture plan reviewed. |
| End of week 5 | CLI, asset-graph checks, extension and metadata checks, provenance admission, JSON, and SARIF working against the planned fixture set. |
| End of week 8 | Capability profiles, negative fixtures, clean replay, deterministic receipts, and CI matrix demonstrated. |
| End of week 10 | Documentation, tutorial, public release candidate, contributor guide, and final evidence packet complete. |

## Budget — USD 15,000 maximum

| Work | USD |
|---|---:|
| CLI, schemas, and bounded rule engine | 6,000 |
| Provenance-bound conformance fixtures and capability profiles | 3,500 |
| Deterministic replay, SARIF, and CI matrix | 2,000 |
| Documentation, tutorials, and CI examples | 1,500 |
| Contributor onboarding and issue response | 1,000 |
| Twelve-month maintenance reserve | 1,000 |
| **Total** | **15,000** |

The request is for the future scope above, not payment for the current three-
fixture proof of concept.

## Risks and controls

| Risk | Control |
|---|---|
| Upstream diagnostic or package drift | Pin exact versions and integrity; make profile updates explicit and reviewable. |
| False conformance interpretation | Preserve raw severity, label unknown mappings, and state exclusions beside every report. |
| Fixture licensing or provenance gaps | Admit only hashed assets with source, license, redistribution, and transformation records. |
| Nondeterministic upstream metadata | Retain raw bytes separately and compare normalized artifacts. |
| Native dependency and advisory exposure | Use a bounded installer, disclose the five known high findings, and keep the profile controlled-fixture-only. |
| Scope growth beyond ten weeks | Hold the acceptance floor at the CLI, 24 fixtures, CI examples, documentation, and proof packet. |
| Low contributor adoption | Publish a contributor guide and issue templates without claiming demand or community commitment. |

## Maintenance commitment

For twelve months after the proposed public release, reserve capacity for
dependency review, reproducibility regressions, issue triage, documentation
corrections, and bounded capability-profile updates. Publish support boundaries
and response expectations; do not promise uninterrupted service, complete rule
coverage, or compatibility with every viewer.
