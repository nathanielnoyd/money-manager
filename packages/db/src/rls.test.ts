import { appTimeZone } from "@mm/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, withHousehold } from "./client";
import {
  accounts,
  balanceSnapshots,
  categories,
  HOUSEHOLD_SCOPED_TABLES,
  transactions,
} from "./schema";
import { seedDemoData } from "./seed";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "./testing";

const adminUrl = testDatabaseUrl();

describe.skipIf(!adminUrl)("row-level security (integration)", () => {
  let t: TestDatabase;
  let hA: string;
  let hB: string;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    hA = await t.household("A");
    hB = await t.household("B");
  });
  afterAll(() => t?.cleanup());

  it("app role is not a superuser and cannot bypass RLS", async () => {
    const { rows } = await t.appPool.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("every table with a household_id column has a policy and is listed", async () => {
    const { rows } = await t.adminPool.query<{ name: string; protected: boolean }>(`
      select c.relname as name,
        c.relrowsecurity and exists (
          select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
        ) as protected
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'household_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
      order by 1`);
    const names = (p: boolean) => rows.filter((r) => r.protected === p).map((r) => r.name);

    // audit_log has its own append-only policies (household_id may be null), so it is not in
    // the list of tables that share the standard household policy.
    expect(names(true)).toEqual([...HOUSEHOLD_SCOPED_TABLES, "audit_log"].sort());
    // Read while signing in, before a household context exists, so they have no policy and
    // every query filters by hand. A new table must not join this list: give it a policy.
    expect(names(false)).toEqual(["household_members", "sessions"]);
  });

  it("indexes every foreign key, apart from a few small user references", async () => {
    const { rows } = await t.adminPool.query<{ fk: string }>(`
      select c.conrelid::regclass::text || '.' || a.attname as fk
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and array_length(c.conkey, 1) = 1
        and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
        )
      order by 1`);
    // Who made a change or an invite. Small tables, and users are rarely deleted. Anything
    // else needs an index: deleting the parent row, or a household's RLS filter, scans it.
    expect(rows.map((r) => r.fk)).toEqual([
      "catalog_changes.decided_by",
      "catalog_changes.user_id",
      "imports.created_by",
      "invites.invited_by",
    ]);
  });

  it("runs database sessions in the instance's time zone, with timeouts", async () => {
    const { rows } = await t.appPool.query<{ zone: string; st: string; idle: string }>(
      `select current_setting('TimeZone') as zone, current_setting('statement_timeout') as st,
        current_setting('idle_in_transaction_session_timeout') as idle`,
    );
    expect(rows[0]).toEqual({ zone: appTimeZone(), st: "1min", idle: "1min" });
  });

  it("cancels a statement that runs past the timeout", async () => {
    const pool = createPool(t.appUrl, 1, { statementTimeoutMs: 200 });
    try {
      await expect(pool.query("select pg_sleep(2)")).rejects.toThrow(/statement timeout/);
    } finally {
      await pool.end();
    }
  });

  it("sees nothing without a household context (fail closed)", async () => {
    expect(await t.app.select().from(categories)).toHaveLength(0);
  });

  it("only sees its own household's rows", async () => {
    const seen = await withHousehold(t.app, hA, (tx) => tx.select().from(categories));
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((c) => c.householdId))).toEqual(new Set([hA]));
  });

  it("cannot write rows into another household", async () => {
    const err = await withHousehold(t.app, hA, (tx) =>
      tx.insert(accounts).values({ householdId: hB, name: "sneaky", type: "depository" }),
    ).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).cause)).toMatch(/row-level security/);
  });

  it("cannot update another household's rows", async () => {
    const updated = await withHousehold(t.app, hA, (tx) =>
      tx.update(categories).set({ name: "pwned" }).where(sql`household_id = ${hB}`).returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("due_connections() is callable but returns no secrets", async () => {
    const { rows } = await t.appPool.query("select * from due_connections(10)");
    expect(rows).toEqual([]);
  });

  it("seed data reconciles: latest snapshot equals account balance", async () => {
    const res = await seedDemoData(t.app, hA, { months: 3, today: new Date("2026-06-30") });
    expect(res.transactions).toBeGreaterThan(100);
    await withHousehold(t.app, hA, async (tx) => {
      const accts = await tx.select().from(accounts);
      for (const a of accts) {
        const { rows } = await tx.execute<{ balance: string }>(
          sql`select balance from ${balanceSnapshots} where account_id = ${a.id} order by date desc limit 1`,
        );
        expect(Number(rows[0]?.balance)).toBe(a.currentBalance);
      }
      const { rows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${transactions} where category_id is null`,
      );
      expect(rows[0]?.n).toBe(0);
    });
    const other = await withHousehold(t.app, hB, (tx) => tx.select().from(transactions));
    expect(other).toHaveLength(0);
  });
});
