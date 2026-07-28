import { Module } from '@nestjs/common';
import { SpansController } from './spans.controller';
import { SpansService } from './spans.service';
import { TracesController } from './traces.controller';
import { TracesService } from './traces.service';

@Module({
  controllers: [TracesController, SpansController],
  providers: [TracesService, SpansService],
})
export class TracesModule {}
