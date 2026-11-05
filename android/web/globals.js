// Ce que les modules du serveur attendent de Node, avant tout le reste.
import { Buffer } from "buffer";
globalThis.Buffer = Buffer;
globalThis.process = { platform: "android", env: { LEDGER_DATA_DIR: "/ledger" }, pid: 1, ppid: 0, argv: [], on() {} };
