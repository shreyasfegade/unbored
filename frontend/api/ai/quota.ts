// GET /api/ai/quota — see api/_lib/ai.ts.
import { quota } from "../_lib/ai";

export function GET(request: Request): Promise<Response> {
  return quota(request);
}
