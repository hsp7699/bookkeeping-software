import { redirect } from "next/navigation";
import { one } from "@/db";
import { requireUser } from "@/lib/authz";

// Sends the user to their (first) company, or to setup if they have none.
export default async function Root() {
  const userId = await requireUser();
  const m = await one<{ company_id: string }>(
    "select company_id from memberships where user_id = $1 and status = 'active' order by created_at limit 1",
    [userId],
  );
  redirect(m ? `/c/${m.company_id}` : "/setup");
}
