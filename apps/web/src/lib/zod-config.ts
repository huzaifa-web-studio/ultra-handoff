/**
 * Zod configuration for the browser bundle.
 *
 * Why: Zod 4 probes `new Function` at its first parse to decide whether it can
 * JIT compile validators. The production Content-Security-Policy blocks that
 * probe, and the browser reports it as a `securitypolicyviolation` console
 * issue even though Zod catches the throw and falls back to the runtime parser.
 * `jitless` is Zod's own switch for this case: it skips the probe entirely and
 * always uses the runtime parser, so the console stays clean.
 *
 * Loaded as a side effect from `src/router.tsx`, before any form validates.
 *
 * Used by: src/router.tsx.
 */

import { z } from "zod";

z.config({ jitless: true });
