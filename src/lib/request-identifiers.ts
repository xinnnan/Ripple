import { z } from "zod";

export const UUID_ROUTE_ID_SCHEMA = z.string().uuid();

export function parseUuidRouteId(value: string): string | null {
  const parsed = UUID_ROUTE_ID_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}
