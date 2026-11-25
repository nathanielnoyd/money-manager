import { hashRecoveryCode } from "@mm/crypto";
import { schema } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecoverError, recoverAccess } from "./recover";

const adminUrl = testDatabaseUrl();

describe.skipIf(!adminUrl)("recovering access from the command line (integration)", () => {
  let t: TestDatabase;
  const userOf = async (householdId: string) => {
    const [m] = await t.admin
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.householdMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.householdMembers.userId))
      .where(eq(schema.householdMembers.householdId, householdId));
    return m as { id: string; email: string };
  };

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
  });
  afterAll(() => t?.cleanup());

  it("says so when nobody has signed up", async () => {
    await expect(recoverAccess(t.admin)).rejects.toBeInstanceOf(RecoverError);
  });

  it("replaces the sole owner's recovery codes and keeps passkeys and other users alone", async () => {
    const owner = await userOf(await t.household("A"));
    await t.admin
      .insert(schema.recoveryCodes)
      .values({ userId: owner.id, codeHash: hashRecoveryCode("OLD-CODE-0001") });
    const r = await recoverAccess(t.admin);
    expect(r).toMatchObject({ email: owner.email, totpRemoved: false, totpRequired: false });
    expect(r.codes).toHaveLength(10);
    const stored = await t.admin
      .select()
      .from(schema.recoveryCodes)
      .where(eq(schema.recoveryCodes.userId, owner.id));
    expect(stored.map((s) => s.codeHash).sort()).toEqual(r.codes.map(hashRecoveryCode).sort());
    expect(stored.every((s) => s.usedAt === null)).toBe(true);
    const [log] = await t.admin
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "recovery.codes_reissued_cli"));
    expect(log?.userId).toBe(owner.id);
  });

  it("needs an email once there are several owners, and can drop a lost authenticator", async () => {
    const second = await userOf(await t.household("B"));
    await expect(recoverAccess(t.admin)).rejects.toThrow(/2 owners/);
    await expect(recoverAccess(t.admin, { email: "nobody@example.test" })).rejects.toThrow(
      /No account/,
    );
    await t.admin
      .insert(schema.totpSecrets)
      .values({ userId: second.id, secretSealed: "sealed", confirmedAt: new Date() });
    const kept = await recoverAccess(t.admin, { email: second.email.toUpperCase() });
    expect(kept).toMatchObject({ email: second.email, totpRequired: true, totpRemoved: false });
    const dropped = await recoverAccess(t.admin, { email: second.email, removeTotp: true });
    expect(dropped).toMatchObject({ totpRequired: false, totpRemoved: true });
    expect(
      await t.admin
        .select()
        .from(schema.totpSecrets)
        .where(eq(schema.totpSecrets.userId, second.id)),
    ).toHaveLength(0);
  });
});
