// Static guard: the connected finalize path must never be able to generate an
// invoice number locally. server/lib/seq.ts's nextNumber() is only ever called
// from pages/api/renderAll.ts (the "render all languages as ZIP" endpoint) —
// so as long as the connected session orchestrator never imports/calls
// renderAllBlob or nextNumber, local numbering is structurally unreachable
// from this path, not just avoided by convention.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("connected mode never generates an invoice number locally", () => {
  it("useConnectedSession.ts never references renderAllBlob or seq.ts's nextNumber", () => {
    const src = readFileSync(path.resolve(__dirname, "useConnectedSession.ts"), "utf-8");
    expect(src).not.toMatch(/renderAllBlob/);
    expect(src).not.toMatch(/nextNumber/);
    expect(src).not.toMatch(/from ["']@?\/?server\/lib\/seq["']/);
  });

  it("no file under src/connected imports server/lib/seq.ts or renderAllBlob", () => {
    const connectedDir = path.resolve(__dirname, "..");
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const contents = readFileSync(full, "utf-8");
          if (/renderAllBlob|nextNumber/.test(contents)) {
            offenders.push(full);
          }
        }
      }
    }

    walk(connectedDir);
    expect(offenders).toEqual([]);
  });
});
