#!/usr/bin/env node
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] || ".demo-output");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const expected = Object.freeze({
  summary: "5caf7c18333f2989f225950f8a9c19461407a42b4843079af32856c2f0f4d5ce",
  sarif: "6c686a2c8b0032a1edbd73b2499df37247621eca2909aaf4e830f721dd9d43c0",
  markdown: "12c89f145e5f4049d7e4ee210563e6696e69c12f753f9f7f9ef53215564cad4a",
});
const summaryBytes = await readFile(path.join(output, "summary.json"));
const sarifBytes = await readFile(path.join(output, "results.sarif"));
const markdownBytes = await readFile(path.join(output, "report.md"));
const summary = JSON.parse(summaryBytes);
const vector = summary.results.map(row => row.observed_result).join(",");
if (summary.status !== "PASS_EXPECTATIONS" || vector !== "FAIL,PASS,FAIL") {
  throw new Error(`unexpected replay result: ${summary.status} ${vector}`);
}
const observed = {
  summary: sha256(summaryBytes),
  sarif: sha256(sarifBytes),
  markdown: sha256(markdownBytes),
};
if (JSON.stringify(observed) !== JSON.stringify(expected)) {
  throw new Error(`deterministic artifact mismatch: ${JSON.stringify(observed)}`);
}
process.stdout.write(`${JSON.stringify({status: "PUBLICATION_DEMO_INSPECTION_PASS", fixtures: 3, observed_vector: vector, sha256: observed})}\n`);
