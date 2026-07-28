import { Prisma } from '../../generated/prisma/client.js';

// Prisma's nullable JSON columns distinguish an actual SQL NULL from the
// JSON literal `null` stored as content, so a plain JS `null` is not
// enough on its own. Prisma.DbNull is what we want here: the client sent
// an explicit null, meaning "clear this column," not "store JSON null."
export function toJsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value;
}
