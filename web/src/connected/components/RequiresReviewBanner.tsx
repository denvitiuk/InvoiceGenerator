import React from "react";
import { useT } from "@/lib/i18n";
import type { WorkPackageDTO } from "../types";

export default function RequiresReviewBanner({ workPackage }: { workPackage: WorkPackageDTO | null }) {
  const t = useT();
  if (!workPackage) return null;

  const reviewLines = workPackage.lines.filter((l) => l.requiresReview && !l.isExcluded);
  if (!workPackage.requiresReview && reviewLines.length === 0) return null;

  return (
    <div
      role="alert"
      style={{
        marginTop: 8,
        padding: "10px 12px",
        borderRadius: 12,
        background: "#fff7ed",
        border: "1px solid #fdba74",
        color: "#9a3412",
        fontSize: 13,
      }}
    >
      <strong>{t("connected_requires_review_title") || "Requires review before finalizing"}</strong>
      {reviewLines.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {reviewLines.map((l) => (
            <li key={l.invoiceWorkItemId}>
              {l.workDate ? `${l.workDate} — ` : ""}
              {l.description || l.workType || l.invoiceWorkItemId}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
