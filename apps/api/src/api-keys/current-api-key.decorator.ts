import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// ApiKeyGuard authenticates two credential types (ApiKey and
// Installation, ADR-0017), sharing this one context shape: exactly one
// of apiKeyId/installationId is set, depending on which table matched.
// Every existing consumer only ever read projectId/orgId, so widening
// these two fields to optional doesn't change any existing call site's
// behavior.
export interface ApiKeyContext {
  apiKeyId?: string;
  installationId?: string;
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
