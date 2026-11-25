import { createDb, createPool } from "../client";
import { readSecret } from "../secrets";
import { hasAnyUser, issueSetupToken } from "../setup-token";

const pool = createPool(readSecret("DATABASE_ADMIN_URL", true), 1);
try {
  const db = createDb(pool);
  if (await hasAnyUser(db)) {
    console.error(
      "An owner account already exists. Invite new members from Settings → Household. If you are locked out, see docs/self-hosting.md#locked-out.",
    );
    process.exitCode = 1;
  } else {
    console.log(`Setup token (valid 24h): ${await issueSetupToken(db)}`);
  }
} finally {
  await pool.end();
}
