import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { HealthController } from './health/health.controller';
import { InstallationsModule } from './installations/installations.module';
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
    // throttle (ADR-0016); 'cli-token' is the CLI-connect token-exchange
    // endpoint's abuse-prevention throttle (ADR-0017). Every route
    // guarded by any of these three must explicitly @SkipThrottle() the
    // other two, or it silently also becomes subject to them -- the
    // real bug ADR-0016 documents finding live; applied deliberately
    // everywhere this time.
    ThrottlerModule.forRoot([
      { name: 'auth', ttl: 60000, limit: 5 },
      { name: 'evaluate', ttl: 60000, limit: 10 },
      { name: 'cli-token', ttl: 60000, limit: 20 },
    ]),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    ApiKeysModule,
    TracesModule,
    EvaluationsModule,
    InstallationsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
