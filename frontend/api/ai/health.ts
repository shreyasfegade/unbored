// GET /api/ai/health — see api/_lib/ai.ts. Calls no model.
import { health } from "../_lib/ai";

export function GET(): Promise<Response> {
  return health();
}
