export const homedir = () => "/home";
export const hostname = () => "android";
export const platform = () => "android";
export const tmpdir = () => "/tmp";
export const networkInterfaces = () => { throw new Error("Non disponible dans l'app."); };
export default { homedir, hostname, platform, tmpdir, networkInterfaces };
