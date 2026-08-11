import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __campaignGraphPool?: Pool;
};

export const pool =
  globalForDb.__campaignGraphPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 20,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__campaignGraphPool = pool;
}

export const db = drizzle(pool);
