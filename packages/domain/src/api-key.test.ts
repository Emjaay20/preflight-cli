import { describe, expect, it } from "vitest";
import { canManageOrg, canSignOff, mintApiKey, parseApiKey, parseApiKeyRole } from "./api-key";

describe("api keys", () => {
  it("mints a pf_live_ key with a public prefix and a secret", () => {
    const key = mintApiKey();
    expect(key.plaintext.startsWith("pf_live_")).toBe(true);
    expect(key.prefix.startsWith("pf_live_")).toBe(true);
    expect(key.plaintext).toContain(key.prefix);
    expect(key.secret.length).toBeGreaterThanOrEqual(24);
    expect(key.plaintext).toBe(`${key.prefix}_${key.secret}`);
  });

  it("parses a minted key back into prefix and secret", () => {
    const key = mintApiKey();
    const parsed = parseApiKey(key.plaintext);
    expect(parsed).toEqual({ prefix: key.prefix, secret: key.secret });
  });

  it("rejects malformed keys", () => {
    expect(() => parseApiKey("sk_live_nope")).toThrow(/pf_live_/);
    expect(() => parseApiKey("pf_live_short")).toThrow(/format/);
  });

  it("validates roles and enforces least-privilege permissions", () => {
    expect(parseApiKeyRole(undefined)).toBe("admin");
    expect(parseApiKeyRole("reviewer")).toBe("reviewer");
    expect(parseApiKeyRole("ci")).toBe("ci");
    expect(() => parseApiKeyRole("superuser")).toThrow(/invalid API key role/);

    expect(canManageOrg("admin")).toBe(true);
    expect(canManageOrg("reviewer")).toBe(false);
    expect(canManageOrg("ci")).toBe(false);

    expect(canSignOff("admin")).toBe(true);
    expect(canSignOff("reviewer")).toBe(true);
    expect(canSignOff("ci")).toBe(false);
  });
});
