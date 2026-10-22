import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { CloseBooksSection, CompanySection, TaxRatesSection, type CompanySettings } from "./settings-client";

export default async function SettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId, "admin");
  const [c, rates] = await Promise.all([
    one<CompanySettings>(
      `select name, legal_name, email, phone, ein, address, fiscal_year_start_month, accounting_method, timezone, close_date,
              close_password_hash is not null as has_close_password from companies where id = $1`,
      [companyId],
    ),
    query<{ id: string; name: string; agency: string; rate_bp: number }>("select id, name, agency, rate_bp from tax_rates where company_id = $1 and active order by name", [companyId]),
  ]);
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-xl font-bold">Settings</h1>
      <CompanySection companyId={companyId} c={c!} />
      <CloseBooksSection companyId={companyId} c={c!} />
      <TaxRatesSection companyId={companyId} rates={rates} />
    </div>
  );
}
