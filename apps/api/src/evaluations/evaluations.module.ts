import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TracesModule } from '../traces/traces.module';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';
import { EvaluationWorkerClient } from './evaluation-worker.client';

// The 'evaluate' throttler config this module's controller uses is
// registered centrally in AppModule, not here -- see auth.module.ts's
// comment for why importing ThrottlerModule.forRoot() a second time in
// a feature module is unsafe.
@Module({
  imports: [ProjectsModule, TracesModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService, EvaluationWorkerClient],
})
export class EvaluationsModule {}
