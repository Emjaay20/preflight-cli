import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPipelineLogs,
  completeReview,
  openReview,
  startReview,
  type ScannerPort,
} from "@preflight/domain";
import { TOKENS } from "./tokens";
import { sha256 } from "./crypto";

const SANDBOX_FIXTURES = ["clean-relay", "extra-host", "broad-hosts", "remote-script"] as const;

@Controller()
export class DashboardController {
  constructor(@Inject(TOKENS.Scanner) private readonly scanner: ScannerPort) {}

  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  async index() {
    const file = path.join(__dirname, "..", "public", "index.html");
    return fs.readFile(file, "utf8");
  }

  @Get("v1/meta")
  async meta() {
    const root = process.env.FIXTURES_DIR ?? path.resolve("fixtures/harbor-node");
    let sampleClaims: unknown = null;
    try {
      sampleClaims = JSON.parse(await fs.readFile(path.join(root, "claims.json"), "utf8"));
    } catch {
      sampleClaims = null;
    }
    return {
      product: "preflight",
      version: "0.2.0",
      question:
        "Does this build still match the last shipped artifact and the claims made to users and stores?",
      autoShip: false,
      packs: ["cws-2026.1", "node-client-2026.1"],
      fixtures: SANDBOX_FIXTURES,
      sampleClaims,
      demo: process.env.DEMO_MODE === "true",
      demoKey: process.env.DEMO_MODE === "true" ? process.env.DEMO_API_KEY : undefined,
    };
  }

  @Post("v1/sandbox/evaluate")
  async evaluateSandbox(@Body() body: { fixture?: string; claims?: unknown }) {
    const fixture = body.fixture ?? "clean-relay";
    if (!SANDBOX_FIXTURES.includes(fixture as (typeof SANDBOX_FIXTURES)[number])) {
      throw new NotFoundException(`unknown sandbox fixture '${fixture}'`);
    }
    const root = process.env.FIXTURES_DIR ?? path.resolve("fixtures/harbor-node");
    const artifactPath = path.join(root, fixture);
    const baselinePath = fixture !== "clean-relay" ? path.join(root, "clean-relay") : undefined;
    const defaultClaimsRaw = await fs.readFile(path.join(root, "claims.json"), "utf8");
    const effectiveClaims =
      body.claims !== undefined ? body.claims : JSON.parse(defaultClaimsRaw);

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), `pf-sandbox-${fixture}-`));
    try {
      const claimsPath = path.join(tmpOut, "claims.json");
      await fs.writeFile(claimsPath, JSON.stringify(effectiveClaims, null, 2));
      const packs = ["cws-2026.1", "node-client-2026.1"];
      const scanResult = await this.scanner.review({
        artifactPath,
        baselinePath,
        claimsPath,
        packs,
        outDir: path.join(tmpOut, "out"),
      });

      const synthetic = completeReview(
        startReview(
          openReview({
            projectId: "sandbox-harbor-node",
            artifactName: `${fixture}.zip`,
            artifactSha256: sha256(Buffer.from(`${fixture}:${JSON.stringify(effectiveClaims)}`)),
            artifactPath,
            claims: effectiveClaims,
            packs,
            submittedBy: "public-sandbox (ephemeral · read-only)",
          }),
        ),
        scanResult,
      );

      return {
        id: synthetic.id,
        fixture,
        artifactName: synthetic.artifactName,
        artifactSha256: synthetic.artifactSha256,
        status: synthetic.status,
        verdict: synthetic.verdict,
        autoShip: false,
        submittedBy: synthetic.submittedBy,
        claims: effectiveClaims,
        findingCount: synthetic.findings.length,
        findings: synthetic.findings,
        inventory: synthetic.inventory,
        markdown: synthetic.markdown,
        pipelineLogs: buildPipelineLogs(synthetic),
        createdAt: synthetic.createdAt,
        completedAt: synthetic.completedAt,
      };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : "sandbox evaluation failed",
      );
    } finally {
      await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
