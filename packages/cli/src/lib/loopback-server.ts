import { createServer, type Server } from "node:http";

export interface LoopbackCallback {
  code: string;
  state: string;
}

export class LoopbackTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for the browser to approve this connection.");
    this.name = "LoopbackTimeoutError";
  }
}

export interface LoopbackServer {
  port: number;
  redirectUri: string;
  waitForCallback(timeoutMs: number): Promise<LoopbackCallback>;
  close(): Promise<void>;
}

// Binds to 127.0.0.1 only, never 0.0.0.0, so it's reachable only from
// this machine, never the network. This is the CLI's half of the RFC
// 8252 loopback flow the dashboard's /cli/authorize page (M14) already
// implements the other half of. See
// docs/architecture/cli-onboarding-design.md.
export function startLoopbackServer(): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    let resolveCallback: ((callback: LoopbackCallback) => void) | undefined;
    let rejectCallback: ((error: Error) => void) | undefined;
    const callbackPromise = new Promise<LoopbackCallback>((res, rej) => {
      resolveCallback = res;
      rejectCallback = rej;
    });

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<html><body><p>Connected. You can close this tab and return to your terminal.</p></body></html>",
      );

      if (code && state) {
        resolveCallback?.({ code, state });
      } else {
        rejectCallback?.(
          new Error("The browser did not return a valid connection code."),
        );
      }
    });

    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      resolve({
        port,
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCallback(timeoutMs: number): Promise<LoopbackCallback> {
          return Promise.race([
            callbackPromise,
            new Promise<LoopbackCallback>((_res, rej) => {
              setTimeout(() => rej(new LoopbackTimeoutError()), timeoutMs);
            }),
          ]);
        },
        close(): Promise<void> {
          return new Promise((res) => server.close(() => res()));
        },
      });
    });
  });
}
