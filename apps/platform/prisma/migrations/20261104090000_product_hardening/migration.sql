CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'reviewer',
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByWorkosId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");
CREATE INDEX "WorkspaceInvitation_organizationId_status_idx" ON "WorkspaceInvitation"("organizationId", "status");
CREATE INDEX "WorkspaceInvitation_email_status_idx" ON "WorkspaceInvitation"("email", "status");

ALTER TABLE "WorkspaceInvitation"
  ADD CONSTRAINT "WorkspaceInvitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReviewQuotaReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewQuotaReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReviewQuotaReservation_organizationId_month_expiresAt_idx"
  ON "ReviewQuotaReservation"("organizationId", "month", "expiresAt");

ALTER TABLE "ReviewQuotaReservation"
  ADD CONSTRAINT "ReviewQuotaReservation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccessRequest"
  ADD COLUMN IF NOT EXISTS "handledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "handledBy" TEXT,
  ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT;
