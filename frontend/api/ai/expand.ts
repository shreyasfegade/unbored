// POST /api/ai/expand — see api/_lib/ai.ts.
import { expand } from "../_lib/ai";

export const config = { maxDuration: 15 };

export function POST(request: Request): Promise<Response> {
  return expand(request);
}
