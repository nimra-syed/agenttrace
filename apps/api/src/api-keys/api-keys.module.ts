import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApiKeyAuthController } from './api-key-auth.controller';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

@Module({
  imports: [ProjectsModule],
  controllers: [ApiKeysController, ApiKeyAuthController],
  providers: [ApiKeysService, ApiKeyGuard],
})
export class ApiKeysModule {}
