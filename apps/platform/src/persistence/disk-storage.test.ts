import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { DiskArtifactStorage } from "./disk-storage";

describe("DiskArtifactStorage tenant isolation", () => {
  it("partitions identical filenames across tenants and projects without collision", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-storage-"));
    const storage = new DiskArtifactStorage(root);

    const a = await storage.save({
      organizationId: "org_alpha",
      projectId: "proj_ext",
      originalname: "extension.zip",
      buffer: Buffer.from("alpha-bytes"),
    });
    const b = await storage.save({
      organizationId: "org_beta",
      projectId: "proj_ext",
      originalname: "extension.zip",
      buffer: Buffer.from("beta-bytes"),
    });

    expect(a.path).not.toBe(b.path);
    expect(a.path).toContain(path.join("tenants", "org_alpha", "projects", "proj_ext"));
    expect(b.path).toContain(path.join("tenants", "org_beta", "projects", "proj_ext"));
    expect(a.sha256).not.toBe(b.sha256);
    expect(await fs.readFile(a.path, "utf8")).toBe("alpha-bytes");
    expect(await fs.readFile(b.path, "utf8")).toBe("beta-bytes");
  });

  it("neutralizes path traversal attempts in organization, project, and artifact names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-traversal-"));
    const storage = new DiskArtifactStorage(root);

    const saved = await storage.save({
      organizationId: "../../etc",
      projectId: "../passwd",
      originalname: "../../escape.zip",
      buffer: Buffer.from("confined"),
    });

    expect(saved.path.startsWith(root + path.sep)).toBe(true);
    expect(path.basename(saved.path)).toBe("escape.zip");
  });
});
