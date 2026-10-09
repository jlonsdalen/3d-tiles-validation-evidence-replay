# Security policy

This proof candidate accepts local, provenance-bound fixture files only. It is not
a sandbox for hostile validators or untrusted native dependencies. Run it in a
disposable environment and inspect the exact lock before installation.

Please use the repository's private security-advisory channel for suspected
vulnerabilities rather than opening an issue containing exploit details or secrets.

The pre-publication `npm audit --omit=dev --json` review reported five high and
zero critical findings in the pinned upstream dependency tree. They flow through
the current validator/tooling chain, including `sharp` and its native image stack.
The registry's proposed fix is a validator downgrade and has not been applied.
Until an upstream-compatible repaired lock is validated, treat this candidate as a
controlled-fixture evidence tool, not a hostile-input or production-safe service.

Supported candidate version: `0.4.x`.
