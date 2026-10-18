// GET /api/poster?src=<catalog poster URL> — see api/_lib/poster.ts.
import { poster } from "./_lib/poster";
import { guarded } from "./_lib/report";

export const GET = guarded("poster", poster);
