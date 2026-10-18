// POST /api/ai/curate — see api/_lib/ai.ts.
import { curate } from "../_lib/ai.js";
import { guarded } from "../_lib/report.js";

export const config = { maxDuration: 15 };

export const POST = guarded("ai/curate", curate);
