import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('projects/:projectId/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(user.orgId, projectId, dto.name);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.apiKeysService.findAllForProject(user.orgId, projectId);
  }

  @Delete(':keyId')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('keyId') keyId: string,
  ) {
    return this.apiKeysService.revoke(user.orgId, projectId, keyId);
  }
}
