/*
  Warnings:

  - You are about to drop the column `idempotencyKey` on the `Trace` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[traceId,externalSpanId]` on the table `Span` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[projectId,externalTraceId]` on the table `Trace` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Trace_projectId_idempotencyKey_key";

-- AlterTable
ALTER TABLE "Span" ADD COLUMN     "externalSpanId" TEXT;

-- AlterTable
ALTER TABLE "Trace" DROP COLUMN "idempotencyKey",
ADD COLUMN     "externalTraceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Span_traceId_externalSpanId_key" ON "Span"("traceId", "externalSpanId");

-- CreateIndex
CREATE UNIQUE INDEX "Trace_projectId_externalTraceId_key" ON "Trace"("projectId", "externalTraceId");
