ALTER TYPE "GenerationStatus" ADD VALUE IF NOT EXISTS 'ANALYZING';
ALTER TYPE "GenerationStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED';
ALTER TYPE "GenerationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "VideoVersionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "Generation"
  ADD COLUMN "clientRequestId" TEXT,
  ADD COLUMN "analysis" JSONB,
  ADD COLUMN "qcReport" JSONB;

ALTER TABLE "Scene" ADD COLUMN "metadata" JSONB;

CREATE UNIQUE INDEX "Generation_clientRequestId_key" ON "Generation"("clientRequestId");

CREATE TABLE "VideoVersion" (
  "id" TEXT NOT NULL,
  "generationId" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Edited version',
  "status" "VideoVersionStatus" NOT NULL DEFAULT 'QUEUED',
  "providerJobId" TEXT,
  "outputUrl" TEXT,
  "thumbnailUrl" TEXT,
  "operations" JSONB NOT NULL,
  "qcReport" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VideoVersion_generationId_createdAt_idx" ON "VideoVersion"("generationId", "createdAt");
CREATE INDEX "VideoVersion_status_idx" ON "VideoVersion"("status");

CREATE TABLE "RenderAttempt" (
  "id" TEXT NOT NULL,
  "generationId" TEXT NOT NULL,
  "providerJobId" TEXT,
  "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "RenderAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RenderAttempt_generationId_startedAt_idx" ON "RenderAttempt"("generationId", "startedAt");

ALTER TABLE "VideoVersion"
  ADD CONSTRAINT "VideoVersion_generationId_fkey"
  FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RenderAttempt"
  ADD CONSTRAINT "RenderAttempt_generationId_fkey"
  FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
