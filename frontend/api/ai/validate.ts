// POST /api/ai/validate — see api/_lib/ai.ts.
import { validate } from "../_lib/ai.js";
import { guarded } from "../_lib/report.js";

export const config = { maxDuration: 15 };

export const POST = guarded("ai/validate", validate);
