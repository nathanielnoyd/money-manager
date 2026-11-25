import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { __test, checkOutboundUrl } from "./net";

describe("outbound URL guard", () => {
  it.each([
    "10.0.0.5",
    "127.0.0.1",
    "169.254.169.254",
    "172.20.1.1",
    "192.168.1.10",
    "100.101.102.103",
    "::1",
    "fd12::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    // Hex forms that URL parsing produces from [::ffff:127.0.0.1] and friends.
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::",
    "::7f00:1",
    "0.0.0.0",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "fe90::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "198.18.0.1",
    "not-an-ip",
  ])("treats %s as private", (ip) => expect(__test.isPrivate(ip)).toBe(true));
  it.each([
    "93.184.216.34",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "::ffff:5db8:d822",
    "64:ff9b::101:101",
  ])("treats %s as public", (ip) => expect(__test.isPrivate(ip)).toBe(false));

  it("blocks plain http, embedded credentials and private IPs by default", async () => {
    expect(await checkOutboundUrl("http://ntfy.sh/topic", { allowPrivate: false })).toMatch(
      /https/,
    );
    expect(
      await checkOutboundUrl("https://user:pass@ntfy.sh/topic", { allowPrivate: false }),
    ).toMatch(/credentials/);
    expect(
      await checkOutboundUrl("https://169.254.169.254/latest", { allowPrivate: false }),
    ).toMatch(/private network/);
    expect(await checkOutboundUrl("https://127.0.0.1:3000/x", { allowPrivate: false })).toMatch(
      /private network/,
    );
    expect(await checkOutboundUrl("https://localhost/x", { allowPrivate: false })).toMatch(
      /private network/,
    );
    // Encoded loopback forms are normalized by the URL parser and still caught.
    for (const host of ["[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "0x7f000001", "2130706433", "0"]) {
      expect(await checkOutboundUrl(`https://${host}/x`, { allowPrivate: false })).toMatch(
        /private network/,
      );
    }
  });

  it("allows LAN and tailnet ntfy when explicitly opted in", async () => {
    expect(await checkOutboundUrl("http://192.168.1.20/topic", { allowPrivate: true })).toBeNull();
  });
  it("connects to the address that was checked, whatever the name resolves to", async () => {
    const seen: { host?: string; url?: string; title?: string; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        seen.push({
          host: req.headers.host,
          url: req.url,
          title: String(req.headers.title),
          body,
        });
        if (req.url === "/moved") res.writeHead(302, { location: "http://127.0.0.1/" }).end();
        else res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      // The name doesn't resolve at all: the request can only arrive through the pinned address.
      const pinned = __test.pinnedFetch([{ address: "127.0.0.1", family: 4 }]);
      const res = await pinned(`http://ntfy.invalid:${port}/topic`, {
        method: "POST",
        body: "hello",
        headers: { Title: "Test" },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(seen[0]).toEqual({
        host: `ntfy.invalid:${port}`,
        url: "/topic",
        title: "Test",
        body: "hello",
      });
      await expect(pinned(`http://ntfy.invalid:${port}/moved`)).rejects.toThrow("redirect refused");
    } finally {
      server.close();
    }
  });
});
