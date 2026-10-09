# 3D Tiles Validation Evidence & Replay Pack

Suite status: **PASS_EXPECTATIONS**

| Fixture | Expected | Observed | Errors | Warnings | Infos |
|---|---:|---:|---:|---:|---:|
| binary-invalid | FAIL | FAIL | 1 | 0 | 0 |
| positive | PASS | PASS | 0 | 0 | 0 |
| semantic-invalid | FAIL | FAIL | 1 | 0 | 0 |

Raw CesiumGS reports, stdout, and stderr are retained separately with byte counts and SHA-256 receipts. The deterministic projection excludes the upstream report date.

The CesiumGS validator is the validation authority in this pack and invokes the Khronos glTF Validator internally. This wrapper adds fixture admission, replay, integrity, normalization, and review formats; it is not another validator or a certification claim.
