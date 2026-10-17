import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "provision-test-"));
const account = privateKeyToAccount(generatePrivateKey());

vi.mock("../identity/wallet.js", () => ({
  getAutomatonDir: () => tmpDir,
  getWallet: async () => ({
    account,
    chainIdentity: { address: account.address, chainType: "evm" },
    chainType: "evm",
    isNew: false,
  }),
}));

import { provision } from "../identity/provision.js";

const API = "https://api.example.test";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("provision", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stubFetch(handler: (url: string, n: number) => Response) {
    let n = 0;
    vi.stubGlobal("fetch", async (input: string) => {
      const url = String(input).replace(API, "");
      calls.push(url);
      return handler(url, ++n);
    });
  }

  it("restarts with a fresh nonce when verification reports an expired nonce", async () => {
    let verifies = 0;
    stubFetch((url) => {
      if (url === "/v1/auth/nonce") return json({ nonce: `nonce${calls.length}abcdefgh` });
      if (url === "/v1/auth/verify") {
        verifies++;
        return verifies === 1
          ? json({ error: "Invalid or expired nonce" }, 401)
          : json({ access_token: "jwt" });
      }
      if (url === "/v1/auth/api-keys") return json({ key: "cnwy_k_test", key_prefix: "cnwy_k_te" });
      return json({}, 404);
    });

    const result = await provision(API);
    expect(result.apiKey).toBe("cnwy_k_test");
    expect(calls.filter((c) => c === "/v1/auth/nonce")).toHaveLength(2);
    expect(calls.filter((c) => c === "/v1/auth/verify")).toHaveLength(2);
    expect(calls.filter((c) => c === "/v1/auth/api-keys")).toHaveLength(1);
  });

  it("does not blindly resend the same signed message after a 5xx on verify", async () => {
    let verifies = 0;
    stubFetch((url) => {
      if (url === "/v1/auth/nonce") return json({ nonce: `nonce${calls.length}abcdefgh` });
      if (url === "/v1/auth/verify") {
        verifies++;
        return verifies === 1 ? json({ error: "bad gateway" }, 502) : json({ access_token: "jwt" });
      }
      if (url === "/v1/auth/api-keys") return json({ key: "cnwy_k_test", key_prefix: "cnwy_k_te" });
      return json({}, 404);
    });

    await provision(API);
    // 502 on the first verify must trigger a new nonce, not a resend of the old one.
    expect(calls.filter((c) => c === "/v1/auth/nonce")).toHaveLength(2);
  });

  it("gives up after three attempts and reports the last error", async () => {
    stubFetch((url) => {
      if (url === "/v1/auth/nonce") return json({ nonce: `nonce${calls.length}abcdefgh` });
      return json({ error: "Invalid or expired nonce" }, 401);
    });

    await expect(provision(API)).rejects.toThrow(/expired nonce/);
    expect(calls.filter((c) => c === "/v1/auth/nonce")).toHaveLength(3);
  });

  it("does not retry non-transient failures", async () => {
    stubFetch((url) => {
      if (url === "/v1/auth/nonce") return json({ nonce: "abcdefgh12345" });
      return json({ error: "Forbidden" }, 403);
    });

    await expect(provision(API)).rejects.toThrow(/403/);
    expect(calls.filter((c) => c === "/v1/auth/nonce")).toHaveLength(1);
  });

  it("never retries after an API key was requested (avoids duplicate keys)", async () => {
    stubFetch((url) => {
      if (url === "/v1/auth/nonce") return json({ nonce: "abcdefgh12345" });
      if (url === "/v1/auth/verify") return json({ access_token: "jwt" });
      return json({ error: "unavailable" }, 503);
    });

    await expect(provision(API)).rejects.toThrow(/503/);
    expect(calls.filter((c) => c === "/v1/auth/api-keys")).toHaveLength(1);
    expect(calls.filter((c) => c === "/v1/auth/nonce")).toHaveLength(1);
  });
});
