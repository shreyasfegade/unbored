// GET /api/ai/health — see api/_lib/ai.ts. Calls no model.
import { health } from "../_lib/ai.js";
import { guarded } from "../_lib/report.js";

export const GET = guarded("ai/health", () => health());
