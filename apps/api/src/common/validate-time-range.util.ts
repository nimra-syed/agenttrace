import { BadRequestException } from '@nestjs/common';

export function assertValidTimeRange(
  startedAt: Date,
  endedAt: Date | null | undefined,
): void {
  if (endedAt && endedAt.getTime() < startedAt.getTime()) {
    throw new BadRequestException('endedAt must not be before startedAt');
  }
}
