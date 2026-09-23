// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEmptyInvoice } from "@/lib/store";
import { makeWorkPackage } from "../testing/fixtures";
import type { ConnectedSessionValue, OverrideNumberResult } from "../session/useConnectedSession";
import type { WorkPackageDTO } from "../types";
import ConnectedNumberField from "./ConnectedNumberField";

// Without an I18nProvider, t() returns the key — assertions use the keys.
function fakeSession(wp: WorkPackageDTO, override?: (n: string) => Promise<OverrideNumberResult>): ConnectedSessionValue {
  return {
    workPackage: wp,
    state: {
      phase: wp.status === "FINALIZED" ? "locked_finalized" : "loaded_editing",
      context: { requiresReview: false, numberReserved: false, permissions: { read: true, edit: true, finalize: true } },
    },
    editor: { invoice: makeEmptyInvoice({ number: wp.invoiceNumber ?? "" }) },
    overrideInFlight: false,
    overrideInvoiceNumber: override ?? vi.fn(),
  } as unknown as ConnectedSessionValue;
}

afterEach(cleanup);

describe("ConnectedNumberField", () => {
  it("shows the pending state while the backend has not assigned a number", () => {
    render(<ConnectedNumberField session={fakeSession(makeWorkPackage())} />);
    expect(screen.getByTestId("connected-number-value").textContent).toBe("connected_number_pending");
    expect(screen.queryByText("connected_number_source_automatic")).toBeNull();
    expect(screen.getByText("connected_number_change")).toBeTruthy();
  });

  it("labels a manual number as Manual", () => {
    render(
      <ConnectedNumberField
        session={fakeSession(makeWorkPackage({ status: "NUMBER_RESERVED", invoiceNumber: "RE-2026-0100", invoiceNumberSource: "MANUAL" }))}
      />
    );
    expect(screen.getByTestId("connected-number-value").textContent).toBe("RE-2026-0100");
    expect(screen.getByText("connected_number_source_manual")).toBeTruthy();
  });

  it.each(["FINALIZED", "SENT", "PAID", "CANCELLED"])("offers no change action once %s", (status) => {
    render(
      <ConnectedNumberField
        session={fakeSession(makeWorkPackage({ status, invoiceNumber: "RE-2026-0042", invoiceNumberSource: "SEQUENCE" }))}
      />
    );
    expect(screen.queryByText("connected_number_change")).toBeNull();
  });

  it("submits the custom number and keeps the form open with an error on conflict", async () => {
    const override = vi.fn(async () => ({ ok: false as const, reason: "conflict" as const, serverMessage: "Invoice number already in use" }));
    render(<ConnectedNumberField session={fakeSession(makeWorkPackage(), override)} />);

    fireEvent.click(screen.getByText("connected_number_change"));
    fireEvent.change(screen.getByLabelText("connected_number_custom"), { target: { value: "RE-2026-0001" } });
    await act(async () => {
      fireEvent.click(screen.getByText("connected_number_override_confirm"));
    });

    expect(override).toHaveBeenCalledWith("RE-2026-0001");
    expect(screen.getByRole("alert").textContent).toContain("connected_number_override_conflict");
    expect(screen.getByRole("alert").textContent).toContain("Invoice number already in use");
    expect(screen.getByLabelText("connected_number_custom")).toBeTruthy();
  });
});
