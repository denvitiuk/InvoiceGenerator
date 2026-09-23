import React from "react";
import { useT } from "@/lib/i18n";
import type { ConnectedSessionValue } from "../session/useConnectedSession";

/**
 * Shown while the encrypted vault has no recipient profile for this invoice's
 * billingProfileRef. Offers to start one (prefilled with the backend's safe
 * customer name) or to import the standalone default template — never falls
 * back to another customer's profile on its own.
 */
export default function RecipientProfilePrompt({ session }: { session: ConnectedSessionValue }) {
  const t = useT();
  const customer = session.workPackage?.customer;
  const name = customer?.displayName || t("connected_customer_unknown");

  return (
    <div className="connected-callout connected-callout--info" role="status">
      <div>
        {t("connected_recipient_profile_missing", { customer: name })}
        {customer?.customerNumber ? ` (${t("connected_customer_number")} ${customer.customerNumber})` : ""}
      </div>
      <div className="connected-dialog__actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" data-variant="primary" onClick={() => void session.createRecipientProfile()}>
          {t("connected_recipient_profile_create")}
        </button>
        {session.vaultImportCandidate && (
          <button type="button" onClick={session.importVaultFromTemplate}>
            {t("connected_recipient_profile_import", { template: session.vaultImportCandidate.templateName })}
          </button>
        )}
      </div>
    </div>
  );
}
