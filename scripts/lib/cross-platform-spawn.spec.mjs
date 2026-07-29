import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatSpawnFailure,
  resolveNpmInvocation,
  resolveNodeInvocation,
  runSubprocessSync,
  sanitizeSpawnOutput,
} from "./cross-platform-spawn.mjs";

describe("cross-platform-spawn", () => {
  it("resolveNpmInvocation uses node + npm-cli.js without shell", () => {
    const root = process.cwd();
    const invocation = resolveNpmInvocation(["run", "build", "-w", "apps/api"], root);
    assert.equal(invocation.command, process.execPath);
    assert.ok(invocation.args[0].endsWith("npm-cli.js"));
    assert.deepEqual(invocation.args.slice(1), ["run", "build", "-w", "apps/api"]);
    assert.equal(invocation.shell, false);
  });

  it("resolveNodeInvocation uses process.execPath", () => {
    const script = path.join(process.cwd(), "scripts/audit-sgp-regression.mjs");
    const invocation = resolveNodeInvocation(script);
    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.args[0], script);
    assert.equal(invocation.shell, false);
  });

  it("formatSpawnFailure never includes undefined", () => {
    const message = formatSpawnFailure(
      "build-api",
      { command: process.execPath, args: ["npm-cli.js", "run", "build"], cwd: "/tmp" },
      {
        status: 1,
        signal: null,
        stdout: undefined,
        stderr: undefined,
      },
    );
    assert.doesNotMatch(message, /undefined/);
    assert.match(message, /stdout: \(vazio\)/);
    assert.match(message, /stderr: \(vazio\)/);
  });

  it("sanitizeSpawnOutput redacts credentials in URLs", () => {
    const output = sanitizeSpawnOutput("postgresql://user:secret@localhost/db");
    assert.match(output, /user:\*\*\*@/);
    assert.doesNotMatch(output, /secret/);
  });

  it("runSubprocessSync executes node script successfully", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-test-"));
    const script = path.join(tempDir, "echo.mjs");
    fs.writeFileSync(script, 'console.log("spawn-ok");');
    const proc = runSubprocessSync(
      "echo-script",
      resolveNodeInvocation(script),
      { cwd: tempDir, timeoutMs: 5000 },
    );
    assert.match(proc.stdout, /spawn-ok/);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
