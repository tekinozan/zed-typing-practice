/** Minimal LSP istemcisi: e2e testinde `node dist/server.js --stdio` çocuğunu sürer. */
import { spawn } from "node:child_process";

export class LspClient {
  constructor(serverPath, env) {
    this.proc = spawn(process.execPath, [serverPath, "--stdio"], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    /** Sunucudan gelen istekler (workspace/applyEdit gibi). */
    this.requests = [];
    /** Sunucudan gelen bildirimler. */
    this.notifications = [];
    this.waiters = [];
    this.stderr = "";
    this.closed = false;

    // Sunucu kapandıktan sonra kuyruktaki yazmalar EPIPE fırlatmasın.
    this.proc.stdin.on("error", () => {});
    this.proc.on("exit", () => {
      this.closed = true;
    });
    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk) => {
      this.stderr += String(chunk);
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      this.dispatch(JSON.parse(body));
    }
  }

  dispatch(msg) {
    if (msg.id !== undefined && msg.method === undefined) {
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(msg);
      }
    } else if (msg.id !== undefined) {
      this.requests.push(msg);
    } else {
      this.notifications.push(msg);
    }
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  write(msg) {
    if (this.closed || this.proc.stdin.destroyed) return;
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin.write(body);
  }

  request(method, params) {
    const id = this.nextId++;
    const promise = new Promise((resolve) => this.pending.set(id, resolve));
    this.write({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  notify(method, params) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  respond(id, result) {
    this.write({ jsonrpc: "2.0", id, result });
  }

  /** `predicate` doğru olana kadar bekler; olay geldikçe yeniden dener. */
  async until(predicate, label, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = predicate();
      if (hit !== undefined && hit !== false && hit !== null) return hit;
      if (Date.now() > deadline) {
        throw new Error(
          `zaman aşımı: ${label}\nbildirimler: ${JSON.stringify(
            this.notifications.map((n) => n.method),
          )}\nstderr: ${this.stderr}`,
        );
      }
      await new Promise((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 20);
      });
    }
  }

  takeRequest(method, timeoutMs) {
    return this.until(
      () => {
        const idx = this.requests.findIndex((r) => r.method === method);
        return idx < 0 ? false : this.requests.splice(idx, 1)[0];
      },
      `istek ${method}`,
      timeoutMs,
    );
  }

  /** Son publishDiagnostics bildirimi (yoksa undefined). */
  lastDiagnostics(uri) {
    for (let i = this.notifications.length - 1; i >= 0; i--) {
      const n = this.notifications[i];
      if (n.method === "textDocument/publishDiagnostics" && n.params.uri === uri) {
        return n.params.diagnostics;
      }
    }
    return undefined;
  }

  clearNotifications() {
    this.notifications.length = 0;
  }

  /** Düzgün kapanış: shutdown/exit gönder, çıkışı bekle, gerekirse öldür. */
  async stop() {
    if (!this.closed) {
      await Promise.race([
        this.request("shutdown", null),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      this.notify("exit", null);
    }
    await new Promise((resolve) => {
      if (this.closed) return resolve();
      const timer = setTimeout(() => {
        this.proc.kill();
        resolve();
      }, 1500);
      this.proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.proc.stdout.removeAllListeners("data");
    this.proc.stderr.removeAllListeners("data");
  }
}
