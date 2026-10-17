#!/usr/bin/env node
/**
 * Automaton Web Console
 *
 * Local-only dashboard for watching an automaton and sending it messages.
 * Reads state.db through a read-only connection; the only write is a
 * creator message into the inbox (plus a wake event).
 *
 * Usage: node dist/web/server.js [--port 7777] [--db ~/.automaton/state.db]
 */

import http from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import { getAutomatonDir } from "../identity/wallet.js";
import { PAGE_HTML } from "./page.js";
import { STATIC_MODEL_BASELINE } from "../inference/types.js";
import { HttpError, cleanSecret, cleanUrl } from "./common.js";
import {
  setupStatus,
  createInitialConfig,
  provisionConway,
  saveManualConwayKey,
  agentStatus,
  agentLogs,
  startAgent,
  stopAgent,
} from "./setup.js";

// Inside a container the console must listen on 0.0.0.0 so the published port
// is reachable; the host side stays loopback-only (docker run -p 127.0.0.1:...).
const HOST = process.env.AUTOMATON_CONSOLE_HOST || "127.0.0.1";
const MAX_MESSAGE_CHARS = 4000;
const MAX_BODY_BYTES = 16 * 1024;
const MESSAGE_LIMIT_PER_MIN = 10;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(process.env.HOME || "/root", p.slice(1)) : p;
}

const port = Number(argValue("--port") ?? 7777);
const dbPath = path.resolve(
  expandHome(argValue("--db") ?? path.join(getAutomatonDir(), "state.db")),
);
const token = randomBytes(24).toString("hex");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid --port: ${argValue("--port")}`);
  process.exit(1);
}

/**
 * The database only exists after the agent has run once, so the read
 * connection is opened lazily. Before that, every query returns nothing.
 */
let readDbHandle: Database.Database | null = null;
function readDb(): Database.Database | null {
  if (readDbHandle) return readDbHandle;
  if (!fs.existsSync(dbPath)) return null;
  try {
    readDbHandle = new Database(dbPath, { readonly: true, fileMustExist: true });
    readDbHandle.pragma("busy_timeout = 3000");
  } catch {
    readDbHandle = null;
  }
  return readDbHandle;
}

/** Only these config fields leave the process. Never keys or wallet secrets. */
function publicConfig(): Record<string, unknown> {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(path.dirname(dbPath), "automaton.json"), "utf-8"),
    );
    return {
      name: raw.name,
      walletAddress: raw.walletAddress,
      creatorAddress: raw.creatorAddress,
      inferenceModel: raw.inferenceModel,
      version: raw.version,
      sandboxId: raw.sandboxId,
    };
  } catch {
    return {};
  }
}

function rows(sql: string, ...params: unknown[]): unknown[] {
  try {
    return readDb()?.prepare(sql).all(...params) ?? [];
  } catch {
    return []; // table may not exist in older schema versions
  }
}

function one<T>(sql: string, ...params: unknown[]): T | undefined {
  try {
    return readDb()?.prepare(sql).get(...params) as T | undefined;
  } catch {
    return undefined;
  }
}

function parseJson(text: unknown, fallback: unknown): unknown {
  try {
    return JSON.parse(String(text));
  } catch {
    return fallback;
  }
}

function clampLimit(value: string | null, def: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
}

function overview(): unknown {
  const cfg = publicConfig();
  const kv = (key: string) =>
    one<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)?.value ?? null;
  const turnCount = one<{ n: number }>("SELECT COUNT(*) AS n FROM turns")?.n ?? 0;
  const totalCost = one<{ c: number }>("SELECT COALESCE(SUM(cost_cents),0) AS c FROM turns")?.c ?? 0;
  const todayCost =
    one<{ c: number }>(
      "SELECT COALESCE(SUM(cost_cents),0) AS c FROM inference_costs WHERE created_at >= date('now')",
    )?.c ?? 0;
  const decisions = rows(
    "SELECT decision, COUNT(*) AS n FROM policy_decisions GROUP BY decision",
  );
  const children = rows("SELECT status, COUNT(*) AS n FROM children GROUP BY status");
  const pendingInbox =
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM inbox_messages WHERE status IN ('received','in_progress')",
    )?.n ?? 0;
  return {
    config: cfg,
    agentState: kv("agent_state") ?? "not_started",
    agentProcess: agentStatus(),
    setup: setupStatus(),
    sleepUntil: kv("sleep_until"),
    lastHeartbeat: parseJson(kv("last_heartbeat_ping"), null),
    turnCount,
    totalCostCents: totalCost,
    todayInferenceCostCents: todayCost,
    policyDecisions: decisions,
    children,
    pendingInbox,
    serverTime: new Date().toISOString(),
  };
}

function turns(limit: number): unknown {
  return (
    rows(
      "SELECT id, timestamp, state, input, input_source, thinking, tool_calls, cost_cents FROM turns ORDER BY timestamp DESC, rowid DESC LIMIT ?",
      limit,
    ) as Record<string, unknown>[]
  ).map((t) => ({
    id: t.id,
    timestamp: t.timestamp,
    state: t.state,
    input: t.input,
    inputSource: t.input_source,
    thinking: t.thinking,
    toolCalls: parseJson(t.tool_calls, []),
    costCents: t.cost_cents,
  }));
}

// ─── Message writes ─────────────────────────────────────────────

const recentMessages: number[] = [];

function sendMessage(content: string): { id: string } {
  const now = Date.now();
  while (recentMessages.length && now - recentMessages[0] > 60_000) recentMessages.shift();
  if (recentMessages.length >= MESSAGE_LIMIT_PER_MIN) {
    throw new HttpError(429, "Too many messages, wait a minute");
  }
  recentMessages.push(now);

  if (!fs.existsSync(dbPath)) {
    throw new HttpError(409, "Agent chưa chạy lần nào nên chưa có hộp thư. Hãy bấm Chạy agent trước.");
  }
  const cfg = publicConfig();
  const from = typeof cfg.creatorAddress === "string" && cfg.creatorAddress ? cfg.creatorAddress : "web-console";
  const id = ulid();

  const writeDb = new Database(dbPath, { fileMustExist: true });
  try {
    writeDb.pragma("busy_timeout = 3000");
    writeDb
      .prepare(
        "INSERT INTO inbox_messages (id, from_address, content, received_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, from, content, new Date().toISOString());
    writeDb
      .prepare("INSERT INTO wake_events (source, reason, payload) VALUES (?, ?, ?)")
      .run("web-console", "Message from creator", JSON.stringify({ messageId: id }));
  } finally {
    writeDb.close();
  }
  return { id };
}

// ─── Settings (provider keys + model) ───────────────────────────
//
// Keys are write-only: they can be set or cleared here, but no endpoint ever
// returns them. They are written straight to automaton.json (mode 0600), the
// same file the CLI wizard writes, and are never logged.

const configPath = path.join(path.dirname(dbPath), "automaton.json");
const settingsWrites: number[] = [];

function readConfigFile(): Record<string, unknown> {
  if (!fs.existsSync(configPath)) {
    throw new HttpError(
      409,
      "Chưa có automaton.json. Chạy wizard một lần trước: node dist/index.js --run",
    );
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    throw new HttpError(500, "automaton.json bị lỗi định dạng");
  }
}

function availableModels(): { modelId: string; displayName: string; provider: string }[] {
  const seen = new Map<string, { modelId: string; displayName: string; provider: string }>();
  for (const m of STATIC_MODEL_BASELINE) {
    seen.set(m.modelId, { modelId: m.modelId, displayName: m.displayName, provider: m.provider });
  }
  for (const r of rows(
    "SELECT model_id AS modelId, display_name AS displayName, provider FROM model_registry WHERE enabled = 1",
  ) as { modelId: string; displayName: string; provider: string }[]) {
    seen.set(r.modelId, r);
  }
  return [...seen.values()];
}

function settingsView(): unknown {
  const raw = readConfigFile();
  const strategy = (raw.modelStrategy ?? {}) as Record<string, unknown>;
  return {
    anthropicConfigured: typeof raw.anthropicApiKey === "string" && raw.anthropicApiKey.length > 0,
    openaiConfigured: typeof raw.openaiApiKey === "string" && raw.openaiApiKey.length > 0,
    ollamaBaseUrl: typeof raw.ollamaBaseUrl === "string" ? raw.ollamaBaseUrl : "",
    inferenceModel: strategy.inferenceModel ?? raw.inferenceModel ?? null,
    models: availableModels(),
  };
}

function updateSettings(body: Record<string, unknown>): { changed: string[] } {
  const now = Date.now();
  while (settingsWrites.length && now - settingsWrites[0] > 60_000) settingsWrites.shift();
  if (settingsWrites.length >= 10) throw new HttpError(429, "Đổi cài đặt quá nhanh, đợi một phút");
  settingsWrites.push(now);

  const config = readConfigFile();
  const changed: string[] = [];

  if ("anthropicApiKey" in body) {
    const k = cleanSecret(body.anthropicApiKey, "sk-ant-", "Anthropic key");
    if (k === null) delete config.anthropicApiKey;
    else config.anthropicApiKey = k;
    changed.push("anthropicApiKey");
  }
  if ("openaiApiKey" in body) {
    const k = cleanSecret(body.openaiApiKey, "sk-", "OpenAI key");
    if (k === null) delete config.openaiApiKey;
    else config.openaiApiKey = k;
    changed.push("openaiApiKey");
  }
  if ("ollamaBaseUrl" in body) {
    const u = cleanUrl(body.ollamaBaseUrl);
    if (u === null) delete config.ollamaBaseUrl;
    else config.ollamaBaseUrl = u;
    changed.push("ollamaBaseUrl");
  }
  if ("inferenceModel" in body) {
    const id = body.inferenceModel;
    if (typeof id !== "string" || !availableModels().some((m) => m.modelId === id)) {
      throw new HttpError(400, "Model không có trong danh sách");
    }
    config.inferenceModel = id;
    config.modelStrategy = { ...((config.modelStrategy as object) ?? {}), inferenceModel: id };
    changed.push("inferenceModel");
  }
  if (!changed.length) throw new HttpError(400, "Không có gì để đổi");

  // Atomic replace so a crash never leaves a half-written config.
  const tmp = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configPath);
  return { changed };
}

// ─── HTTP plumbing ──────────────────────────────────────────────

function tokenOk(supplied: string | undefined): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Blocks DNS-rebinding and cross-site requests: only our own origin is accepted. */
function hostOk(req: http.IncomingMessage): boolean {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowed.has(req.headers.host ?? "")) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      return allowed.has(new URL(origin).host);
    } catch {
      return false;
    }
  }
  return true;
}

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  const payload = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "Expected application/json");
  }
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  const body = parseJson(raw, null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Body không hợp lệ");
  }
  return body as Record<string, unknown>;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostOk(req)) throw new HttpError(403, "Forbidden host");
    const url = new URL(req.url ?? "/", `http://${HOST}:${port}`);

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, PAGE_HTML, "text/html");
    }

    if (!url.pathname.startsWith("/api/")) throw new HttpError(404, "Not found");
    if (!tokenOk(req.headers["x-console-token"] as string | undefined)) {
      throw new HttpError(401, "Missing or invalid token");
    }

    if (req.method === "GET") {
      const q = url.searchParams;
      switch (url.pathname) {
        case "/api/overview":
          return send(res, 200, overview());
        case "/api/turns":
          return send(res, 200, turns(clampLimit(q.get("limit"), 30, 200)));
        case "/api/inbox":
          return send(
            res,
            200,
            rows(
              "SELECT id, from_address AS fromAddress, content, received_at AS receivedAt, status FROM inbox_messages ORDER BY received_at DESC LIMIT ?",
              clampLimit(q.get("limit"), 30, 200),
            ),
          );
        case "/api/policy":
          return send(
            res,
            200,
            rows(
              "SELECT id, tool_name AS toolName, risk_level AS riskLevel, decision, reason, created_at AS createdAt FROM policy_decisions ORDER BY created_at DESC, rowid DESC LIMIT ?",
              clampLimit(q.get("limit"), 50, 300),
            ),
          );
        case "/api/settings":
          return send(res, 200, settingsView());
        case "/api/setup":
          return send(res, 200, setupStatus());
        case "/api/agent":
          return send(res, 200, agentStatus());
        case "/api/agent/logs":
          return send(res, 200, { log: agentLogs(clampLimit(q.get("lines"), 120, 500)) });
        case "/api/children":
          return send(
            res,
            200,
            rows(
              "SELECT id, name, address, status, funded_amount_cents AS fundedAmountCents, created_at AS createdAt FROM children ORDER BY created_at DESC LIMIT 100",
            ),
          );
        default:
          throw new HttpError(404, "Not found");
      }
    }

    if (req.method === "POST" && url.pathname === "/api/message") {
      const body = await jsonBody(req);
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content) throw new HttpError(400, "Message is empty");
      if (content.length > MAX_MESSAGE_CHARS) {
        throw new HttpError(400, `Message too long (max ${MAX_MESSAGE_CHARS})`);
      }
      return send(res, 200, sendMessage(content));
    }

    if (req.method === "POST") {
      const body = await jsonBody(req);
      switch (url.pathname) {
        case "/api/settings":
          return send(res, 200, updateSettings(body));
        case "/api/setup/config":
          return send(res, 200, await createInitialConfig(body));
        case "/api/setup/provision":
          return send(res, 200, await provisionConway());
        case "/api/setup/conway-key":
          saveManualConwayKey(body.key);
          return send(res, 200, { ok: true });
        case "/api/agent/start":
          return send(res, 200, await startAgent());
        case "/api/agent/stop":
          return send(res, 200, await stopAgent(body.force === true));
        default:
          throw new HttpError(404, "Not found");
      }
    }

    throw new HttpError(405, "Method not allowed");
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error("Unhandled error:", err);
    return send(res, 500, { error: "Internal error" });
  }
});

server.listen(port, HOST, () => {
  console.log(`Automaton console: http://localhost:${port}/#${token}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Listening on ${HOST}. The token in the URL fragment is required for the API.`);
  if (process.argv.includes("--open") && process.platform === "darwin") {
    execFile("open", [`http://localhost:${port}/#${token}`], () => {});
  }
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    readDbHandle?.close();
    process.exit(0);
  });
}
