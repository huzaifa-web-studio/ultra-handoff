import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseEnv } from "../lib/env";
import * as authSchema from "./auth-schema";
import * as schema from "./schema";

const client = postgres(databaseEnv.url, {
	max: databaseEnv.poolMax,
});

const mergedSchema = { ...schema, ...authSchema };

export const db = drizzle(client, { schema: mergedSchema });
export { schema, authSchema };
