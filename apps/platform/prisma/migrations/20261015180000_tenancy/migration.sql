-- Product: tenancy fields for claims + human sign-off

ALTER TABLE "Project" ADD COLUMN "defaultClaims" JSONB;
ALTER TABLE "Review" ADD COLUMN "signedOffAt" TIMESTAMP(3);
ALTER TABLE "Review" ADD COLUMN "signedOffBy" TEXT;
ALTER TABLE "Review" ADD COLUMN "signOffDecision" TEXT;
ALTER TABLE "Review" ADD COLUMN "signOffNotes" TEXT;
