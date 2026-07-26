import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ApiKeyContext {
  apiKeyId: string;
  projectId: string;
  orgId: string;
}

export const CurrentApiKeyContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiKeyContext => {
    const request = context.switchToHttp().getRequest<Request>();
    return (request as Request & { apiKeyContext: ApiKeyContext })
      .apiKeyContext;
  },
);
