const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const moduleObject = { exports: {} };
new Function("exports", ts.transpileModule(fs.readFileSync(require("node:path").join(__dirname, "../src/model.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(moduleObject.exports);
const { restoreHistory, restorePreferences, isJob } = moduleObject.exports;
for (const value of [null, "invalid", 12, {}, { theme: "green", printer: [] }]) {
  assert.deepEqual(restorePreferences(value), { theme: "system", printer: "" });
  assert.deepEqual(restoreHistory(value), []);
}
const job = { id: "one", ext: ".pdf", created: Date.now()/1000, status: "queued", options: { printer: "Printer", copies: 1 } };
assert.equal(isJob(job), true);
assert.deepEqual(restoreHistory([null, {}, job, { ...job, created: 0 }]), [job]);
assert.deepEqual(restorePreferences({ theme: "dark", printer: "Printer" }), { theme: "dark", printer: "Printer" });
assert.equal(isJob({ ...job, options: null }), false);
console.log("PASS: corrupted preferences/history recovery, expiry and malformed jobs");
