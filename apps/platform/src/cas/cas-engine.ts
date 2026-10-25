import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { sha256 } from "../crypto";

const SHA256_REGEX = /^[a-f0-9]{64}$/i;

export type CasWriteResult = {
  sha256: string;
  size: number;
  path: string;
  deduplicated: boolean;
};

export type CasVerifyResult = {
  sha256: string;
  valid: boolean;
  size: number;
};

export class CasEngine {
  private readonly root: string;
  private readonly blobsDir: string;
  private readonly stagingDir: string;
  private initialized = false;

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? path.join(process.env.DATA_DIR ?? "data", "cas"));
    this.blobsDir = path.join(this.root, "blobs");
    this.stagingDir = path.join(this.root, "staging");
  }

  getRoot(): string {
    return this.root;
  }

  getBlobsDir(): string {
    return this.blobsDir;
  }

  blobPath(hash: string): string {
    const clean = hash.trim().toLowerCase();
    if (!SHA256_REGEX.test(clean)) {
      throw new Error(`invalid sha256 hash: ${hash}`);
    }
    // 2-level prefix fanout: ab/cd/<hash>.blob
    return path.join(this.blobsDir, clean.slice(0, 2), clean.slice(2, 4), `${clean}.blob`);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.blobsDir, { recursive: true });
    await fs.mkdir(this.stagingDir, { recursive: true });
    this.initialized = true;
  }

  async write(buffer: Buffer, expectedSha?: string): Promise<CasWriteResult> {
    await this.init();
    const digest = sha256(buffer);
    if (expectedSha && expectedSha.trim().toLowerCase() !== digest) {
      throw new Error(`checksum mismatch: expected ${expectedSha}, got ${digest}`);
    }

    const dest = this.blobPath(digest);
    const existing = await fs.stat(dest).then(() => true).catch(() => false);
    if (existing) {
      return {
        sha256: digest,
        size: buffer.length,
        path: dest,
        deduplicated: true,
      };
    }

    const tempFile = path.join(this.stagingDir, `${randomUUID()}.part`);
    const fileHandle = await fs.open(tempFile, "w");
    try {
      await fileHandle.write(buffer);
      await fileHandle.sync(); // fsync ensures bytes are physically flushed to disk
    } finally {
      await fileHandle.close();
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(tempFile, dest);

    return {
      sha256: digest,
      size: buffer.length,
      path: dest,
      deduplicated: false,
    };
  }

  async writeStream(
    stream: NodeJS.ReadableStream,
    expectedSha?: string,
  ): Promise<CasWriteResult> {
    await this.init();
    const tempFile = path.join(this.stagingDir, `${randomUUID()}.part`);
    const hasher = createHash("sha256");
    let totalBytes = 0;

    const outStream = fsSync.createWriteStream(tempFile, { flags: "w" });

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => {
        hasher.update(chunk);
        totalBytes += chunk.length;
      });
      stream.on("error", (err) => {
        outStream.destroy(err);
        reject(err);
      });
      outStream.on("error", reject);
      outStream.on("finish", () => resolve());
      stream.pipe(outStream);
    });

    // fsync the written part
    const fd = await fs.open(tempFile, "r+");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }

    const digest = hasher.digest("hex");
    if (expectedSha && expectedSha.trim().toLowerCase() !== digest) {
      await fs.unlink(tempFile).catch(() => {});
      throw new Error(`checksum mismatch: expected ${expectedSha}, got ${digest}`);
    }

    const dest = this.blobPath(digest);
    const existing = await fs.stat(dest).then(() => true).catch(() => false);
    if (existing) {
      await fs.unlink(tempFile).catch(() => {});
      return {
        sha256: digest,
        size: totalBytes,
        path: dest,
        deduplicated: true,
      };
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(tempFile, dest);

    return {
      sha256: digest,
      size: totalBytes,
      path: dest,
      deduplicated: false,
    };
  }

  async has(hash: string): Promise<boolean> {
    try {
      const p = this.blobPath(hash);
      const st = await fs.stat(p);
      return st.isFile();
    } catch {
      return false;
    }
  }

  async stat(hash: string): Promise<{ size: number; mtime: Date } | null> {
    try {
      const p = this.blobPath(hash);
      const st = await fs.stat(p);
      return { size: st.size, mtime: st.mtime };
    } catch {
      return null;
    }
  }

  async getBuffer(hash: string): Promise<Buffer | null> {
    try {
      const p = this.blobPath(hash);
      return await fs.readFile(p);
    } catch {
      return null;
    }
  }

  getStream(hash: string): { stream: fsSync.ReadStream; size: number } | null {
    try {
      const p = this.blobPath(hash);
      const st = fsSync.statSync(p);
      const stream = fsSync.createReadStream(p);
      return { stream, size: st.size };
    } catch {
      return null;
    }
  }

  async verify(hash: string): Promise<CasVerifyResult> {
    const clean = hash.trim().toLowerCase();
    try {
      const p = this.blobPath(clean);
      const buf = await fs.readFile(p);
      const actual = sha256(buf);
      return {
        sha256: clean,
        valid: actual === clean,
        size: buf.length,
      };
    } catch {
      return {
        sha256: clean,
        valid: false,
        size: 0,
      };
    }
  }

  async delete(hash: string): Promise<boolean> {
    try {
      const p = this.blobPath(hash);
      await fs.unlink(p);
      return true;
    } catch {
      return false;
    }
  }
}
