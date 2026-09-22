import React from "react";
import { useT } from "@/lib/i18n";
import type { VaultImportCandidate } from "../vault/vaultImport";

export default function VaultImportPrompt({
  candidate,
  onImport,
  onDismiss,
}: {
  candidate: VaultImportCandidate;
  onImport: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div
      style={{
        marginTop: 8,
        padding: "10px 12px",
        borderRadius: 12,
        background: "#eff6ff",
        border: "1px solid #93c5fd",
        fontSize: 13,
      }}
    >
      <div>
        {t("connected_vault_import_prompt", { template: candidate.templateName }) ||
          `Import company/client details from your default template ("${candidate.templateName}") for this project?`}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button type="button" onClick={onImport}>
          {t("connected_vault_import_confirm") || "Import"}
        </button>
        <button type="button" onClick={onDismiss}>
          {t("connected_vault_import_dismiss") || "Not now"}
        </button>
      </div>
    </div>
  );
}
