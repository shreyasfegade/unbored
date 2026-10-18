// GET /api/ai/quota — see api/_lib/ai.ts.
import { quota } from "../_lib/ai";
import { guarded } from "../_lib/report";

export const GET = guarded("ai/quota", quota);
