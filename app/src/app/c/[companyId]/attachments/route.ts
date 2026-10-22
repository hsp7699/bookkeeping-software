import { NextResponse } from "next/server";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { ALLOWED, MAX_BYTES, putFile } from "@/lib/storage";

// Upload: multipart form with `file` and optional `txnId`.
export async function POST(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "standard");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "Files can be up to 25 MB." }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "Upload a PDF, image, CSV or bank file." }, { status: 400 });
  const txnId = String(form?.get("txnId") ?? "") || null;
  if (txnId) {
    const t = await one("select 1 from transactions where company_id = $1 and id = $2", [companyId, txnId]);
    if (!t) return NextResponse.json({ error: "That transaction no longer exists." }, { status: 404 });
  }
  const key = await putFile(companyId, ext, Buffer.from(await file.arrayBuffer()));
  const row = await one<{ id: string }>(
    `insert into attachments (company_id, transaction_id, storage_key, file_name, content_type, size_bytes, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [companyId, txnId, key, file.name.slice(0, 200), file.type, file.size, ctx.userId],
  );
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'attachment', $3, 'create', $4)", [
    companyId,
    ctx.userId,
    row!.id,
    JSON.stringify({ name: file.name, txnId }),
  ]);
  return NextResponse.json({ id: row!.id, name: file.name, size: file.size });
}
