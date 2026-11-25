import _sodium from "libsodium-wrappers";

let ready: Promise<typeof _sodium> | undefined;

/** Lazily initialise libsodium (WASM) once per process. */
export function sodium(): Promise<typeof _sodium> {
  ready ??= _sodium.ready.then(() => _sodium);
  return ready;
}
