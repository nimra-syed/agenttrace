import { BadRequestException } from '@nestjs/common';

// Keyset (cursor) pagination, not OFFSET: it stays fast regardless of
// table size, and stays stable while new rows are inserted between page
// loads, which OFFSET does not. The cursor encodes (startedAt, id) of
// the last row on the current page, both fields, since startedAt alone
// is not a deterministic sort key: multiple traces can share the exact
// same timestamp, and without a tiebreaker, ties could be returned in a
// different order across requests, silently skipping or duplicating
// rows. id (a UUID) doesn't need to be meaningfully ordered, just stable
// and unique, which is all a tiebreaker needs. See ADR-0011.
interface DecodedCursor {
  startedAt: Date;
  id: string;
}

export function encodeCursor(startedAt: Date, id: string): string {
  const payload = JSON.stringify({ startedAt: startedAt.toISOString(), id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { startedAt?: unknown; id?: unknown };

    if (
      typeof decoded.startedAt !== 'string' ||
      typeof decoded.id !== 'string'
    ) {
      throw new Error('malformed cursor payload');
    }

    const startedAt = new Date(decoded.startedAt);
    if (Number.isNaN(startedAt.getTime())) {
      throw new Error('malformed cursor timestamp');
    }

    return { startedAt, id: decoded.id };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
