import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("turns an org name into a url slug", () => {
    expect(slugify("Acme Wallet")).toBe("acme-wallet");
    expect(slugify("  Harbor Node  ")).toBe("harbor-node");
  });

  it("rejects empty names", () => {
    expect(() => slugify("***")).toThrow(/name/);
  });

  it("adds a suffix when the base slug is taken", () => {
    const taken = new Set(["acme-wallet"]);
    expect(uniqueSlug("Acme Wallet", taken)).toMatch(/^acme-wallet-[a-z0-9]+$/);
    expect(uniqueSlug("New Co", taken)).toBe("new-co");
  });
});
