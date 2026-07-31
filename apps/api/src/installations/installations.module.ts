import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { CliAuthController } from './cli-auth.controller';
import { InstallationsController } from './installations.controller';
import { InstallationsService } from './installations.service';

// The 'cli-token' throttler config CliAuthController's token route uses
// is registered centrally in AppModule, not here -- same reasoning as
// evaluations.module.ts's comment (ThrottlerModule is @Global(), a
// second forRoot() call risks one registration silently shadowing
// another).
@Module({
  imports: [ProjectsModule],
  controllers: [InstallationsController, CliAuthController],
  providers: [InstallationsService],
})
export class InstallationsModule {}
