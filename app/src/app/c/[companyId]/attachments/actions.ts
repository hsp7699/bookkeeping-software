"use server";

import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { removeFile } from "@/lib/storage";

export async function listAttachmentsAction(companyId: string, txnId: string) {
  await requireCompany(companyId);
  return query<{ id: string; file_name: string; size_bytes: number }>(
    "select id, file_name, size_bytes from attachments where company_id = $1 and transaction_id = $2 order by created_at",
    [companyId, txnId],
  );
}

export async function deleteAttachmentAction(companyId: string, id: string) {
  const ctx = await requireCompany(companyId, "standard");
  const a = await one<{ storage_key: string; file_name: string }>("delete from attachments where company_id = $1 and id = $2 returning storage_key, file_name", [companyId, id]);
  if (a) {
    await removeFile(a.storage_key);
    await query("insert into audit_events (company_id, user_id, entity, entity_id, action, before) values ($1, $2, 'attachment', $3, 'delete', $4)", [
      companyId,
      ctx.userId,
      id,
      JSON.stringify({ name: a.file_name }),
    ]);
  }
}
