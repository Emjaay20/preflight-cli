CREATE TABLE "WorkosIdentity" (
    "id" TEXT NOT NULL,
    "workosUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkosIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkosIdentity_workosUserId_key" ON "WorkosIdentity"("workosUserId");
CREATE UNIQUE INDEX "WorkosIdentity_apiKeyId_key" ON "WorkosIdentity"("apiKeyId");
CREATE INDEX "WorkosIdentity_organizationId_email_idx" ON "WorkosIdentity"("organizationId", "email");

ALTER TABLE "WorkosIdentity"
  ADD CONSTRAINT "WorkosIdentity_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkosIdentity"
  ADD CONSTRAINT "WorkosIdentity_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
