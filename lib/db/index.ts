import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing env var DATABASE_URL");
  return drizzle(neon(url), { schema });
}

let instance: ReturnType<typeof createDb> | null = null;

/** Lazily created so a missing DATABASE_URL fails the caller, not every import. */
export function getDb() {
  instance ??= createDb();
  return instance;
}

export { schema };
