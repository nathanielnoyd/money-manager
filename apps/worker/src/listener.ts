import pg from "pg";

export interface ListenerOptions {
  connectionString: string;
  channel: string;
  onNotification: (payload: string | undefined) => void;
  /** Called after every reconnect, so the caller can catch up on anything sent meanwhile. */
  onReconnect?: () => void;
  onLost?: (reason: string) => void;
  retryMs?: number;
}

/**
 * LISTEN on a Postgres channel and keep listening. Notifications are not queued for a client
 * that is away, so the connection is re-established for as long as the worker runs, whether it
 * was dropped with an error or closed cleanly, and however many attempts that takes.
 */
export async function startListener(opts: ListenerOptions): Promise<{ stop(): Promise<void> }> {
  const retryMs = opts.retryMs ?? 5_000;
  let current: pg.Client | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const retryLater = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      connect().then(
        () => opts.onReconnect?.(),
        (err: Error) => {
          opts.onLost?.(err.message);
          retryLater();
        },
      );
    }, retryMs);
  };

  async function connect(): Promise<void> {
    const client = new pg.Client({ connectionString: opts.connectionString });
    const lost = (reason: string) => {
      if (stopped || current !== client) return;
      current = undefined;
      client.end().catch(() => {});
      opts.onLost?.(reason);
      retryLater();
    };
    client.on("error", (err) => lost(err.message));
    client.on("end", () => lost("connection closed"));
    client.on("notification", (msg) => opts.onNotification(msg.payload));
    try {
      await client.connect();
      await client.query(`LISTEN ${pg.escapeIdentifier(opts.channel)}`);
    } catch (err) {
      client.removeAllListeners();
      client.on("error", () => {});
      client.end().catch(() => {});
      throw err;
    }
    current = client;
  }

  await connect();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const client = current;
      current = undefined;
      await client?.end().catch(() => {});
    },
  };
}
