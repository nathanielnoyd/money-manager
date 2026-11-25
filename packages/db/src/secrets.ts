import { readFileSync } from "node:fs";

/**
 * Read a secret from `${NAME}_FILE` (Docker secrets, preferred) or `${NAME}`.
 * Throws if `required` and neither is set.
 */
export function readSecret(name: string, required: true): string;
export function readSecret(name: string, required?: false): string | undefined;
export function readSecret(name: string, required = false): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) return readFileSync(file, "utf8").trim();
  const value = process.env[name];
  if (value) return value;
  if (required) throw new Error(`Missing secret: set ${name}_FILE or ${name}`);
  return undefined;
}
