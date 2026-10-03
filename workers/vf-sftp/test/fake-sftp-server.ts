import ssh2 from "ssh2";
import type { AddressInfo } from "node:net";
import { timingSafeEqual } from "node:crypto";

/**
 * **An SFTP server of the tests' own — decision 0620.** ssh2's server, its
 * files held in memory, so the runner is proved against a real SSH
 * handshake, real sign-in and the real SFTP protocol, with nothing to
 * install. It knows files and folders, and enough of SFTP for what the
 * runner does: list, stat, read, write, rename, make a folder, remove.
 */

const { Server, utils } = ssh2;
const { STATUS_CODE, OPEN_MODE } = utils.sftp;

const FILE = 0o100644;
const DIR = 0o040755;

export interface FakeServer {
  port: number;
  /** The server's own host key, as `run` reports it. */
  hostKeyFingerprint: string;
  files: Map<string, Buffer>;
  folders: Set<string>;
  /** Folders where writing is refused, to prove `permission_denied`. */
  readOnly: Set<string>;
  close(): Promise<void>;
}

const parent = (path: string) => path.replace(/\/[^/]+$/, "") || "/";

export async function startFakeSftpServer(opts: {
  username: string;
  password?: string;
  publicKey?: string;
  hostKey: string;
  hostKeyFingerprint: string;
}): Promise<FakeServer> {
  const files = new Map<string, Buffer>();
  const folders = new Set<string>(["/"]);
  const readOnly = new Set<string>();
  const allowedKey = opts.publicKey ? utils.parseKey(opts.publicKey) : null;

  const server = new Server({ hostKeys: [opts.hostKey] }, (client) => {
    client.on("authentication", (ctx) => {
      if (ctx.username !== opts.username) return ctx.reject();
      if (ctx.method === "password" && opts.password !== undefined) {
        const a = Buffer.from(ctx.password);
        const b = Buffer.from(opts.password);
        return a.length === b.length && timingSafeEqual(a, b) ? ctx.accept() : ctx.reject();
      }
      if (ctx.method === "publickey" && allowedKey && !(allowedKey instanceof Error)) {
        const key = Array.isArray(allowedKey) ? allowedKey[0] : allowedKey;
        if (ctx.key.algo !== key.type || !key.getPublicSSH().equals(ctx.key.data)) return ctx.reject();
        if (ctx.signature) return key.verify(ctx.blob as Buffer, ctx.signature, ctx.hashAlgo) ? ctx.accept() : ctx.reject();
        return ctx.accept();
      }
      return ctx.reject(opts.password !== undefined ? ["password"] : ["publickey"]);
    });
    client.on("error", () => undefined);
    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        const session = acceptSession();
        session.on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<number, { path: string; kind: "file" | "dir"; data: Buffer[]; read?: boolean; writing: boolean }>();
          let next = 0;
          const handle = (h: Buffer) => handles.get(h.readUInt32BE(0));
          const newHandle = (value: { path: string; kind: "file" | "dir"; data: Buffer[]; writing: boolean }) => {
            const id = next++;
            handles.set(id, value);
            const b = Buffer.alloc(4);
            b.writeUInt32BE(id, 0);
            return b;
          };
          const attrsOf = (path: string) => {
            if (folders.has(path)) return { mode: DIR, size: 0, uid: 0, gid: 0, atime: 0, mtime: 1_700_000_000 };
            const f = files.get(path);
            return f ? { mode: FILE, size: f.length, uid: 0, gid: 0, atime: 0, mtime: 1_700_000_000 } : null;
          };

          sftp.on("OPEN", (reqid, filename, flags) => {
            const writing = (flags & OPEN_MODE.WRITE) !== 0;
            if (writing) {
              if (!folders.has(parent(filename))) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
              if (readOnly.has(parent(filename))) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              return sftp.handle(reqid, newHandle({ path: filename, kind: "file", data: [], writing: true }));
            }
            if (!files.has(filename)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            return sftp.handle(reqid, newHandle({ path: filename, kind: "file", data: [], writing: false }));
          });
          sftp.on("WRITE", (reqid, h, offset, data) => {
            const f = handle(h);
            if (!f) return sftp.status(reqid, STATUS_CODE.FAILURE);
            f.data.push(Buffer.from(data));
            return sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("READ", (reqid, h, offset, length) => {
            const f = handle(h);
            const content = f ? files.get(f.path) : undefined;
            if (!content) return sftp.status(reqid, STATUS_CODE.FAILURE);
            if (offset >= content.length) return sftp.status(reqid, STATUS_CODE.EOF);
            return sftp.data(reqid, content.subarray(offset, offset + length));
          });
          sftp.on("FSTAT", (reqid, h) => {
            const f = handle(h);
            const attrs = f ? attrsOf(f.path) : null;
            return attrs ? sftp.attrs(reqid, attrs) : sftp.status(reqid, STATUS_CODE.FAILURE);
          });
          sftp.on("CLOSE", (reqid, h) => {
            const f = handle(h);
            if (f?.writing) files.set(f.path, Buffer.concat(f.data));
            handles.delete(h.readUInt32BE(0));
            return sftp.status(reqid, STATUS_CODE.OK);
          });
          const stat = (reqid: number, path: string) => {
            const attrs = attrsOf(path);
            return attrs ? sftp.attrs(reqid, attrs) : sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
          };
          sftp.on("STAT", stat);
          sftp.on("LSTAT", stat);
          sftp.on("OPENDIR", (reqid, path) => {
            if (!folders.has(path)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            return sftp.handle(reqid, newHandle({ path, kind: "dir", data: [], writing: false }));
          });
          sftp.on("READDIR", (reqid, h) => {
            const d = handle(h);
            if (!d || d.read) return sftp.status(reqid, STATUS_CODE.EOF);
            d.read = true;
            const prefix = d.path === "/" ? "/" : `${d.path}/`;
            const children = [
              ...[...files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")),
              ...[...folders].filter((p) => p !== d.path && p.startsWith(prefix) && !p.slice(prefix.length).includes("/")),
            ];
            if (children.length === 0) return sftp.status(reqid, STATUS_CODE.EOF);
            return sftp.name(
              reqid,
              children.map((p) => ({ filename: p.slice(prefix.length), longname: p.slice(prefix.length), attrs: attrsOf(p)! }))
            );
          });
          sftp.on("RENAME", (reqid, from, to) => {
            if (!files.has(from) && !folders.has(from)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            if (files.has(to) || folders.has(to)) return sftp.status(reqid, STATUS_CODE.FAILURE);
            if (!folders.has(parent(to))) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            if (readOnly.has(parent(to)) || readOnly.has(parent(from))) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            files.set(to, files.get(from)!);
            files.delete(from);
            return sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("REMOVE", (reqid, path) => {
            if (!files.delete(path)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            return sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("MKDIR", (reqid, path) => {
            if (folders.has(path) || files.has(path)) return sftp.status(reqid, STATUS_CODE.FAILURE);
            if (!folders.has(parent(path))) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            if (readOnly.has(parent(path))) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            folders.add(path);
            return sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("REALPATH", (reqid, path) => sftp.name(reqid, [{ filename: path === "." ? "/" : path, longname: path, attrs: {} as never }]));
        });
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    hostKeyFingerprint: opts.hostKeyFingerprint,
    files,
    folders,
    readOnly,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
