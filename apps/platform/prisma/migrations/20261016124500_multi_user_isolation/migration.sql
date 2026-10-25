-- Multi-user RBAC role, accountType (organization vs individual), member email, and actor attribution on Review

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "accountType" TEXT NOT NULL DEFAULT 'organization';
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "submittedBy" TEXT;
