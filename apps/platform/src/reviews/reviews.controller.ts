import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canSignOff, buildPipelineLogs, type Review } from "@preflight/domain";
import { PrismaService } from "../prisma.service";
import { ApiKeyGuard, type AuthContext } from "../auth/api-key.guard";
import { CurrentAuth } from "../auth/current-auth";
import { ReviewsService } from "./reviews.service";
import { PrismaProjectRepository } from "../persistence/prisma-repos";


const FIXTURES = ["clean-relay", "extra-host", "broad-hosts", "remote-script"] as const;

function actorLabel(auth: AuthContext): string {
  return `${auth.apiKeyName} (${auth.role} · ${auth.apiKeyPrefix})`;
}

@ApiTags("reviews")
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller("v1")
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly projects: PrismaProjectRepository,
    private readonly prisma: PrismaService,
  ) {}

  @Get("projects")
  async listProjects(@CurrentAuth() auth: AuthContext) {
    return this.projects.listByOrg(auth.organizationId);
  }

  @Post("projects/:projectId/reviews")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("artifact", {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async submit(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("claims") claimsRaw?: string,
  ) {
    if (!file) throw new BadRequestException("artifact file is required");
    let claims: unknown;
    if (claimsRaw && claimsRaw.trim()) {
      try {
        claims = JSON.parse(claimsRaw);
      } catch {
        throw new BadRequestException("claims must be JSON");
      }
    }
    try {
      const review = await this.reviews.submit({
        organizationId: auth.organizationId,
        projectId,
        file: { originalname: file.originalname, buffer: file.buffer },
        claims,
        submittedBy: actorLabel(auth),
      });
      return serialize(review);
    } catch (err) {
      const message = err instanceof Error ? err.message : "submit failed";
      if (message.includes("not found")) throw new NotFoundException(message);
      throw new BadRequestException(message);
    }
  }

  @Get("reviews/:id")
  async get(@CurrentAuth() auth: AuthContext, @Param("id") id: string) {
    const review = await this.reviews.getForOrg(id, auth.organizationId);
    if (!review) throw new NotFoundException("review not found");
    return serialize(review);
  }

  @Get("reviews/:id/markdown")
  @Header("content-type", "text/markdown; charset=utf-8")
  async markdown(@CurrentAuth() auth: AuthContext, @Param("id") id: string) {
    const review = await this.reviews.getForOrg(id, auth.organizationId);
    if (!review?.markdown) throw new NotFoundException("review not found");
    return review.markdown;
  }

  @Post("reviews/:id/sign-off")
  async signOff(
    @CurrentAuth() auth: AuthContext,
    @Param("id") id: string,
    @Body() body: { reviewer?: string; decision?: string; notes?: string },
  ) {
    if (!canSignOff(auth.role)) {
      throw new ForbiddenException(
        "CI keys cannot sign off releases; use a reviewer or admin key",
      );
    }
    const decision = body.decision;
    if (decision !== "ship" && decision !== "hold" && decision !== "reject") {
      throw new BadRequestException("decision must be ship, hold, or reject");
    }
    try {
      const review = await this.reviews.signOff(id, auth.organizationId, {
        reviewer: body.reviewer ?? "",
        decision,
        notes: body.notes ?? "",
        role: auth.role,
        keyIdentity: `${auth.apiKeyName}/${auth.apiKeyPrefix}`,
      });
      return serialize(review);
    } catch (err) {
      const message = err instanceof Error ? err.message : "sign-off failed";
      if (message.includes("not found")) throw new NotFoundException(message);
      if (message.includes("CI keys")) throw new ForbiddenException(message);
      throw new BadRequestException(message);
    }
  }

  @Get("reviews")
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query("projectId") projectId?: string,
  ) {
    const rows = await this.prisma.review.findMany({
      where: {
        project: {
          organizationId: auth.organizationId,
          ...(projectId ? { id: projectId } : {}),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { findings: true, project: true },
    });
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      project: row.project.slug,
      projectName: row.project.name,
      status: row.status,
      verdict: row.verdict,
      artifactName: row.artifactName,
      submittedBy: row.submittedBy ?? null,
      signedOffBy: row.signedOffBy ?? null,
      signOffDecision: row.signOffDecision ?? null,
      findingCount: row.findings.length,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }));
  }

  @Post("reviews/demo")
  @ApiBody({
    schema: {
      properties: {
        fixture: { type: "string" },
        projectId: { type: "string" },
      },
    },
  })
  async demo(
    @CurrentAuth() auth: AuthContext,
    @Body() body: { fixture?: string; projectId?: string },
  ) {
    const fixture = body.fixture ?? "clean-relay";
    if (!FIXTURES.includes(fixture as (typeof FIXTURES)[number])) {
      throw new NotFoundException(`unknown fixture ${fixture}`);
    }
    const orgProjects = await this.projects.listByOrg(auth.organizationId);
    const project = body.projectId
      ? orgProjects.find((p) => p.id === body.projectId)
      : orgProjects[0];
    if (!project) throw new NotFoundException("project not found in this organization");
    const root = process.env.FIXTURES_DIR ?? path.resolve("fixtures/harbor-node");
    const dir = path.join(root, fixture);
    const claims = JSON.parse(await fs.readFile(path.join(root, "claims.json"), "utf8"));
    const buffer = await zipDir(dir);
    const review = await this.reviews.submit({
      organizationId: auth.organizationId,
      projectId: project.id,
      file: { originalname: `${fixture}.zip`, buffer },
      claims,
      submittedBy: actorLabel(auth),
    });
    return serialize(review);
  }
}

function serialize(review: Review) {
  return {
    id: review.id,
    projectId: review.projectId,
    status: review.status,
    verdict: review.verdict,
    autoShip: false,
    artifactName: review.artifactName,
    artifactSha256: review.artifactSha256,
    claims: review.claims ?? null,
    submittedBy: review.submittedBy ?? null,
    findingCount: review.findings.length,
    findings: review.findings,
    inventory: review.inventory,
    pipelineLogs: buildPipelineLogs(review),
    error: review.error,
    signOff: review.signOff ?? null,
    createdAt: review.createdAt,
    startedAt: review.startedAt,
    completedAt: review.completedAt,
  };
}


async function zipDir(dir: string): Promise<Buffer> {
  // Store the directory path as the artifact. The Rust scanner accepts directories.
  // We still need a buffer for hashing/storage; pack a simple marker plus copy.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { tmpdir } = await import("node:os");
  const exec = promisify(execFile);
  const out = path.join(tmpdir(), `preflight-${path.basename(dir)}-${Date.now()}.zip`);
  await exec("zip", ["-r", "-q", out, "."], { cwd: dir });
  const buf = await fs.readFile(out);
  await fs.unlink(out).catch(() => undefined);
  return buf;
}
