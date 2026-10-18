// GET /api/poster?src=<catalog poster URL> — see api/_lib/poster.ts.
import { poster } from "./_lib/poster.js";
import { guarded } from "./_lib/report.js";

export const GET = guarded("poster", poster);
