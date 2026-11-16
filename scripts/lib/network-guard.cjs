/**
 * Guard de rede para provas de independência: registra e bloqueia qualquer conexão TCP que não seja
 * para o próprio host (loopback) e qualquer conexão à porta 4000 (servidor NestJS legado).
 * Uso: NODE_OPTIONS="--require <este arquivo>" NETWORK_GUARD_LOG=<arquivo>
 */
const net = require("node:net");
const fs = require("node:fs");

const logFile = process.env.NETWORK_GUARD_LOG;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "::ffff:127.0.0.1"]);
const originalConnect = net.Socket.prototype.connect;

function describeTarget(rawArgs) {
  // Internamente o Node chama socket.connect([options, callback]) (argumentos já normalizados).
  const args = Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs;
  const first = args[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    if (first.path) return { local: true, label: `unix:${first.path}` };
    return { host: String(first.host ?? "localhost"), port: Number(first.port) };
  }
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    return { host: typeof args[1] === "string" ? args[1] : "localhost", port: Number(first) };
  }
  return { local: true, label: "pipe" };
}

net.Socket.prototype.connect = function patchedConnect(...args) {
  const target = describeTarget(args);
  if (!target.local) {
    const loopback = LOOPBACK.has(target.host);
    if (!loopback || target.port === 4000) {
      const line = `${new Date().toISOString()} BLOQUEADO ${target.host}:${target.port}\n`;
      if (logFile) fs.appendFileSync(logFile, line);
      const error = new Error(`network-guard: conexão bloqueada para ${target.host}:${target.port}`);
      error.code = "ENETGUARD";
      process.nextTick(() => this.destroy(error));
      return this;
    }
  }
  return originalConnect.apply(this, args);
};
