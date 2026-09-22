import React from "react";
import { useT } from "@/lib/i18n";

export default function UnsupportedBrowserNotice() {
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
      <h3 style={{ marginTop: 0 }}>{t("connected_unsupported_browser_title") || "Browser not supported"}</h3>
      <p>
        {t("connected_unsupported_browser_body") ||
          "Connected invoice editing needs Web Crypto and IndexedDB, which this browser does not provide (or a private/incognito mode is blocking them). Please open this link in an up-to-date browser."}
      </p>
    </div>
  );
}
