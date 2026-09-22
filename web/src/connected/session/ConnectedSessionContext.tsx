"use client";

import React, { createContext, useContext } from "react";
import { useConnectedSession, type ConnectedSessionValue } from "./useConnectedSession";

const ConnectedSessionContext = createContext<ConnectedSessionValue | null>(null);

export function ConnectedSessionProvider({
  token,
  children,
}: {
  /** A fresh one-shot token from the URL fragment, or null when restoring an
   * already-exchanged session found in sessionStorage after a reload. */
  token: string | null;
  children: React.ReactNode;
}) {
  const value = useConnectedSession(token);
  return <ConnectedSessionContext.Provider value={value}>{children}</ConnectedSessionContext.Provider>;
}

/** Returns null in standalone mode (no provider mounted) — the seam AppShell checks to branch. */
export function useConnectedSessionOptional(): ConnectedSessionValue | null {
  return useContext(ConnectedSessionContext);
}
