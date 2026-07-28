// Converts an optional ISO date string to a Date, preserving the
// distinction between "field omitted" (undefined, Prisma leaves the
// column untouched on update) and "field explicitly cleared" (null,
// Prisma writes an actual NULL). See ADR-0008.
export function toDateOrPassthrough(
  value: string | null | undefined,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}
