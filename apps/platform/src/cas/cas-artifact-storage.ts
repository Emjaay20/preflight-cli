import { Injectable, Optional } from "@nestjs/common";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { CasEngine } from "./cas-engine";
import type { ArtifactStorage } from "../reviews/reviews.service";

function sanitizeSegment(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned || fallback;
}

export type CasStorageConfig = {
  rootDir?: string;
  remoteBaseUrl?: string;
  clusterSecret?: string;
};

@Injectable()
export class CasArtifactStorage implements ArtifactStorage {
  private readonly root: string;
  private readonly cas: CasEngine;
  private readonly remoteBaseUrl?: string;
  private readonly clusterSecret?: string;

  constructor(@Optional() config?: CasStorageConfig) {
    this.root = path.resolve(config?.rootDir ?? process.env.DATA_DIR ?? "data");
    this.cas = new CasEngine(path.join(this.root, "cas"));
    this.remoteBaseUrl = config?.remoteBaseUrl ?? process.env.CAS_REMOTE_URL;
    this.clusterSecret = config?.clusterSecret ?? process.env.INTERNAL_BLOB_TOKEN;
  }

  getCasEngine(): CasEngine {
    return this.cas;
  }

  async save(file: {
    organizationId?: string;
    projectId?: string;
    originalname: string;
    buffer: Buffer;
  }): Promise<{ path: string; sha256: string }> {
    // 1. Content-addressable storage (deduplicated, crash-safe fsync write)
    const writeResult = await this.cas.write(file.buffer);

    // 2. Tenant isolation mirror
    const id = randomUUID();
    const orgSeg = sanitizeSegment(file.organizationId, "shared");
    const projSeg = sanitizeSegment(file.projectId, "default");
    const tenantDir = path.resolve(
      this.root,
      "tenants",
      orgSeg,
      "projects",
      projSeg,
      "artifacts",
      id,
    );
    if (!tenantDir.startsWith(this.root + path.sep)) {
      throw new Error("artifact storage path escaped tenant root");
    }
    await fs.mkdir(tenantDir, { recursive: true });
    const safeName = sanitizeSegment(path.basename(file.originalname), "artifact.zip");
    const tenantPath = path.resolve(tenantDir, safeName);
    if (!tenantPath.startsWith(tenantDir + path.sep)) {
      throw new Error("artifact file path escaped review directory");
    }

    // Try hardlink for zero-copy efficiency, fallback to write
    try {
      await fs.link(writeResult.path, tenantPath);
    } catch {
      await fs.writeFile(tenantPath, file.buffer);
    }

    return {
      path: tenantPath,
      sha256: writeResult.sha256,
    };
  }

  async materialize(ref: {
    sha256: string;
    artifactPath: string;
    preferredName?: string;
  }): Promise<{ localPath: string; cleanup: () => Promise<void> }> {
    const cleanSha = ref.sha256.trim().toLowerCase();

    // 1. Check local direct path (e.g. on single-node or shared storage)
    if (ref.artifactPath) {
      const exists = await fs.stat(ref.artifactPath).then(() => true).catch(() => false);
      if (exists) {
        return {
          localPath: ref.artifactPath,
          cleanup: async () => {},
        };
      }
    }

    // 2. Check local CAS engine
    const hasInCas = await this.cas.has(cleanSha);
    if (hasInCas) {
      const blobPath = this.cas.blobPath(cleanSha);
      const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-cas-scratch-"));
      const safeName = sanitizeSegment(ref.preferredName, "artifact.zip");
      const targetPath = path.join(scratchDir, safeName);

      try {
        await fs.link(blobPath, targetPath);
      } catch {
        await fs.copyFile(blobPath, targetPath);
      }

      return {
        localPath: targetPath,
        cleanup: async () => {
          await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
        },
      };
    }

    // 3. Remote HTTP CAS download (for distributed workers on separate VPS or nodes)
    const remoteUrl = this.remoteBaseUrl;
    if (remoteUrl) {
      const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-remote-scratch-"));
      const safeName = sanitizeSegment(ref.preferredName, "artifact.zip");
      const targetPath = path.join(scratchDir, safeName);

      const endpoint = `${remoteUrl.replace(/\/+$/, "")}/v1/blobs/${cleanSha}`;
      const headers: Record<string, string> = {};
      if (this.clusterSecret) {
        headers["x-blob-token"] = this.clusterSecret;
      }

      const res = await fetch(endpoint, { headers });
      if (!res.ok) {
        await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
        throw new Error(
          `failed to fetch blob from remote CAS at ${endpoint}: HTTP ${res.status} ${res.statusText}`,
        );
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const receivedHash = createHash("sha256").update(buffer).digest("hex");

      if (receivedHash !== cleanSha) {
        await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
        throw new Error(
          `corrupted blob received from remote CAS: expected sha256 ${cleanSha}, got ${receivedHash}`,
        );
      }

      await fs.writeFile(targetPath, buffer);

      // Cache into local CAS for subsequent tasks
      await this.cas.write(buffer, cleanSha).catch(() => {});

      return {
        localPath: targetPath,
        cleanup: async () => {
          await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
        },
      };
    }

    throw new Error(
      `artifact blob ${cleanSha} not found locally at '${ref.artifactPath}' and no CAS_REMOTE_URL configured for remote fetch`,
    );
  }

  async getBlob(sha256: string): Promise<Buffer | null> {
    return this.cas.getBuffer(sha256);
  }
}
