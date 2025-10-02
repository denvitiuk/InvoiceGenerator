import * as fs from "node:fs/promises";
import * as path from "node:path";

export type Scope = "year" | "month" | "day";
export interface SeqOptions {
    /** JSON file to store counters. Default: .seq.json (project root) */
    file?: string;
    /** Counter scope for reset (year/month/day). Default: month */
    scope?: Scope;
    /** Zero-padding for the sequence, e.g., 4 -> 0001 */
    pad?: number;
    /** Optional prefix to prepend before the date segment */
    prefix?: string;
    /** Custom date (for testing or back-dated invoices) */
    date?: Date;
}

const DEFAULT_FILE = ".seq.json";
const DEFAULT_SCOPE: Scope = "month";
const DEFAULT_PAD = 4;

export function keyForDate(date: Date, scope: Scope): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    if (scope === "year") return `${y}`;
    if (scope === "day") return `${y}-${m}-${d}`;
    return `${y}-${m}`; // month (default)
}

async function readState(file: string): Promise<Record<string, number>> {
    try {
        const raw = await fs.readFile(file, "utf-8");
        return JSON.parse(raw) as Record<string, number>;
    } catch {
        return {};
    }
}

async function writeState(file: string, state: Record<string, number>): Promise<void> {
    await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true }).catch(() => {});
    await fs.writeFile(file, JSON.stringify(state, null, 2), "utf-8");
}

async function delay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
}

/** Minimal file lock using an atomic create of a .lock file. */
async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
    const lock = `${file}.lock`;
    for (let i = 0; i < 50; i++) {
        try {
            const handle: any = await (fs as any).open(lock, "wx");
            try {
                const result = await fn();
                await handle.close();
                await fs.unlink(lock).catch(() => {});
                return result;
            } catch (e) {
                await handle.close();
                await fs.unlink(lock).catch(() => {});
                throw e;
            }
        } catch {
            await delay(20);
        }
    }
    // Fallback if lock contention persists
    return fn();
}

export function formatNumber(value: number, opts: SeqOptions = {}): string {
    const date = opts.date ?? new Date();
    const scope: Scope = opts.scope ?? DEFAULT_SCOPE;
    const pad = opts.pad ?? DEFAULT_PAD;
    const prefix = opts.prefix ?? "";

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const seq = String(value).padStart(pad, "0");

    const seg = scope === "year" ? `${y}` : scope === "day" ? `${y}-${m}-${d}` : `${y}-${m}`;
    return `${prefix}${seg}-${seq}`;
}

export async function nextNumber(opts: SeqOptions = {}) {
    const file = opts.file ?? DEFAULT_FILE;
    const scope: Scope = opts.scope ?? DEFAULT_SCOPE;
    const date = opts.date ?? new Date();
    const key = keyForDate(date, scope);

    return withLock(file, async () => {
        const state = await readState(file);
        const current = state[key] ?? 0;
        const value = current + 1;
        state[key] = value;
        await writeState(file, state);
        return { number: formatNumber(value, { ...opts, date }), value, key, file };
    });
}

export async function peek(opts: SeqOptions = {}) {
    const file = opts.file ?? DEFAULT_FILE;
    const scope: Scope = opts.scope ?? DEFAULT_SCOPE;
    const date = opts.date ?? new Date();
    const key = keyForDate(date, scope);
    const state = await readState(file);
    return { value: state[key] ?? 0, key, file };
}

export async function setCurrent(value: number, opts: SeqOptions = {}) {
    const file = opts.file ?? DEFAULT_FILE;
    const scope: Scope = opts.scope ?? DEFAULT_SCOPE;
    const date = opts.date ?? new Date();
    const key = keyForDate(date, scope);

    await withLock(file, async () => {
        const state = await readState(file);
        state[key] = Math.max(0, Math.floor(value));
        await writeState(file, state);
    });

    return { value: Math.max(0, Math.floor(value)), key, file };
}

export async function resetScope(opts: SeqOptions = {}) {
    const file = opts.file ?? DEFAULT_FILE;
    const scope: Scope = opts.scope ?? DEFAULT_SCOPE;
    const date = opts.date ?? new Date();
    const key = keyForDate(date, scope);

    await withLock(file, async () => {
        const state = await readState(file);
        delete state[key];
        await writeState(file, state);
    });

    return { key, file };
}