import { Injectable } from "@nestjs/common";
import type { DomainEvent, Finding, Review, ReviewRepository, SignOffDecision } from "@preflight/domain";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import type { ProjectRecord, ProjectRepository } from "../reviews/reviews.service";

function toDomain(row: Prisma.ReviewGetPayload<{ include: { findings: true } }>): Review {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    verdict: (row.verdict as Review["verdict"]) ?? null,
    autoShip: false,
    artifactName: row.artifactName,
    artifactSha256: row.artifactSha256,
    artifactPath: row.artifactPath,
    claims: row.claims,
    packs: row.packs,
    submittedBy: row.submittedBy ?? null,
    findings: row.findings.map(
      (f): Finding => ({
        id: f.findingKey,
        controlId: f.controlId,
        pack: f.pack,
        severity: f.severity as Finding["severity"],
        file: f.file,
        field: f.field,
        line: f.line,
        snippet: f.snippet,
        title: f.title,
        summary: f.summary,
      }),
    ),
    inventory: row.inventory,
    report: row.report,
    markdown: row.markdown,
    error: row.error,
    signOff:
      row.signedOffAt && row.signedOffBy && row.signOffDecision
        ? {
            reviewer: row.signedOffBy,
            decision: row.signOffDecision as SignOffDecision,
            notes: row.signOffNotes ?? "",
            at: row.signedOffAt,
          }
        : null,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

@Injectable()
export class PrismaReviewRepository implements ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Review | null> {
    const row = await this.prisma.review.findUnique({
      where: { id },
      include: { findings: true },
    });
    return row ? toDomain(row) : null;
  }

  async findLatestBaselineByProject(projectId: string, excludeReviewId: string): Promise<Review | null> {
    const shipped = await this.prisma.review.findFirst({
      where: {
        projectId,
        id: { not: excludeReviewId },
        status: "completed",
        signOffDecision: "ship",
      },
      orderBy: { completedAt: "desc" },
      include: { findings: true },
    });
    if (shipped) return toDomain(shipped);

    const latestCompleted = await this.prisma.review.findFirst({
      where: {
        projectId,
        id: { not: excludeReviewId },
        status: "completed",
      },
      orderBy: { completedAt: "desc" },
      include: { findings: true },
    });
    return latestCompleted ? toDomain(latestCompleted) : null;
  }

  async save(review: Review): Promise<Review> {
    await this.prisma.$transaction(async (tx) => {
      await tx.review.upsert({
        where: { id: review.id },
        create: {
          id: review.id,
          projectId: review.projectId,
          status: review.status,
          verdict: review.verdict,
          artifactName: review.artifactName,
          artifactSha256: review.artifactSha256,
          artifactPath: review.artifactPath,
          claims: review.claims as Prisma.InputJsonValue,
          packs: review.packs,
          submittedBy: review.submittedBy ?? null,
          inventory: review.inventory as Prisma.InputJsonValue,
          report: review.report as Prisma.InputJsonValue,
          markdown: review.markdown,
          error: review.error,
          createdAt: review.createdAt,
          startedAt: review.startedAt,
          completedAt: review.completedAt,
          signedOffAt: review.signOff?.at ?? null,
          signedOffBy: review.signOff?.reviewer ?? null,
          signOffDecision: review.signOff?.decision ?? null,
          signOffNotes: review.signOff?.notes ?? null,
        },
        update: {
          status: review.status,
          verdict: review.verdict,
          submittedBy: review.submittedBy ?? null,
          inventory: review.inventory as Prisma.InputJsonValue,
          report: review.report as Prisma.InputJsonValue,
          markdown: review.markdown,
          error: review.error,
          startedAt: review.startedAt,
          completedAt: review.completedAt,
          signedOffAt: review.signOff?.at ?? null,
          signedOffBy: review.signOff?.reviewer ?? null,
          signOffDecision: review.signOff?.decision ?? null,
          signOffNotes: review.signOff?.notes ?? null,
        },
      });
      await tx.finding.deleteMany({ where: { reviewId: review.id } });
      if (review.findings.length > 0) {
        await tx.finding.createMany({
          data: review.findings.map((f) => ({
            reviewId: review.id,
            findingKey: f.id,
            controlId: f.controlId,
            pack: f.pack,
            severity: f.severity,
            file: f.file,
            field: f.field,
            line: f.line,
            snippet: f.snippet,
            title: f.title,
            summary: f.summary,
          })),
        });
      }
    });
    const saved = await this.findById(review.id);
    if (!saved) throw new Error("failed to persist review");
    return saved;
  }

  async saveOutbox(reviewId: string, event: DomainEvent): Promise<void> {
    await this.prisma.outboxEvent.create({
      data: {
        reviewId,
        type: event.type,
        payload: event.payload as Prisma.InputJsonValue,
        createdAt: event.occurredAt,
      },
    });
  }
}

@Injectable()
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<ProjectRecord | null> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    return row
      ? {
          id: row.id,
          organizationId: row.organizationId,
          name: row.name,
          slug: row.slug,
          defaultClaims: row.defaultClaims ?? null,
        }
      : null;
  }

  async listByOrg(organizationId: string): Promise<ProjectRecord[]> {
    const rows = await this.prisma.project.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      slug: row.slug,
      defaultClaims: row.defaultClaims ?? null,
    }));
  }

  async create(input: {
    organizationId: string;
    name: string;
    slug: string;
    defaultClaims?: unknown;
  }): Promise<ProjectRecord> {
    const row = await this.prisma.project.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        defaultClaims: (input.defaultClaims ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      slug: row.slug,
      defaultClaims: row.defaultClaims ?? null,
    };
  }

  async updateDefaultClaims(
    organizationId: string,
    projectId: string,
    defaultClaims: unknown | null,
  ): Promise<ProjectRecord | null> {
    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!existing) return null;
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        defaultClaims: (defaultClaims ?? null) as Prisma.InputJsonValue,
      },
    });
    return {
      id: updated.id,
      organizationId: updated.organizationId,
      name: updated.name,
      slug: updated.slug,
      defaultClaims: updated.defaultClaims ?? null,
    };
  }
}
