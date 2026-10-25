import {
  Controller,
  Get,
  Head,
  Post,
  Param,
  Res,
  Req,
  NotFoundException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
  HttpStatus,
  Inject,
  UseGuards,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ApiTags, ApiOperation, ApiConsumes } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { CasEngine } from "./cas-engine";
import { CasArtifactStorage } from "./cas-artifact-storage";
import { InternalBlobGuard } from "./internal-blob.guard";

const SHA256 = /^[a-f0-9]{64}$/i;

function normalizeSha256(raw: string): string {
  const clean = (raw ?? "").trim().toLowerCase();
  if (!SHA256.test(clean)) {
    throw new BadRequestException("sha256 must be a 64-character hexadecimal digest");
  }
  return clean;
}

@ApiTags("blobs")
@UseGuards(InternalBlobGuard)
@Controller("v1/blobs")
export class BlobsController {
  private readonly cas: CasEngine;

  constructor(
    @Inject(CasArtifactStorage) private readonly storage: CasArtifactStorage,
  ) {
    this.cas = storage.getCasEngine();
  }

  @Head(":sha256")
  @ApiOperation({ summary: "Check blob existence and metadata by SHA-256" })
  async head(
    @Param("sha256") sha256: string,
    @Res() res: Response,
  ): Promise<void> {
    const clean = normalizeSha256(sha256);
    const stat = await this.cas.stat(clean);
    if (!stat) {
      throw new NotFoundException(`blob ${clean} not found`);
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("ETag", `"${clean}"`);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(HttpStatus.OK).end();
  }

  @Get(":sha256")
  @ApiOperation({ summary: "Stream blob content by SHA-256" })
  async get(
    @Param("sha256") sha256: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const clean = normalizeSha256(sha256);
    const stat = await this.cas.stat(clean);
    if (!stat) {
      throw new NotFoundException(`blob ${clean} not found`);
    }

    const ifNoneMatch = req.header("if-none-match");
    if (ifNoneMatch && (ifNoneMatch === clean || ifNoneMatch === `"${clean}"`)) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("ETag", `"${clean}"`);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const item = this.cas.getStream(clean);
    if (!item) {
      throw new NotFoundException(`blob ${clean} could not be opened`);
    }
    item.stream.pipe(res);
  }

  @Get(":sha256/verify")
  @ApiOperation({ summary: "Cryptographically verify blob integrity on disk" })
  async verify(@Param("sha256") sha256: string) {
    const clean = normalizeSha256(sha256);
    return this.cas.verify(clean);
  }

  @Post()
  @ApiOperation({ summary: "Upload and content-address a blob" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException("file is required");
    }
    const result = await this.cas.write(file.buffer);
    return {
      sha256: result.sha256,
      size: result.size,
      deduplicated: result.deduplicated,
    };
  }
}
