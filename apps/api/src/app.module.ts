import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { TracesModule } from './traces/traces.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Every named throttler config in the app lives in this one,
    // central forRoot() call. ThrottlerModule is @Global(); registering
    // forRoot() more than once (once per feature module that wants its
    // own named config) risks one registration silently shadowing
    // another. 'auth' is login/signup rate limiting (ADR-0014);
    // 'evaluate' is the LLM-judge trigger endpoint's cost-containment
    // throttle (ADR-0016).
    ThrottlerModule.forRoot([
      { name: 'auth', ttl: 60000, limit: 5 },
      { name: 'evaluate', ttl: 60000, limit: 10 },
    ]),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    ApiKeysModule,
    TracesModule,
    EvaluationsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
