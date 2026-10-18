// POST /api/ai/validate — see api/_lib/ai.ts.
import { validate } from "../_lib/ai";

export const config = { maxDuration: 15 };

export function POST(request: Request): Promise<Response> {
  return validate(request);
}
