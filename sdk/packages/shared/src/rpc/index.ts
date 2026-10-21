// Segra Desktop uses its own hub port so it never attaches to an installed Cline hub (25463).
export const CLINE_HUB_PORT = 25473;
export const CLINE_HUB_DEV_PORT = 25466; // USED IN DEV ENV ONLY, to avoid conflicts with production CLINE HUB
export const CLINE_DEFAULT_RPC_PORT = 4317;
export const RPC_ADDRESS_BASE = "127.0.0.1";
export const CLINE_DEFAULT_RPC_ADDRESS = `${RPC_ADDRESS_BASE}:${CLINE_DEFAULT_RPC_PORT}`;
