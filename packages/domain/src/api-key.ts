import { randomBytes } from "node:crypto";

export const API_KEY_ROLES = ["admin", "reviewer", "ci"] as const;
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

export const ACCOUNT_TYPES = ["organization", "individual"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type MintedApiKey = {
  plaintext: string;
  prefix: string;
  secret: string;
};

const PREFIX_BYTES = 4;
const SECRET_BYTES = 18;

function token(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export function isApiKeyRole(value: unknown): value is ApiKeyRole {
  return typeof value === "string" && (API_KEY_ROLES as readonly string[]).includes(value);
}

export function parseApiKeyRole(value: unknown, fallback: ApiKeyRole = "admin"): ApiKeyRole {
  if (value === undefined || value === null || value === "") return fallback;
  if (!isApiKeyRole(value)) {
    throw new Error(`invalid API key role '${String(value)}' (expected admin, reviewer, or ci)`);
  }
  return value;
}

export function isAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && (ACCOUNT_TYPES as readonly string[]).includes(value);
}

export function parseAccountType(
  value: unknown,
  fallback: AccountType = "organization",
): AccountType {
  if (value === undefined || value === null || value === "") return fallback;
  if (!isAccountType(value)) {
    throw new Error(
      `invalid account type '${String(value)}' (expected organization or individual)`,
    );
  }
  return value;
}

export function canManageOrg(role: ApiKeyRole): boolean {
  return role === "admin";
}

export function canSignOff(role: ApiKeyRole): boolean {
  return role === "admin" || role === "reviewer";
}


export function mintApiKey(): MintedApiKey {
  const prefix = `pf_live_${token(PREFIX_BYTES)}`;
  const secret = token(SECRET_BYTES);
  return {
    plaintext: `${prefix}_${secret}`,
    prefix,
    secret,
  };
}

export function parseApiKey(plaintext: string): { prefix: string; secret: string } {
  if (!plaintext.startsWith("pf_live_")) {
    throw new Error("API key must start with pf_live_");
  }
  const rest = plaintext.slice("pf_live_".length);
  const idx = rest.indexOf("_");
  if (idx <= 0 || idx === rest.length - 1) {
    throw new Error("API key format is pf_live_<prefix>_<secret>");
  }
  return {
    prefix: `pf_live_${rest.slice(0, idx)}`,
    secret: rest.slice(idx + 1),
  };
}
