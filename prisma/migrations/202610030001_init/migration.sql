-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('QUEUED', 'PLANNING', 'GENERATING', 'STITCHING', 'UPLOADING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GenerationMode" AS ENUM ('DIRECT', 'SCENES');

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "enhancedPrompt" TEXT,
    "mode" "GenerationMode" NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'ltx-2.5',
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "quality" TEXT NOT NULL DEFAULT 'preview',
    "durationSeconds" INTEGER NOT NULL DEFAULT 5,
    "nativeAudio" BOOLEAN NOT NULL DEFAULT true,
    "enhancePrompt" BOOLEAN NOT NULL DEFAULT true,
    "seed" INTEGER,
    "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "statusMessage" TEXT,
    "providerJobId" TEXT,
    "outputUrl" TEXT,
    "thumbnailUrl" TEXT,
    "gpuType" TEXT,
    "gpuSeconds" DOUBLE PRECISION,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 5,
    "seed" INTEGER,
    "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "videoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Generation_createdAt_idx" ON "Generation"("createdAt");

-- CreateIndex
CREATE INDEX "Generation_status_idx" ON "Generation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_generationId_order_key" ON "Scene"("generationId", "order");

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
