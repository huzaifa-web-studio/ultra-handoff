/**
 * Combined Drizzle schema (domain tables + auth tables).
 *
 * Why: both database clients (privileged and tenant-scoped) must register the
 * exact same schema, otherwise relational queries and type inference drift
 * between them. Keeping the merge here also avoids importing the privileged
 * client just to read the schema.
 *
 * Used by: src/db/index.ts, src/db/tenant.ts.
 */

import * as authSchema from "./auth-schema";
import * as schema from "./schema";

export const dbSchema = { ...schema, ...authSchema };

export type DbSchema = typeof dbSchema;

export { authSchema, schema };
