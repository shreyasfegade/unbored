// POST /api/ai/expand — see api/_lib/ai.ts.
import { expand } from "../_lib/ai";
import { guarded } from "../_lib/report";

export const config = { maxDuration: 15 };

export const POST = guarded("ai/expand", expand);
