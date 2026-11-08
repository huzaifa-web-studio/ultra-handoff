/**
 * Boot time production environment guard.
 *
 * Why a separate module: `src/index.ts` imports it first, so an invalid
 * production environment throws during module evaluation. That happens before
 * `auth.ts` constructs Better Auth and before the Postgres or Redis clients are
 * used, which is what turns a confusing "Invalid URL" into one actionable list.
 *
 * Must stay the first import in `src/index.ts`.
 *
 * Used by: src/index.ts. The rule itself lives in validate-env.ts.
 */

import { assertProductionEnv } from "./validate-env";

assertProductionEnv();
