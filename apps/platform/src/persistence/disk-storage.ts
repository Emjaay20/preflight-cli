import { Injectable, Optional } from "@nestjs/common";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "../crypto";
import type { ArtifactStorage } from "../reviews/reviews.service";

function sanitizeSegment(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned || fallback;
}

@Injectable()
export class DiskArtifactStorage implements ArtifactStorage {
  private readonly root: string;

  constructor(@Optional() rootDir?: string) {
    this.root = path.resolve(rootDir ?? process.env.DATA_DIR ?? "data");
  }

  async save(file: {
    organizationId?: string;
    projectId?: string;
    originalname: string;
    buffer: Buffer;
  }) {
    const id = randomUUID();
    const orgSeg = sanitizeSegment(file.organizationId, "shared");
    const projSeg = sanitizeSegment(file.projectId, "default");
    const dir = path.resolve(this.root, "tenants", orgSeg, "projects", projSeg, "artifacts", id);
    if (!dir.startsWith(this.root + path.sep)) {
      throw new Error("artifact storage path escaped tenant root");
    }
    await fs.mkdir(dir, { recursive: true });
    const safe = sanitizeSegment(path.basename(file.originalname), "artifact.zip");
    const dest = path.resolve(dir, safe);
    if (!dest.startsWith(dir + path.sep)) {
      throw new Error("artifact file path escaped review directory");
    }
    await fs.writeFile(dest, file.buffer);
    return { path: dest, sha256: sha256(file.buffer) };
  }

  async materialize(ref: {
    sha256: string;
    artifactPath: string;
    preferredName?: string;
  }): Promise<{ localPath: string; cleanup: () => Promise<void> }> {
    const exists = await fs
      .stat(ref.artifactPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return { localPath: ref.artifactPath, cleanup: async () => {} };
    }
    throw new Error(`artifact not found at ${ref.artifactPath} (sha256: ${ref.sha256})`);
  }
}
