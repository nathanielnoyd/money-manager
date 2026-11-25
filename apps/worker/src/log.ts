import pino from "pino";

/** Structured logs. Anything that could carry a secret or account detail is redacted. */
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { svc: "worker" },
  redact: {
    paths: [
      "secret",
      "*.secret",
      "token",
      "*.token",
      "accessToken",
      "*.accessToken",
      "password",
      "*.password",
      "amount",
      "*.amount",
      "balance",
      "*.balance",
    ],
    censor: "[redacted]",
  },
});
