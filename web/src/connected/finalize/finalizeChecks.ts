// Pure pre-finalization checks and final-amount computation for connected
// mode. Shared by the review dialog (to explain why confirming is blocked) and
// by useConnectedSession.startFinalize (to refuse the flow outright), so the
// UI can never offer a confirmation the orchestrator would then carry out
// with incomplete data.

import {
  centsToDecimal,
  computeLineTax,
  decimalToCents,
  isZeroRatedCategory,
  summarizeTax,
  type TaxSummary,
} from "@/lib/invoiceTax";
import type { ClientInfo, InvoiceData, LineItem } from "@/types/invoice";
import type { ManualLineRecord } from "../document/documentTypes";
import { serverTotalsConsistent } from "../mapping/workPackageDecoder";
import type { WorkPackageDTO } from "../types";

/** Statuses after which the backend refuses any number change (InvoiceNumberingService.IMMUTABLE_NUMBER_STATUSES). */
export const IMMUTABLE_NUMBER_STATUSES = new Set(["FINALIZED", "SENT", "PAID", "CANCELLED"]);

/** Statuses in which the backend still accepts line edits (InvoiceDraftService.OPEN_STATUSES). */
export const OPEN_STATUSES = new Set(["COLLECTING", "READY_FOR_REVIEW", "EDITING"]);

export function isNumberEditable(status: string | undefined | null): boolean {
  return Boolean(status) && !IMMUTABLE_NUMBER_STATUSES.has(status as string);
}

export type FinalizeBlocker =
  | "no_permission"
  | "status_immutable"
  | "requires_review"
  | "recipient_profile_missing"
  | "recipient_name_missing"
  | "recipient_address_missing"
  | "server_totals_inconsistent"
  | "manual_line_tax_missing";

/** Missing mandatory recipient (Rechnungsempfänger) details. Never inspects anything beyond presence. */
export function recipientProblems(client: ClientInfo | undefined): FinalizeBlocker[] {
  const problems: FinalizeBlocker[] = [];
  const name = (client?.name ?? "").trim();
  if (!name || name === "—" || name === "-") problems.push("recipient_name_missing");
  const hasAddress = (client?.addressLines ?? []).some((l) => typeof l === "string" && l.trim() !== "");
  if (!hasAddress) problems.push("recipient_address_missing");
  return problems;
}

/** A zero-VAT manual row must say why (EXEMPT / REVERSE_CHARGE / SMALL_BUSINESS + reason). */
export function manualLineTaxProblem(item: LineItem): boolean {
  const rate = Number(item.vatRate);
  if (Number.isFinite(rate) && rate > 0) return isZeroRatedCategory(item.taxCategory);
  return !isZeroRatedCategory(item.taxCategory) || !(item.taxExemptionReason ?? "").trim();
}

export function finalizeBlockers(args: {
  workPackage: WorkPackageDTO | null;
  invoice: InvoiceData;
  manualLines: ManualLineRecord[];
  canFinalize: boolean;
  requiresReview: boolean;
  hasProfileForBillingRef: boolean;
}): FinalizeBlocker[] {
  const { workPackage, invoice, manualLines } = args;
  const blockers: FinalizeBlocker[] = [];
  if (!args.canFinalize) blockers.push("no_permission");
  if (workPackage && IMMUTABLE_NUMBER_STATUSES.has(workPackage.status)) blockers.push("status_immutable");
  if (args.requiresReview) blockers.push("requires_review");
  if (!args.hasProfileForBillingRef) blockers.push("recipient_profile_missing");
  blockers.push(...recipientProblems(invoice.client));
  if (workPackage && !serverTotalsConsistent(workPackage)) blockers.push("server_totals_inconsistent");
  if (manualLines.some((m) => manualLineTaxProblem(m.item))) blockers.push("manual_line_tax_missing");
  return blockers;
}

export interface FinalAmounts {
  finalNetAmount: string;
  finalVatAmount: string;
  finalGrossAmount: string;
}

/**
 * The backend's totals (source of truth for every server line) plus the
 * locally computed manual rows. Server line amounts are never recomputed.
 */
export function computeFinalAmounts(workPackage: WorkPackageDTO, manualLines: ManualLineRecord[]): FinalAmounts {
  const manual = summarizeTax(manualLines.map((m) => computeLineTax(m.item)));
  const net = (decimalToCents(workPackage.totals.netAmount) ?? 0) + manual.netCents;
  const vat = (decimalToCents(workPackage.totals.vatAmount) ?? 0) + manual.vatCents;
  const gross = (decimalToCents(workPackage.totals.grossAmount) ?? 0) + manual.grossCents;
  return {
    finalNetAmount: centsToDecimal(net),
    finalVatAmount: centsToDecimal(vat),
    finalGrossAmount: centsToDecimal(gross),
  };
}

/** The same summary the PDF template renders for these items. */
export function invoiceTaxSummary(items: LineItem[]): TaxSummary {
  return summarizeTax(items.map((it) => computeLineTax(it)));
}
