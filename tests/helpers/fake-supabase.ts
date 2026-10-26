/**
 * In-memory fake of the subset of the Supabase query builder used by lib/hunter:
 * from(table).select/insert/update/upsert + eq/in/gte/lte/order/limit/single/maybeSingle,
 * and one-level embeds written `alias:table(cols)` (resolved through `${alias}_id`).
 * Column lists are ignored (whole rows are returned). Not a PostgREST emulator.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "upsert" | "delete";
export type FakeCall = { table: string; op: Op; payload?: unknown; options?: unknown };
type DbError = { code: string; message: string };

const TABLE_DEFAULTS: Record<string, Row> = {
  leads: { status: "suggested", fit_reasons: [] },
  searches: { status: "running", results_count: 0, progress: {}, error: null },
  companies: { leaders: [], website: null, domain: null, enriched_at: null },
};

export type FakeOptions = {
  /** Return an error for a given table/op (checked before executing). */
  failOn?: (table: string, op: Op) => DbError | null;
  /** Share the tables of another fake (e.g. a user client and a service-role client). */
  tables?: Record<string, Row[]>;
  /** Handler for `client.rpc(name, args)` (default: error "rpc not mocked"). */
  rpc?: (name: string, args: Record<string, unknown> | undefined) => unknown;
  /** Object exposed as `client.storage` (e.g. `{ from: () => ({ download }) }`). */
  storage?: unknown;
};

/** Ordered comparison for numbers and strings (ISO timestamps compare as strings). */
function compare(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

export function createFakeSupabase(initial: Record<string, Row[]> = {}, opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = opts.tables ?? {};
  for (const [t, rows] of Object.entries(initial)) tables[t] = rows.map((r) => ({ ...r }));
  const calls: FakeCall[] = [];
  const table = (name: string) => (tables[name] ??= []);

  class Query implements PromiseLike<{ data: unknown; error: DbError | null; count?: number }> {
    private op: Op = "select";
    private payload: Row[] = [];
    private options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    private filters: ((r: Row) => boolean)[] = [];
    private columns = "*";
    private mode: "many" | "single" | "maybe" = "many";
    private orderBy: { col: string; asc: boolean } | null = null;
    private max: number | null = null;
    private countMode: { head: boolean } | null = null;

    constructor(private readonly name: string) {}

    select(columns = "*", o: { count?: "exact" | "planned" | "estimated"; head?: boolean } = {}) {
      this.columns = columns;
      if (o.count) this.countMode = { head: o.head ?? false };
      return this;
    }
    insert(payload: Row | Row[]) {
      this.op = "insert";
      this.payload = Array.isArray(payload) ? payload : [payload];
      return this;
    }
    upsert(
      payload: Row | Row[],
      options: { onConflict?: string; ignoreDuplicates?: boolean } = {},
    ) {
      this.op = "upsert";
      this.payload = Array.isArray(payload) ? payload : [payload];
      this.options = options;
      return this;
    }
    update(payload: Row) {
      this.op = "update";
      this.payload = [payload];
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(col: string, value: unknown) {
      this.filters.push((r) => r[col] === value);
      return this;
    }
    in(col: string, values: unknown[]) {
      this.filters.push((r) => values.includes(r[col]));
      return this;
    }
    neq(col: string, value: unknown) {
      this.filters.push((r) => r[col] !== value);
      return this;
    }
    gte(col: string, value: number | string) {
      this.filters.push((r) => (compare(r[col], value) ?? -1) >= 0);
      return this;
    }
    lte(col: string, value: number | string) {
      this.filters.push((r) => (compare(r[col], value) ?? 1) <= 0);
      return this;
    }
    gt(col: string, value: number | string) {
      this.filters.push((r) => (compare(r[col], value) ?? -1) > 0);
      return this;
    }
    lt(col: string, value: number | string) {
      this.filters.push((r) => (compare(r[col], value) ?? 1) < 0);
      return this;
    }
    /** `is(col, null)` matches null and missing values. */
    is(col: string, value: null | boolean) {
      this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
      return this;
    }
    /** Supports `not(col, "is", null)` and `not(col, "eq", value)`. */
    not(col: string, op: "is" | "eq", value: unknown) {
      this.filters.push((r) => (op === "is" && value === null ? r[col] != null : r[col] !== value));
      return this;
    }
    order(col: string, o: { ascending?: boolean } = {}) {
      this.orderBy = { col, asc: o.ascending ?? true };
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    single() {
      this.mode = "single";
      return this;
    }
    maybeSingle() {
      this.mode = "maybe";
      return this;
    }

    private newRow(r: Row): Row {
      const now = new Date().toISOString();
      return {
        id: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
        ...(TABLE_DEFAULTS[this.name] ?? {}),
        ...structuredClone(r),
      };
    }

    private embed(rows: Row[]): Row[] {
      const embeds = [...this.columns.matchAll(/(\w+):(\w+)\(([^)]*)\)/g)];
      if (embeds.length === 0) return rows.map((r) => ({ ...r }));
      return rows.map((r) => {
        const out: Row = { ...r };
        for (const [, alias, target] of embeds) {
          const fk = r[`${alias}_id`];
          out[alias] = table(target).find((t) => t.id === fk) ?? null;
        }
        return out;
      });
    }

    private execute(): { data: unknown; error: DbError | null; count?: number } {
      calls.push({ table: this.name, op: this.op, payload: this.payload, options: this.options });
      const failure = opts.failOn?.(this.name, this.op);
      if (failure) return { data: null, error: failure };

      const rows = table(this.name);
      let result: Row[] = [];
      const match = (r: Row) => this.filters.every((f) => f(r));

      switch (this.op) {
        case "select":
          result = rows.filter(match);
          break;
        case "insert":
          result = this.payload.map((p) => this.newRow(p));
          rows.push(...result);
          break;
        case "update":
          result = rows.filter(match);
          for (const r of result) Object.assign(r, structuredClone(this.payload[0]));
          break;
        case "delete":
          result = rows.filter(match);
          tables[this.name] = rows.filter((r) => !match(r));
          break;
        case "upsert": {
          const keys = (this.options.onConflict ?? "id").split(",").map((k) => k.trim());
          for (const p of this.payload) {
            const existing = rows.find((r) => keys.every((k) => r[k] === p[k]));
            if (existing) {
              if (!this.options.ignoreDuplicates) Object.assign(existing, structuredClone(p));
              result.push(existing);
            } else {
              const created = this.newRow(p);
              rows.push(created);
              result.push(created);
            }
          }
          break;
        }
      }

      result = this.embed(result);
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        result.sort((a, b) => {
          const x = a[col] as number | null;
          const y = b[col] as number | null;
          if (x === y) return 0;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          return asc ? (x < y ? -1 : 1) : x < y ? 1 : -1;
        });
      }
      if (this.max !== null) result = result.slice(0, this.max);

      if (this.countMode) {
        return { data: this.countMode.head ? null : result, error: null, count: result.length };
      }
      if (this.mode === "many") return { data: result, error: null };
      if (this.mode === "single" && result.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: "not exactly one row" } };
      }
      return { data: result[0] ?? null, error: null };
    }

    then<T1 = { data: unknown; error: DbError | null; count?: number }, T2 = never>(
      onfulfilled?:
        | ((v: { data: unknown; error: DbError | null; count?: number }) => T1 | PromiseLike<T1>)
        | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve()
        .then(() => this.execute())
        .then(onfulfilled, onrejected);
    }
  }

  const client = {
    from: (name: string) => new Query(name),
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ table: `rpc:${name}`, op: "select", payload: args });
      if (!opts.rpc) return { data: null, error: { code: "PGRST202", message: "rpc not mocked" } };
      try {
        return { data: await opts.rpc(name, args), error: null };
      } catch (err) {
        return { data: null, error: { code: "P0001", message: String(err) } };
      }
    },
    storage: opts.storage,
  };
  return { client: client as unknown as SupabaseClient, tables, calls, table };
}
