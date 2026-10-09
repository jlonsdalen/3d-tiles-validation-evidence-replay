#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {runUpstreamEvidenceSuite} from "../lib/upstream-evidence.mjs";

const usage = "usage: 3d-tiles-evidence-replay --suite <fixture-suite.v1.json> --validator-root <exact-lock-install-root> --out <new-directory>\n";
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!["--suite", "--validator-root", "--out"].includes(key) || !value || values.has(key)) {
    process.stderr.write(usage);
    process.exitCode = 2;
    break;
  }
  values.set(key, value);
}

if (process.exitCode === undefined) {
  if (values.size !== 3) {
    process.stderr.write(usage);
    process.exitCode = 2;
  } else {
    try {
      const result = await runUpstreamEvidenceSuite({
        suitePath: path.resolve(values.get("--suite")),
        validatorRoot: path.resolve(values.get("--validator-root")),
        outputDirectory: path.resolve(values.get("--out")),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status !== "PASS_EXPECTATIONS") process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${JSON.stringify({status: "FATAL_FAIL_CLOSED", error: String(error?.message ?? error)})}\n`);
      process.exitCode = 1;
    }
  }
}
