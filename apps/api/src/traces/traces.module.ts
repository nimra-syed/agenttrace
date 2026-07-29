import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectTracesController } from './project-traces.controller';
import { SpansController } from './spans.controller';
import { SpansService } from './spans.service';
import { TracesController } from './traces.controller';
import { TracesService } from './traces.service';

@Module({
  imports: [ProjectsModule],
  controllers: [TracesController, SpansController, ProjectTracesController],
  providers: [TracesService, SpansService],
})
export class TracesModule {}
