import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { renderStatementPdf } from "@/lib/pdf/load";
import { companyToday } from "@/lib/queries";
import { loadStatement } from "@/lib/statements";
import { statementParams } from "../params";

export async function GET(req: Request, { params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const url = new URL(req.url);
  const p = statementParams(Object.fromEntries(url.searchParams), await companyToday(companyId));
  const st = await loadStatement(companyId, id, p.kind, p.from, p.to);
  if (!st) notFound();
  const pdf = await renderStatementPdf(companyId, st);
  const name = `Statement-${st.customer.name.replace(/[^A-Za-z0-9]+/g, "-")}-${p.to}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
