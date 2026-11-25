/**
 * AGPL-3.0 §13: anyone using a (possibly modified) network deployment must be offered the
 * corresponding source. Unmodified deployments can point at upstream; if you run a modified
 * version for others, set SOURCE_URL to where your changes are published.
 */
export const UPSTREAM_SOURCE_URL = "https://github.com/nathanielnoyd/money-manager";

export const sourceUrl = () => process.env.SOURCE_URL || UPSTREAM_SOURCE_URL;
