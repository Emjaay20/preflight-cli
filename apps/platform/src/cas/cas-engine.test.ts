import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { CasEngine } from "./cas-engine";
import { sha256 } from "../crypto";

describe("CasEngine Content-Addressable Storage", () => {
  it("writes blobs into 2-level prefix sharded directories and reads them back", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-cas-test-"));
    const cas = new CasEngine(root);

    const payload = Buffer.from("hello content addressable storage");
    const expectedHash = sha256(payload);

    const result = await cas.write(payload);
    expect(result.sha256).toBe(expectedHash);
    expect(result.size).toBe(payload.length);
    expect(result.deduplicated).toBe(false);

    // Verify 2-level directory sharding: blobs/<ab>/<cd>/<hash>.blob
    const prefix1 = expectedHash.slice(0, 2);
    const prefix2 = expectedHash.slice(2, 4);
    expect(result.path).toBe(path.join(root, "blobs", prefix1, prefix2, `${expectedHash}.blob`));

    // Verify file content matches
    const readBack = await cas.getBuffer(expectedHash);
    expect(readBack).toEqual(payload);

    const has = await cas.has(expectedHash);
    expect(has).toBe(true);

    const stat = await cas.stat(expectedHash);
    expect(stat?.size).toBe(payload.length);
  });

  it("deduplicates identical content without rewriting disk files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-cas-dedup-"));
    const cas = new CasEngine(root);

    const payload = Buffer.from("duplicate me 100 times");
    const write1 = await cas.write(payload);
    expect(write1.deduplicated).toBe(false);

    const write2 = await cas.write(payload);
    expect(write2.deduplicated).toBe(true);
    expect(write2.sha256).toBe(write1.sha256);
    expect(write2.path).toBe(write1.path);
  });

  it("supports stream-based atomic ingestion", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-cas-stream-"));
    const cas = new CasEngine(root);

    const content = "streamed content-addressable blob data";
    const stream = Readable.from([Buffer.from("streamed "), Buffer.from("content-addressable "), Buffer.from("blob data")]);

    const res = await cas.writeStream(stream);
    expect(res.sha256).toBe(sha256(content));
    expect(res.size).toBe(Buffer.byteLength(content));

    const verify = await cas.verify(res.sha256);
    expect(verify.valid).toBe(true);
    expect(verify.size).toBe(Buffer.byteLength(content));
  });

  it("rejects writes with checksum mismatch and cleans up staging files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-cas-mismatch-"));
    const cas = new CasEngine(root);

    const payload = Buffer.from("actual content");
    const fakeHash = "0000000000000000000000000000000000000000000000000000000000000000";

    await expect(cas.write(payload, fakeHash)).rejects.toThrow(/checksum mismatch/);

    const stream = Readable.from([payload]);
    await expect(cas.writeStream(stream, fakeHash)).rejects.toThrow(/checksum mismatch/);

    // Ensure staging directory has no leaked part files
    const stagingFiles = await fs.readdir(path.join(root, "staging")).catch(() => []);
    expect(stagingFiles).toHaveLength(0);
  });

  it("detects disk bit-rot / tampering with verify()", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-cas-verify-"));
    const cas = new CasEngine(root);

    const payload = Buffer.from("genuine bytes");
    const res = await cas.write(payload);

    const okVerify = await cas.verify(res.sha256);
    expect(okVerify.valid).toBe(true);

    // Tamper with file on disk directly
    await fs.writeFile(res.path, Buffer.from("tampered bytes"));

    const badVerify = await cas.verify(res.sha256);
    expect(badVerify.valid).toBe(false);
  });
});
