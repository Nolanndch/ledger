// node:http, node:dgram, node:child_process, node:url : inutiles dans l'app (pas de serveur, découverte native).
const no = () => { throw new Error("Non disponible dans l'app."); };
export const createServer = no, createSocket = no, execFileSync = no, spawn = no, fileURLToPath = no;
export default { createServer, createSocket, execFileSync, spawn, fileURLToPath };
