import { notFound } from "next/navigation";
import { one } from "@/db";
import { requireCompany } from "@/lib/authz";
import { getFile } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const a = await one<{ storage_key: string; file_name: string; content_type: string }>(
    "select storage_key, file_name, content_type from attachments where company_id = $1 and id = $2",
    [companyId, id],
  );
  if (!a) notFound();
  const data = await getFile(a.storage_key);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": a.content_type,
      "Content-Disposition": `inline; filename="${a.file_name.replace(/["\\\r\n]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
