import { type Connector, ConnectorError, type SyncResult } from "@mm/connectors";
import { generateKeyPair, type KeyPair, open, seal } from "@mm/crypto";
import { schema, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findDueConnections, parseSyncPayload, type SyncDeps, syncConnection } from "./sync";

const adminUrl = testDatabaseUrl();

describe("parseSyncPayload", () => {
  it("accepts well-formed payloads only", () => {
    const id = "01a1bdc2-4324-7183-a5bc-d5f8312651f6";
    expect(parseSyncPayload(JSON.stringify({ connectionId: id, householdId: id }))).toEqual({
      connectionId: id,
      householdId: id,
    });
    expect(parseSyncPayload("not json")).toBeNull();
    expect(
      parseSyncPayload(JSON.stringify({ connectionId: "'; drop table", householdId: id })),
    ).toBeNull();
  });
});

describe.skipIf(!adminUrl)("syncConnection (integration)", () => {
  let t: TestDatabase;
  let h: string;
  let kp: KeyPair;
  let behaviour: "ok" | "reauth" = "ok";
  const linkedWith: string[] = [];
  let linkFails = false;

  const fake: Connector = {
    id: "simplefin",
    async completeLink(token) {
      if (linkFails) throw new ConnectorError("Bridge unavailable", "retry");
      linkedWith.push(token);
      return {
        secret: "https://u:p@bridge.simplefin.org/simplefin",
        institutionName: "SimpleFIN Bridge",
      };
    },
    async sync({ secret }): Promise<SyncResult> {
      expect(secret).toBe("https://u:p@bridge.simplefin.org/simplefin");
      if (behaviour === "reauth") throw new ConnectorError("Access revoked", "reauth");
      return {
        accounts: [
          {
            providerAccountId: "a1",
            name: "Checking",
            type: "depository",
            currency: "USD",
            balance: 100000,
          },
        ],
        transactions: [
          {
            providerTransactionId: "t1",
            providerAccountId: "a1",
            date: "2026-03-01",
            amount: -1200,
            pending: false,
            description: "NETFLIX.COM",
          },
        ],
        removed: [],
        window: { start: "2026-01-01", end: "2026-03-02" },
        nextCursor: null,
        warnings: [],
      };
    },
  };

  const deps = (): SyncDeps => ({
    db: t.app,
    keyring: [kp],
    connectorFor: () => fake,
    intervalHours: 6,
    now: () => new Date("2026-03-02T00:00:00Z"),
  });

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    h = await t.household();
    kp = await generateKeyPair();
  });
  afterAll(() => t?.cleanup());

  it("claims a setup token, re-seals the access secret, then syncs", async () => {
    const [conn] = await withHousehold(t.app, h, (tx) =>
      tx
        .insert(schema.connections)
        .values({
          householdId: h,
          provider: "simplefin",
          institutionName: "Linking…",
          status: "linking",
        })
        .returning(),
    );
    const sealedToken = await seal("SETUP-TOKEN", kp.publicKey);
    await withHousehold(t.app, h, (tx) =>
      tx
        .update(schema.connections)
        .set({ secretSealed: sealedToken })
        .where(eq(schema.connections.id, conn?.id as string)),
    );

    await syncConnection(deps(), { connectionId: conn?.id as string, householdId: h });

    expect(linkedWith).toEqual(["SETUP-TOKEN"]);
    await withHousehold(t.app, h, async (tx) => {
      const [c] = await tx.select().from(schema.connections);
      expect(c).toMatchObject({
        status: "active",
        institutionName: "SimpleFIN Bridge",
        lastError: null,
      });
      expect(c?.nextSyncAt?.toISOString()).toBe("2026-03-02T06:00:00.000Z");
      expect(c?.secretSealed).not.toContain("bridge.simplefin.org");
      expect(await open(c?.secretSealed as string, [kp])).toBe(
        "https://u:p@bridge.simplefin.org/simplefin",
      );
      expect(await tx.select().from(schema.accounts)).toHaveLength(1);
      expect(await tx.select().from(schema.transactions)).toHaveLength(1);
      const [run] = await tx.select().from(schema.syncRuns);
      expect(run).toMatchObject({ status: "success", added: 1 });
    });
  });

  it("marks the connection as needing re-auth when access is revoked", async () => {
    behaviour = "reauth";
    const [conn] = await withHousehold(t.app, h, (tx) => tx.select().from(schema.connections));
    await syncConnection(deps(), { connectionId: conn?.id as string, householdId: h });
    const [after] = await withHousehold(t.app, h, (tx) => tx.select().from(schema.connections));
    expect(after).toMatchObject({ status: "needs_reauth", lastError: "Access revoked" });
  });

  it("ignores a job whose household doesn't own the connection", async () => {
    const other = await t.household("Other");
    const [conn] = await withHousehold(t.app, h, (tx) => tx.select().from(schema.connections));
    behaviour = "ok";
    await syncConnection(deps(), { connectionId: conn?.id as string, householdId: other });
    const runs = await withHousehold(t.app, h, (tx) => tx.select().from(schema.syncRuns));
    expect(runs).toHaveLength(2); // unchanged: the forged job never touched household h
  });
  it("leaves a connection linking, and due again, when the link fails transiently", async () => {
    const sealedToken = await seal("SETUP-TOKEN-2", kp.publicKey);
    const [conn] = await withHousehold(t.app, h, (tx) =>
      tx
        .insert(schema.connections)
        .values({
          householdId: h,
          provider: "simplefin",
          institutionName: "Linking…",
          status: "linking",
          secretSealed: sealedToken,
        })
        .returning(),
    );
    const job = { connectionId: conn?.id as string, householdId: h };
    // A link whose NOTIFY the worker missed is still found by the scheduler.
    expect(await findDueConnections(t.app)).toContainEqual(job);

    linkFails = true;
    await expect(syncConnection(deps(), job)).rejects.toThrow("Bridge unavailable");
    const [failed] = await withHousehold(t.app, h, (tx) =>
      tx.select().from(schema.connections).where(eq(schema.connections.id, job.connectionId)),
    );
    expect(failed?.status).toBe("linking");
    expect(await open(failed?.secretSealed as string, [kp])).toBe("SETUP-TOKEN-2");

    linkFails = false;
    await syncConnection(deps(), job);
    const [done] = await withHousehold(t.app, h, (tx) =>
      tx.select().from(schema.connections).where(eq(schema.connections.id, job.connectionId)),
    );
    expect(done?.status).toBe("active");
    expect(linkedWith).toContain("SETUP-TOKEN-2");
  });
});
