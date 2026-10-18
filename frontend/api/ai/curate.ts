// POST /api/ai/curate — see api/_lib/ai.ts.
import { curate } from "../_lib/ai";

export const config = { maxDuration: 15 };

export function POST(request: Request): Promise<Response> {
  return curate(request);
}
