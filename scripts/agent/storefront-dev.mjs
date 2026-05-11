import childProcess from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";

const DEFAULT_DEV_URL = "http://127.0.0.1:9292";
const DEFAULT_PORT_FALLBACK = { strategy: "kill-shopify-only", incrementMax: 5 };
const TMP_REL_DIR = "tmp";
const PIDFILE_REL = "tmp/storefront-dev.pid";
const PORTFILE_REL = "tmp/storefront-dev.port";
const METAFILE_REL = "tmp/storefront-dev.json";
const LOGFILE_REL = "tmp/storefront-dev.log";
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_POLL_TIMEOUT_MS = 60000;
const STOP_GRACE_MS = 5000;
const PROBE_TIMEOUT_MS = 1500;

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOrNull(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

async function loadAgentToolsConfig(rootDir) {
  return readJsonOrNull(path.join(rootDir, "harness/config/agent-tools.json"));
}

function resolveStorefrontConfig(agentToolsConfig) {
  const sf = agentToolsConfig?.storefront ?? {};
  const devUrl = sf.devUrl ?? DEFAULT_DEV_URL;
  const password = sf.password ?? null;
  const themeId = sf.themeId ?? null;
  const portFallback = { ...DEFAULT_PORT_FALLBACK, ...(sf.portFallback ?? {}) };
  let port;
  try {
    port = Number(new URL(devUrl).port) || 9292;
  } catch {
    port = 9292;
  }
  return { devUrl, password, themeId, portFallback, port };
}

function paths(rootDir) {
  return {
    tmpDir: path.join(rootDir, TMP_REL_DIR),
    pidFile: path.join(rootDir, PIDFILE_REL),
    portFile: path.join(rootDir, PORTFILE_REL),
    metaFile: path.join(rootDir, METAFILE_REL),
    logFile: path.join(rootDir, LOGFILE_REL)
  };
}

async function probeHttpReady(port) {
  const url = `http://127.0.0.1:${port}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "manual" });
    return { reachable: true, status: res.status };
  } catch (error) {
    return { reachable: false, error: error.code ?? error.name ?? "fetch-failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, family: 4 });
    let settled = false;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

function listLisenersOnPort(port) {
  // lsof returns 0 with newline-separated `pXXXXX` lines per holding PID, exit 1 with empty stdout when nothing matches.
  const result = childProcess.spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "p"],
    { encoding: "utf8" }
  );
  if (result.status !== 0 && !result.stdout) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("p"))
    .map((line) => Number(line.slice(1)))
    .filter((pid) => Number.isFinite(pid));
}

function commandLineForPid(pid) {
  // `ps -o command= -p PID` works on both macOS and Linux. Empty stdout means PID is gone.
  const result = childProcess.spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // exists but not ours
  }
}

function isShopifyCommand(commandLine) {
  if (!commandLine) return false;
  // The CLI invokes itself as `node .../shopify`, `ruby .../shopify-cli`, `shopify theme dev`, etc.
  return /\bshopify\b/i.test(commandLine);
}

async function ensureTmpDir(rootDir) {
  await fs.mkdir(paths(rootDir).tmpDir, { recursive: true });
}

async function writeStateFiles(rootDir, { pid, port, command, devUrl, themeId, passwordSource }) {
  const p = paths(rootDir);
  await fs.writeFile(p.pidFile, `${pid}\n`, "utf8");
  await fs.writeFile(p.portFile, `${port}\n`, "utf8");
  await fs.writeFile(
    p.metaFile,
    `${JSON.stringify(
      {
        pid,
        port,
        command,
        devUrl,
        themeId,
        passwordSource,
        startedAt: new Date().toISOString(),
        logPath: path.relative(rootDir, p.logFile)
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function clearStateFiles(rootDir) {
  const p = paths(rootDir);
  for (const f of [p.pidFile, p.portFile, p.metaFile]) {
    try {
      await fs.unlink(f);
    } catch {
      // ignore
    }
  }
}

async function readStoredPid(rootDir) {
  const p = paths(rootDir);
  if (!(await pathExists(p.pidFile))) return null;
  const txt = (await fs.readFile(p.pidFile, "utf8")).trim();
  const pid = Number(txt);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

async function readStoredMeta(rootDir) {
  return readJsonOrNull(paths(rootDir).metaFile);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(port, timeoutMs = HEALTH_POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeHttpReady(port);
    if (probe.reachable) return probe;
    await delay(HEALTH_POLL_INTERVAL_MS);
  }
  return { reachable: false, error: "timeout" };
}

function buildShopifyArgs({ port, themeId, password, devUrl }) {
  const host = "127.0.0.1";
  let parsedHost = host;
  try {
    parsedHost = new URL(devUrl).hostname || host;
  } catch {
    // ignore, use default
  }
  const args = ["theme", "dev", "--host", parsedHost, "--port", String(port)];
  if (themeId) args.push("--theme", String(themeId));
  if (password) args.push("--store-password", String(password));
  return args;
}

function resolveStrategyKill({ strategy, listeners, allowSelf, currentPid }) {
  // Returns { action: "use-port" | "kill-and-use" | "increment" | "fail", killPids: [], reason: "..." }
  if (listeners.length === 0) return { action: "use-port", killPids: [], reason: "port-free" };

  const filtered = allowSelf ? listeners.filter((p) => p !== currentPid) : listeners;
  if (filtered.length === 0) return { action: "use-port", killPids: [], reason: "self-only" };

  const inspections = filtered.map((pid) => ({ pid, command: commandLineForPid(pid) }));
  const allShopify = inspections.every((i) => isShopifyCommand(i.command));

  if (strategy === "fail") {
    return { action: "fail", killPids: [], reason: "strategy-fail", inspections };
  }
  if (strategy === "kill-shopify-only") {
    if (allShopify) {
      return { action: "kill-and-use", killPids: filtered, reason: "all-listeners-shopify", inspections };
    }
    return { action: "fail", killPids: [], reason: "non-shopify-listener", inspections };
  }
  if (strategy === "increment") {
    return { action: "increment", killPids: [], reason: "increment-requested", inspections };
  }
  return { action: "fail", killPids: [], reason: `unknown-strategy:${strategy}`, inspections };
}

async function killAndWait(pid, timeoutMs = STOP_GRACE_MS) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { killed: false, error: "no-such-process" };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return { killed: true, signal: "SIGTERM" };
    await delay(100);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
  await delay(200);
  return { killed: !isProcessAlive(pid), signal: "SIGKILL" };
}

function envForShopify({ password }) {
  const env = { ...process.env };
  if (password) env.SHOPIFY_CLI_STOREFRONT_PASSWORD = password;
  return env;
}

function passwordSource({ password, agentToolsConfig }) {
  if (!password) return "none";
  return agentToolsConfig?.storefront?.password === password ? "agent-tools.json" : "argv";
}

export async function startStorefrontDev({
  rootDir,
  shopifyCmd = "shopify",
  foreground = false,
  portOverride = null,
  storefrontConfigOverride = null,
  agentToolsConfigOverride = null
} = {}) {
  rootDir = path.resolve(rootDir ?? process.cwd());
  const agentToolsConfig = agentToolsConfigOverride ?? (await loadAgentToolsConfig(rootDir));
  const cfg = storefrontConfigOverride ?? resolveStorefrontConfig(agentToolsConfig);
  const startingPort = portOverride ?? cfg.port;
  const incrementMax = cfg.portFallback?.incrementMax ?? DEFAULT_PORT_FALLBACK.incrementMax;
  const strategy = cfg.portFallback?.strategy ?? DEFAULT_PORT_FALLBACK.strategy;

  await ensureTmpDir(rootDir);

  // If a previous storefront-dev run owns the port, reuse-or-restart.
  const storedPid = await readStoredPid(rootDir);
  if (storedPid && isProcessAlive(storedPid)) {
    const meta = await readStoredMeta(rootDir);
    const probe = await probeHttpReady(meta?.port ?? startingPort);
    if (probe.reachable) {
      return {
        status: "already-running",
        port: meta?.port ?? startingPort,
        pid: storedPid,
        passwordSource: meta?.passwordSource ?? "unknown",
        logPath: path.relative(rootDir, paths(rootDir).logFile)
      };
    }
  }
  // Fall through: stale pidfile or unreachable storefront → start fresh.
  if (storedPid) await clearStateFiles(rootDir);

  let port = startingPort;
  let attempt = 0;
  const portTrace = [];
  while (true) {
    const listeners = listLisenersOnPort(port);
    const decision = resolveStrategyKill({
      strategy,
      listeners,
      allowSelf: false,
      currentPid: process.pid
    });
    portTrace.push({ port, listeners, decision });
    if (decision.action === "use-port") break;
    if (decision.action === "kill-and-use") {
      for (const pid of decision.killPids) {
        await killAndWait(pid);
      }
      // confirm port now free
      const after = listLisenersOnPort(port);
      if (after.length === 0) break;
      // still occupied → fall through to fail
      return {
        status: "failed",
        code: "PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS",
        reason: "kill-targets-still-listening-after-sigkill",
        port,
        portTrace
      };
    }
    if (decision.action === "fail") {
      return {
        status: "failed",
        code: "PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS",
        reason: decision.reason,
        port,
        portTrace
      };
    }
    if (decision.action === "increment") {
      attempt += 1;
      if (attempt > incrementMax) {
        return {
          status: "failed",
          code: "PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS",
          reason: "increment-budget-exhausted",
          port,
          portTrace
        };
      }
      port += 1;
      continue;
    }
    return { status: "failed", code: "PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS", reason: decision.reason, port, portTrace };
  }

  const args = buildShopifyArgs({ port, themeId: cfg.themeId, password: cfg.password, devUrl: cfg.devUrl });
  const env = envForShopify({ password: cfg.password });

  const p = paths(rootDir);
  let logFd;
  try {
    logFd = fsSync.openSync(p.logFile, "a");
  } catch (error) {
    return { status: "failed", code: "STOREFRONT_LOG_OPEN_FAILED", reason: error.message };
  }

  const child = childProcess.spawn(shopifyCmd, args, {
    cwd: rootDir,
    env,
    detached: !foreground,
    stdio: foreground ? "inherit" : ["ignore", logFd, logFd]
  });

  if (typeof child.pid !== "number") {
    fsSync.closeSync(logFd);
    return { status: "failed", code: "STOREFRONT_SPAWN_FAILED", reason: "child has no pid" };
  }

  // Detach so storefront-dev can exit while the child keeps running.
  if (!foreground) child.unref();

  await writeStateFiles(rootDir, {
    pid: child.pid,
    port,
    command: `${shopifyCmd} ${args.join(" ")}`,
    devUrl: cfg.devUrl,
    themeId: cfg.themeId,
    passwordSource: passwordSource({ password: cfg.password, agentToolsConfig })
  });

  if (foreground) {
    return { status: "running", port, pid: child.pid, foreground: true };
  }

  // Background: wait until the storefront answers HTTP before reporting running.
  const ready = await waitForReady(port);
  fsSync.closeSync(logFd);

  if (!ready.reachable) {
    // The child is running but never went healthy. Surface the log path so the operator can debug.
    return {
      status: "failed",
      code: "STOREFRONT_HEALTH_TIMEOUT",
      reason: ready.error,
      port,
      pid: child.pid,
      logPath: path.relative(rootDir, p.logFile)
    };
  }

  return {
    status: "running",
    port,
    pid: child.pid,
    httpStatus: ready.status,
    passwordSource: passwordSource({ password: cfg.password, agentToolsConfig }),
    logPath: path.relative(rootDir, p.logFile),
    portTrace
  };
}

export async function statusStorefrontDev({ rootDir } = {}) {
  rootDir = path.resolve(rootDir ?? process.cwd());
  const storedPid = await readStoredPid(rootDir);
  const meta = await readStoredMeta(rootDir);
  const port = meta?.port ?? null;

  if (!storedPid) {
    if (port != null) {
      const listeners = listLisenersOnPort(port);
      if (listeners.length > 0) {
        const inspections = listeners.map((pid) => ({ pid, command: commandLineForPid(pid) }));
        return { status: "port-in-use-by-foreign", port, listeners: inspections };
      }
    }
    return { status: "stopped" };
  }

  const alive = isProcessAlive(storedPid);
  if (!alive) {
    return { status: "stale-pidfile", pid: storedPid, port };
  }
  const probe = port == null ? { reachable: false, error: "no-port" } : await probeHttpReady(port);
  if (probe.reachable) {
    return { status: "running", pid: storedPid, port, httpStatus: probe.status, meta };
  }
  return { status: "running-but-unreachable", pid: storedPid, port, error: probe.error };
}

export async function stopStorefrontDev({ rootDir } = {}) {
  rootDir = path.resolve(rootDir ?? process.cwd());
  const storedPid = await readStoredPid(rootDir);
  if (!storedPid) {
    await clearStateFiles(rootDir);
    return { status: "stopped", reason: "no-pidfile" };
  }
  if (!isProcessAlive(storedPid)) {
    await clearStateFiles(rootDir);
    return { status: "stopped", reason: "process-already-gone", pid: storedPid };
  }
  const result = await killAndWait(storedPid);
  await clearStateFiles(rootDir);
  return { status: "stopped", killed: result.killed, signal: result.signal, pid: storedPid };
}

export async function restartStorefrontDev(opts = {}) {
  await stopStorefrontDev({ rootDir: opts.rootDir });
  return startStorefrontDev(opts);
}

function parseArgs(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const opts = { rootDir: process.cwd(), foreground: false, port: null, format: "json", shopifyCmd: "shopify" };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--root" && rest[i + 1]) opts.rootDir = path.resolve(rest[++i]);
    else if (arg.startsWith("--root=")) opts.rootDir = path.resolve(arg.slice("--root=".length));
    else if (arg === "--port" && rest[i + 1]) opts.port = Number(rest[++i]);
    else if (arg.startsWith("--port=")) opts.port = Number(arg.slice("--port=".length));
    else if (arg === "--foreground") opts.foreground = true;
    else if (arg === "--text") opts.format = "text";
    else if (arg === "--json") opts.format = "json";
    else if (arg === "--cmd" && rest[i + 1]) opts.shopifyCmd = rest[++i];
    else if (arg.startsWith("--cmd=")) opts.shopifyCmd = arg.slice("--cmd=".length);
  }
  return { sub, opts };
}

function formatText(result) {
  if (result.status === "running" || result.status === "already-running") {
    return `${result.status} pid=${result.pid} port=${result.port} log=${result.logPath ?? "?"}`;
  }
  if (result.status === "stopped") {
    return `stopped${result.pid ? ` pid=${result.pid}` : ""}${result.signal ? ` signal=${result.signal}` : ""}`;
  }
  if (result.status === "failed") {
    return `failed code=${result.code} reason=${result.reason} port=${result.port ?? "?"}`;
  }
  return JSON.stringify(result);
}

if (isMainModule(import.meta.url)) {
  const { sub, opts } = parseArgs(process.argv.slice(2));
  let result;
  try {
    if (sub === "start") {
      result = await startStorefrontDev({
        rootDir: opts.rootDir,
        foreground: opts.foreground,
        portOverride: opts.port,
        shopifyCmd: opts.shopifyCmd
      });
    } else if (sub === "stop") {
      result = await stopStorefrontDev({ rootDir: opts.rootDir });
    } else if (sub === "status") {
      result = await statusStorefrontDev({ rootDir: opts.rootDir });
    } else if (sub === "restart") {
      result = await restartStorefrontDev({
        rootDir: opts.rootDir,
        foreground: opts.foreground,
        portOverride: opts.port,
        shopifyCmd: opts.shopifyCmd
      });
    } else {
      process.stderr.write(
        "Usage: storefront-dev <start|stop|status|restart> [--root <path>] [--port <n>] [--cmd <bin>] [--foreground] [--json|--text]\n"
      );
      process.exit(2);
    }
  } catch (error) {
    result = { status: "failed", code: "STOREFRONT_INTERNAL_ERROR", reason: error.message };
  }
  if (opts.format === "text") {
    process.stdout.write(`${formatText(result)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  const exitOk = result.status === "running" || result.status === "already-running" || result.status === "stopped";
  process.exit(exitOk ? 0 : 1);
}
