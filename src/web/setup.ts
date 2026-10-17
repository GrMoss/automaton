/**
 * First-run setup and agent process control for the web console.
 *
 * Mirrors the steps of the CLI wizard (src/setup/wizard.ts) without the
 * terminal prompts, and runs the agent as a detached child process so it
 * keeps running if the console is closed. State lives in getAutomatonDir()
 * (i.e. $HOME/.automaton), the same place the CLI uses.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getWallet, getAutomatonDir, getWalletPath } from "../identity/wallet.js";
import { provision, loadApiKeyFromConfig } from "../identity/provision.js";
import { createConfig, saveConfig, loadConfig, getConfigPath } from "../config.js";
import { writeDefaultHeartbeatConfig } from "../heartbeat/config.js";
import { generateSoulMd, installDefaultSkills } from "../setup/defaults.js";
import { detectEnvironment } from "../setup/environment.js";
import { isValidAddress } from "../identity/chain.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import { createConwayClient } from "../conway/client.js";
import { getUsdcBalanceDetailed } from "../conway/x402.js";
import { HttpError, cleanSecret, cleanUrl } from "./common.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
// AUTOMATON_AGENT_ENTRY lets packaged builds (or tests) point at a different entrypoint.
const agentEntry = path.resolve(process.env.AUTOMATON_AGENT_ENTRY || path.join(here, "../index.js"));
const MAX_GENESIS_CHARS = 8000;

// ─── Setup ──────────────────────────────────────────────────────

function conwayKey(): string | null {
  return loadConfig()?.conwayApiKey || loadApiKeyFromConfig();
}

export function setupStatus(): Record<string, unknown> {
  const hasWallet = fs.existsSync(getWalletPath());
  const config = loadConfig();
  return {
    hasWallet,
    hasConfig: config !== null,
    hasConwayKey: Boolean(conwayKey()),
    walletAddress: config?.walletAddress ?? null,
    configPath: getConfigPath(),
  };
}

/** Create wallet + config + heartbeat + SOUL.md + skills. Refuses to overwrite. */
export async function createInitialConfig(body: Record<string, unknown>): Promise<{ walletAddress: string }> {
  if (fs.existsSync(getConfigPath())) {
    throw new HttpError(409, "Đã có cấu hình. Dùng mục Cài đặt để chỉnh sửa.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64 || /[\u0000-\u001f]/.test(name)) {
    throw new HttpError(400, "Tên phải từ 1 đến 64 ký tự");
  }
  const genesisPrompt = typeof body.genesisPrompt === "string" ? body.genesisPrompt.trim() : "";
  if (!genesisPrompt || genesisPrompt.length > MAX_GENESIS_CHARS) {
    throw new HttpError(400, `Genesis prompt phải từ 1 đến ${MAX_GENESIS_CHARS} ký tự`);
  }
  const creatorAddress = typeof body.creatorAddress === "string" ? body.creatorAddress.trim() : "";
  if (!isValidAddress(creatorAddress, "evm")) {
    throw new HttpError(400, "Địa chỉ creator phải là địa chỉ ví EVM hợp lệ (0x...)");
  }
  const anthropicApiKey = cleanSecret(body.anthropicApiKey, "sk-ant-", "Anthropic key");
  const openaiApiKey = cleanSecret(body.openaiApiKey, "sk-", "OpenAI key");
  const ollamaBaseUrl = cleanUrl(body.ollamaBaseUrl);

  const { chainIdentity, chainType } = await getWallet("evm");
  const walletAddress = chainIdentity.address;
  const env = detectEnvironment();

  const config = createConfig({
    name,
    genesisPrompt,
    creatorAddress,
    registeredWithConway: Boolean(loadApiKeyFromConfig()),
    sandboxId: env.sandboxId,
    walletAddress,
    apiKey: loadApiKeyFromConfig() ?? "",
    openaiApiKey: openaiApiKey ?? undefined,
    anthropicApiKey: anthropicApiKey ?? undefined,
    ollamaBaseUrl: ollamaBaseUrl ?? undefined,
    treasuryPolicy: DEFAULT_TREASURY_POLICY,
    chainType,
  });
  saveConfig(config);
  writeDefaultHeartbeatConfig();

  const dir = getAutomatonDir();
  const constitutionSrc = path.join(repoRoot, "constitution.md");
  if (fs.existsSync(constitutionSrc)) {
    const dst = path.join(dir, "constitution.md");
    if (fs.existsSync(dst)) fs.chmodSync(dst, 0o644); // allow overwrite of a read-only copy
    fs.copyFileSync(constitutionSrc, dst);
    fs.chmodSync(dst, 0o444);
  }
  fs.writeFileSync(
    path.join(dir, "SOUL.md"),
    generateSoulMd(name, walletAddress, creatorAddress, genesisPrompt),
    { mode: 0o600 },
  );
  installDefaultSkills(config.skillsDir || "~/.automaton/skills");

  return { walletAddress };
}

/** Register the wallet with Conway (SIWE) and store the resulting API key. */
export async function provisionConway(): Promise<{ keyPrefix: string }> {
  if (!fs.existsSync(getWalletPath())) {
    throw new HttpError(409, "Chưa có ví. Hoàn tất bước tạo cấu hình trước.");
  }
  try {
    const result = await provision();
    syncConwayKeyIntoConfig(result.apiKey);
    return { keyPrefix: result.keyPrefix };
  } catch (err) {
    throw new HttpError(502, `Đăng ký Conway thất bại: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Store a Conway key the user already has. */
export function saveManualConwayKey(value: unknown): void {
  const key = cleanSecret(value, "cnwy_k_", "Conway key");
  if (!key) throw new HttpError(400, "Chưa nhập Conway key");
  const dir = getAutomatonDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const address = loadConfig()?.walletAddress ?? "";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ apiKey: key, walletAddress: address, provisionedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
  syncConwayKeyIntoConfig(key);
}

function syncConwayKeyIntoConfig(apiKey: string): void {
  const config = loadConfig();
  if (!config) return; // run() also falls back to config.json, so this is best-effort
  config.conwayApiKey = apiKey;
  config.registeredWithConway = true;
  saveConfig(config);
}

// ─── Agent process control ──────────────────────────────────────

const pidFile = () => path.join(getAutomatonDir(), "agent.pid");
const logFile = () => path.join(getAutomatonDir(), "agent.log");

function readPid(): { pid: number; startedAt: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(pidFile(), "utf-8"));
    return Number.isInteger(raw.pid) ? raw : null;
  } catch {
    return null;
  }
}

/** True only if the pid is alive AND is our agent entrypoint (guards against pid reuse). */
function isAgentProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    // Linux (incl. slim containers without procps): read the command line directly.
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0").join(" ");
    return cmd.includes(agentEntry);
  } catch {
    // macOS has no /proc.
  }
  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf-8" });
    return cmd.includes(agentEntry);
  } catch {
    return false;
  }
}

export function agentStatus(): { running: boolean; pid: number | null; startedAt: string | null } {
  const rec = readPid();
  if (rec && isAgentProcess(rec.pid)) {
    return { running: true, pid: rec.pid, startedAt: rec.startedAt };
  }
  return { running: false, pid: null, startedAt: null };
}

export function agentLogs(maxLines: number): string {
  const file = logFile();
  if (!fs.existsSync(file)) return "";
  const size = fs.statSync(file).size;
  const len = Math.min(size, 96 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf-8").split("\n").slice(-maxLines).join("\n");
  } finally {
    fs.closeSync(fd);
  }
}

export async function startAgent(): Promise<{ pid: number }> {
  if (agentStatus().running) throw new HttpError(409, "Agent đang chạy");
  if (!fs.existsSync(getConfigPath())) {
    throw new HttpError(409, "Chưa có cấu hình. Hoàn tất bước cài đặt trước.");
  }
  if (!conwayKey()) {
    throw new HttpError(
      409,
      "Chưa có Conway API key. Agent sẽ thoát ngay nếu thiếu. Hãy đăng ký Conway hoặc nhập key ở bước cài đặt.",
    );
  }
  if (!fs.existsSync(agentEntry)) {
    throw new HttpError(500, "Chưa build dự án (thiếu dist/index.js). Chạy pnpm build.");
  }

  const dir = getAutomatonDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(logFile(), "a", 0o600);
  // cwd = repo root: the agent's self-modification sandbox is its working directory.
  const child = spawn(process.execPath, [agentEntry, "--run"], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  fs.closeSync(fd);

  const exitedEarly = await new Promise<boolean>((resolve) => {
    child.once("exit", () => resolve(true));
    child.once("error", () => resolve(true));
    setTimeout(() => resolve(false), 1500);
  });
  if (exitedEarly || !child.pid) {
    const tail = agentLogs(8);
    throw new HttpError(500, `Agent thoát ngay sau khi khởi động.\n${tail}`);
  }
  child.unref();
  fs.writeFileSync(
    pidFile(),
    JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  return { pid: child.pid };
}

export async function stopAgent(force: boolean): Promise<{ stopped: boolean }> {
  const rec = readPid();
  if (!rec || !isAgentProcess(rec.pid)) {
    fs.rmSync(pidFile(), { force: true });
    return { stopped: true };
  }
  process.kill(rec.pid, force ? "SIGKILL" : "SIGTERM");
  const deadline = Date.now() + (force ? 3000 : 8000);
  while (Date.now() < deadline) {
    if (!isAgentProcess(rec.pid)) {
      fs.rmSync(pidFile(), { force: true });
      return { stopped: true };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { stopped: false };
}

// ─── Funding info ───────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Quá thời gian chờ")), ms)),
  ]);
}

/**
 * Where to send funds and what the agent currently holds. Read-only: it never
 * moves money. Each balance fails independently so one outage does not hide the other.
 */
export async function fundingInfo(): Promise<Record<string, unknown>> {
  const config = loadConfig();
  if (!config) throw new HttpError(409, "Chưa có cấu hình.");
  const address = config.walletAddress;

  const usdc = withTimeout(
    getUsdcBalanceDetailed(address as `0x${string}`).then((r) => {
      if (!r.ok) throw new Error(r.error || "Không đọc được số dư USDC");
      return r.balance;
    }),
    12_000,
  );
  const credits = withTimeout(
    (async () => {
      const key = conwayKey();
      if (!key) throw new Error("Chưa có Conway key");
      const client = createConwayClient({ apiUrl: config.conwayApiUrl, apiKey: key, sandboxId: "" });
      return client.getCreditsBalance();
    })(),
    12_000,
  );
  const [u, c] = await Promise.allSettled([usdc, credits]);
  // First line only: viem errors run to many lines of request details.
  const msg = (r: PromiseRejectedResult) =>
    (r.reason instanceof Error ? r.reason.message : String(r.reason)).split("\n")[0].slice(0, 140);
  return {
    address,
    network: "Base",
    usdc: u.status === "fulfilled" ? u.value : null,
    usdcError: u.status === "rejected" ? msg(u) : null,
    creditsCents: c.status === "fulfilled" ? c.value : null,
    creditsError: c.status === "rejected" ? msg(c) : null,
    checkedAt: new Date().toISOString(),
  };
}
