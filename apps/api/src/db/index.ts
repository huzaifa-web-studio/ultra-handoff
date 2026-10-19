import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./auth-schema";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "";

const client = postgres(connectionString, {
	max: Number(process.env.DB_POOL_MAX ?? 10),
});

const mergedSchema = { ...schema, ...authSchema };

export const db = drizzle(client, { schema: mergedSchema });
export { schema, authSchema };
