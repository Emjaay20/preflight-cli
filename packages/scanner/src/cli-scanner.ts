import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ScanRequest, ScanResult, ScannerPort } from "@preflight/domain";
import { parseReviewReport } from "./parse-report";

export type CliScannerOptions = {
  bin?: string;
  timeoutMs?: number;
};

export class CliScanner implements ScannerPort {
  private readonly bin: string;
  private readonly timeoutMs: number;

  constructor(options: CliScannerOptions = {}) {
    this.bin = options.bin ?? process.env.PREFLIGHT_BIN ?? "preflight";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async review(input: ScanRequest): Promise<ScanResult> {
    await fs.mkdir(input.outDir, { recursive: true });
    const args = ["review", input.artifactPath, "--out", input.outDir];
    if (input.claimsPath) {
      args.push("--claims", input.claimsPath);
    }
    if (input.baselinePath) {
      args.push("--baseline", input.baselinePath);
    }
    for (const pack of input.packs) {
      args.push("--pack", pack);
    }


    await run(this.bin, args, this.timeoutMs);

    const jsonPath = path.join(input.outDir, "review.json");
    const mdPath = path.join(input.outDir, "REVIEW.md");
    const raw = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    const markdown = await fs.readFile(mdPath, "utf8");
    return parseReviewReport(raw, markdown);
  }
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`preflight timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Scanner uses exit 2 for block; that is still a successful analysis.
      if (code === 0 || code === 2) {
        resolve();
        return;
      }
      reject(new Error(`preflight exited ${code}: ${stderr.trim()}`));
    });
  });
}
