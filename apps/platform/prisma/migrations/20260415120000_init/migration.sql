-- Preflight control-plane schema

CREATE TYPE "ReviewStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE "Organization" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ApiKey" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL UNIQUE,
  "hash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3)
);

CREATE TABLE "Project" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId", "slug")
);

CREATE TABLE "Review" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "status" "ReviewStatus" NOT NULL,
  "verdict" TEXT,
  "artifactName" TEXT NOT NULL,
  "artifactSha256" TEXT NOT NULL,
  "artifactPath" TEXT NOT NULL,
  "claims" JSONB,
  "packs" TEXT[] NOT NULL,
  "inventory" JSONB,
  "report" JSONB,
  "markdown" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3)
);

CREATE TABLE "Finding" (
  "id" TEXT PRIMARY KEY,
  "reviewId" TEXT NOT NULL REFERENCES "Review"("id") ON DELETE CASCADE,
  "findingKey" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "pack" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "file" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "line" INTEGER NOT NULL,
  "snippet" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL
);

CREATE TABLE "OutboxEvent" (
  "id" TEXT PRIMARY KEY,
  "reviewId" TEXT REFERENCES "Review"("id") ON DELETE SET NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3)
);

CREATE INDEX "Finding_reviewId_idx" ON "Finding"("reviewId");
CREATE INDEX "OutboxEvent_publishedAt_idx" ON "OutboxEvent"("publishedAt");
CREATE INDEX "Review_projectId_idx" ON "Review"("projectId");
