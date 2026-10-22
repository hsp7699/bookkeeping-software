import "server-only";
import { one } from "@/db";
import { companyToday } from "@/lib/queries";
import { PRESETS, resolveRange, type Preset } from "./range";
import type { Basis } from "./core";

export interface ReportParams {
  range?: string;
  from?: string;
  to?: string;
  asOf?: string;
  basis?: string;
  columns?: string;
}

const isDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

/** Read report settings from the URL, with the company's defaults. */
export async function readParams(companyId: string, sp: ReportParams, defaultPreset: Preset = "fy_to_date") {
  const [today, company] = await Promise.all([
    companyToday(companyId),
    one<{ name: string; fiscal_year_start_month: number; accounting_method: Basis }>("select name, fiscal_year_start_month, accounting_method from companies where id = $1", [companyId]),
  ]);
  const preset = (PRESETS.find(([k]) => k === sp.range)?.[0] ?? defaultPreset) as Preset;
  let [from, to] = resolveRange(preset, today, company!.fiscal_year_start_month);
  if (preset === "custom") {
    from = isDate(sp.from) ?? from;
    to = isDate(sp.to) ?? to;
  }
  return {
    today,
    companyName: company!.name,
    fyStartMonth: company!.fiscal_year_start_month,
    preset,
    from,
    to,
    asOf: isDate(sp.asOf) ?? today,
    basis: (sp.basis === "cash" || sp.basis === "accrual" ? sp.basis : company!.accounting_method) as Basis,
    byMonth: sp.columns === "months",
  };
}
