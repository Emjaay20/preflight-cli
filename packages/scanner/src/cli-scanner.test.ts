import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { CliScanner } from "./cli-scanner";

const repo = path.resolve(__dirname, "../../..");
const bin = path.join(repo, "target/debug/preflight");

describe("CliScanner against the Rust binary", () => {
  it("blocks extra-host", async () => {
    if (!existsSync(bin)) return;
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-"));
    const scanner = new CliScanner({ bin, timeoutMs: 30_000 });
    const result = await scanner.review({
      artifactPath: path.join(repo, "fixtures/harbor-node/extra-host"),
      claimsPath: path.join(repo, "fixtures/harbor-node/claims.json"),
      packs: ["cws-2026.1", "node-client-2026.1"],
      outDir,
    });
    expect(result.verdict).toBe("block");
    expect(result.findings.some((f) => f.controlId === "NODE-02")).toBe(true);
  });

  it("diffs against a project baseline artifact when baselinePath is provided", async () => {
    if (!existsSync(bin)) return;
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-diff-"));
    const scanner = new CliScanner({ bin, timeoutMs: 30_000 });
    const result = await scanner.review({
      artifactPath: path.join(repo, "fixtures/harbor-node/extra-host"),
      baselinePath: path.join(repo, "fixtures/harbor-node/clean-relay"),
      claimsPath: path.join(repo, "fixtures/harbor-node/claims.json"),
      packs: ["cws-2026.1", "node-client-2026.1"],
      outDir,
    });
    expect(result.findings.some((f) => f.controlId === "DIFF-02")).toBe(true);
  });
});
