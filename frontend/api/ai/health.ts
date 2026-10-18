// GET /api/ai/health — see api/_lib/ai.ts. Calls no model.
import { health } from "../_lib/ai";
import { guarded } from "../_lib/report";

export const GET = guarded("ai/health", () => health());
