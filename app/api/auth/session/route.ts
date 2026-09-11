import { handleApi } from "@/lib/api";
import { getSessionFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await getSessionFromRequest(req);
    return { session };
  });
}
