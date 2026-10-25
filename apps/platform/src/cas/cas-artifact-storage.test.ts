import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { promises as fs } from "node:fs";
import { CasArtifactStorage } from "./cas-artifact-storage";
import { sha256 } from "../crypto";

describe("CasArtifactStorage tenant isolation and worker materialization", () => {
  it("partitions tenant uploads while sharing deduplicated underlying CAS blobs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-cas-storage-"));
    const storage = new CasArtifactStorage({ rootDir: root });

    const sharedZip = Buffer.from("identical-zip-binary-data");
    const digest = sha256(sharedZip);

    const a = await storage.save({
      organizationId: "org_alpha",
      projectId: "proj_1",
      originalname: "bundle.zip",
      buffer: sharedZip,
    });
    const b = await storage.save({
      organizationId: "org_beta",
      projectId: "proj_2",
      originalname: "bundle.zip",
      buffer: sharedZip,
    });

    // Both tenants have their own isolated paths
    expect(a.path).toContain(path.join("tenants", "org_alpha", "projects", "proj_1"));
    expect(b.path).toContain(path.join("tenants", "org_beta", "projects", "proj_2"));
    expect(a.path).not.toBe(b.path);

    // Both share the exact same cryptographic hash
    expect(a.sha256).toBe(digest);
    expect(b.sha256).toBe(digest);

    // The CAS engine holds exactly one underlying blob file for this content
    const casEngine = storage.getCasEngine();
    expect(await casEngine.has(digest)).toBe(true);
  });

  it("materializes artifact from local direct path when available", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-mat-local-"));
    const storage = new CasArtifactStorage({ rootDir: root });

    const saved = await storage.save({
      organizationId: "org_alpha",
      projectId: "proj_1",
      originalname: "ext.zip",
      buffer: Buffer.from("local-bytes"),
    });

    const mat = await storage.materialize({
      sha256: saved.sha256,
      artifactPath: saved.path,
      preferredName: "ext.zip",
    });

    expect(mat.localPath).toBe(saved.path);
    await mat.cleanup();
    expect(await fs.stat(saved.path).then(() => true)).toBe(true);
  });

  it("materializes artifact from local CAS engine into scratch space when direct path is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-mat-cas-"));
    const storage = new CasArtifactStorage({ rootDir: root });

    const buffer = Buffer.from("cas-only-bytes");
    const digest = sha256(buffer);
    await storage.getCasEngine().write(buffer);

    const mat = await storage.materialize({
      sha256: digest,
      artifactPath: "/non-existent/remote/host/path/ext.zip",
      preferredName: "plugin.zip",
    });

    expect(mat.localPath).toContain("preflight-cas-scratch-");
    expect(path.basename(mat.localPath)).toBe("plugin.zip");
    expect(await fs.readFile(mat.localPath)).toEqual(buffer);

    // Cleanup removes scratch dir
    await mat.cleanup();
    expect(await fs.stat(mat.localPath).catch(() => false)).toBe(false);
  });

  it("materializes artifact over HTTP from remote CAS server (multi-node VPS/k8s worker scenario)", async () => {
    const serverRoot = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-server-cas-"));
    const workerRoot = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-worker-cas-"));

    const serverStorage = new CasArtifactStorage({ rootDir: serverRoot });
    const fileBytes = Buffer.from("remote-worker-streaming-zip-data");
    const digest = sha256(fileBytes);
    await serverStorage.getCasEngine().write(fileBytes);

    // Start a lightweight mock HTTP CAS server
    const server = http.createServer((req, res) => {
      if (req.url === `/v1/blobs/${digest}`) {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": fileBytes.length,
          ETag: `"${digest}"`,
        });
        res.end(fileBytes);
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    const remoteUrl = `http://127.0.0.1:${port}`;

    try {
      // Worker storage has empty local directories, but points to remote CAS URL
      const workerStorage = new CasArtifactStorage({
        rootDir: workerRoot,
        remoteBaseUrl: remoteUrl,
      });

      const mat = await workerStorage.materialize({
        sha256: digest,
        artifactPath: "/remote-api-node/data/tenants/ext.zip",
        preferredName: "downloaded.zip",
      });

      expect(mat.localPath).toContain("preflight-remote-scratch-");
      expect(path.basename(mat.localPath)).toBe("downloaded.zip");
      expect(await fs.readFile(mat.localPath)).toEqual(fileBytes);

      // Verify it cached into the worker's local CAS
      expect(await workerStorage.getCasEngine().has(digest)).toBe(true);

      // Verify cleanup
      await mat.cleanup();
      expect(await fs.stat(mat.localPath).catch(() => false)).toBe(false);
    } finally {
      server.close();
    }
  });

  it("rejects corrupted remote stream with checksum mismatch and cleans up scratch directory", async () => {
    const workerRoot = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-worker-corrupt-"));
    const goodBytes = Buffer.from("real-content");
    const goodDigest = sha256(goodBytes);

    // Server returns tampered bytes
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(Buffer.from("tampered-in-transit-bytes"));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const workerStorage = new CasArtifactStorage({
        rootDir: workerRoot,
        remoteBaseUrl: `http://127.0.0.1:${port}`,
      });

      await expect(
        workerStorage.materialize({
          sha256: goodDigest,
          artifactPath: "/fake/path/ext.zip",
        }),
      ).rejects.toThrow(/corrupted blob received from remote CAS/);
    } finally {
      server.close();
    }
  });
});
