-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "judgeModel" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "evaluationInput" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvalResult_traceId_idx" ON "EvalResult"("traceId");

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "Trace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
