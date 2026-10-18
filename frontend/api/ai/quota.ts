// GET /api/ai/quota — see api/_lib/ai.ts.
import { quota } from "../_lib/ai.js";
import { guarded } from "../_lib/report.js";

export const GET = guarded("ai/quota", quota);
