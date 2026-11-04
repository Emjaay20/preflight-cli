import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards, BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaService } from "../prisma.service";
import { OperatorGuard } from "./operator.guard";

@Controller()
export class OperatorController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("operator")
  @Header("content-type", "text/html; charset=utf-8")
  async page() {
    return fs.readFile(path.join(__dirname, "..", "public", "operator.html"), "utf8");
  }

  @UseGuards(OperatorGuard)
  @Get("v1/operator/access-requests")
  async accessRequests(@Query("status") status?: string) {
    return this.prisma.accessRequest.findMany({
      where: status ? { status } : undefined,
      include: { organization: { select: { id: true, name: true, slug: true, plan: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  @UseGuards(OperatorGuard)
  @Post("v1/operator/access-requests/:id/resolve")
  async resolve(
    @Param("id") id: string,
    @Body() body: { status?: string; note?: string },
    @Req() request: Request & { operatorEmail?: string },
  ) {
    const status = body.status?.trim();
    if (!status || !["contacted", "approved", "declined"].includes(status)) {
      throw new BadRequestException("status must be contacted, approved, or declined");
    }
    const updated = await this.prisma.accessRequest.update({
      where: { id },
      data: {
        status,
        handledAt: new Date(),
        handledBy: request.operatorEmail ?? "operator",
        resolutionNote: body.note?.trim() || null,
      },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });
    await this.prisma.auditEvent.create({
      data: {
        organizationId: updated.organizationId,
        actor: request.operatorEmail ?? "operator",
        action: "upgrade.request_resolved",
        targetType: "access_request",
        targetId: updated.id,
        metadata: { status, note: updated.resolutionNote },
      },
    });
    return updated;
  }
}
