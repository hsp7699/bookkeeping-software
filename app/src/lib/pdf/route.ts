import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { loadPdfDoc, renderSalesPdf } from "./load";

/** GET handler for /<form>/<id>/pdf. Opens inline; ?download=1 saves it. */
export function salesPdfRoute(type: string) {
  return async function GET(req: Request, { params }: { params: Promise<{ companyId: string; id: string }> }) {
    const { companyId, id } = await params;
    await requireCompany(companyId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const doc = await loadPdfDoc(companyId, id, type);
    if (!doc) notFound();
    const pdf = await renderSalesPdf(doc);
    const name = `${doc.title.replace(/\s+/g, "-")}-${doc.number ?? id.slice(0, 8)}.pdf`;
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  };
}
