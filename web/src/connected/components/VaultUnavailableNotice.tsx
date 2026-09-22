import React from "react";
import { useT } from "@/lib/i18n";

export default function VaultUnavailableNotice({ onCreateNewProfile }: { onCreateNewProfile: () => void }) {
  const t = useT();
  return (
    <div
      style={{
        margin: 16,
        padding: 16,
        borderRadius: 14,
        background: "#fef2f2",
        border: "1px solid #fca5a5",
        color: "#7f1d1d",
        maxWidth: 560,
      }}
    >
      <h3 style={{ marginTop: 0 }}>{t("connected_vault_unavailable_title") || "Encrypted profile unavailable on this device"}</h3>
      <p>
        {t("connected_vault_unavailable_body") ||
          "This project already has an encrypted company/client profile, but it was created on a different device or browser and cannot be decrypted here. There is no cross-device key recovery — you can create a new local profile to continue, which will replace the saved one."}
      </p>
      <button type="button" onClick={onCreateNewProfile}>
        {t("connected_vault_create_new_profile") || "Create a new local profile"}
      </button>
    </div>
  );
}
