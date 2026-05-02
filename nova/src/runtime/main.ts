import { startRelay } from "./start.js";
// Ensure WebSocket is available in Node runtimes that don't provide it globally
// (home-assistant-js-websocket expects a global WebSocket)
try {
  // Dynamically import to avoid impacting environments where WebSocket is already provided
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (typeof g.WebSocket === "undefined") {
    const { default: WS } = await import("ws");
    g.WebSocket = WS;
  }
} catch {
  // If import fails, startRelay will surface a clear error during bootstrap
}

startRelay().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(JSON.stringify({ level: "error", message: "Relay failed to start", context: { error: message } }));
  process.exit(1);
});
