/**
 * **The SFTP runner — decision 0620, the SFTP proof of concept.**
 *
 * A Worker can open a TCP connection to port 22, but SFTP needs a whole
 * SSH implementation, and none that is maintained runs inside a Worker.
 * So this small Node program, in a Cloudflare Container, does the SFTP:
 * vf-app asks over HTTP (through vf-sftp's Worker, by service binding)
 * for a list of operations on one server, and this signs in, does them
 * in order on one connection, and answers.
 *
 * It keeps nothing. The server's address, user and password or key come
 * with each request, from vf-app's encrypted connector secrets, and are
 * forgotten when the request ends.
 *
 * **The server's identity.** Every answer says the server's host key
 * fingerprint (`SHA256:…`, as OpenSSH prints it). Where the request names
 * the fingerprint it trusts, a different one is refused before signing in
 * (`host_key_changed`): that is how someone pretending to be the server is
 * kept from receiving a password or an invoice.
 */
import ssh2 from "ssh2";
import { createHash } from "node:crypto";

const { Client } = ssh2;

/** Largest file fetched in one `get`, 20 MB, the same cap an upload has (decision 0573). */
export const MAX_GET_BYTES = 20 * 1024 * 1024;

/** A host key as OpenSSH shows it: `SHA256:` and unpadded base64. */
export function fingerprint(key) {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

class RunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** An SFTP status code (draft-ietf-secsh-filexfer-02) as one of ours, with words. */
function fromSftp(err, what) {
  if (err instanceof RunnerError) return err;
  if (err && err.code === 2) return new RunnerError("not_found", `${what}: no such file or folder`);
  if (err && err.code === 3) return new RunnerError("permission_denied", `${what}: permission denied`);
  return new RunnerError("failed", `${what}: ${err?.message ?? String(err)}`);
}

const call = (fn) => new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));

/** One folder's entries: name, size, last changed, and whether it is a file. */
async function list(sftp, path) {
  try {
    const entries = await call((cb) => sftp.readdir(path, cb));
    return entries
      .filter((e) => e.filename !== "." && e.filename !== "..")
      .map((e) => ({
        name: e.filename,
        size: e.attrs.size ?? 0,
        modifiedAt: e.attrs.mtime ? new Date(e.attrs.mtime * 1000).toISOString() : null,
        isFile: ((e.attrs.mode ?? 0) & 0o170000) === 0o100000,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    throw fromSftp(err, `listing ${path}`);
  }
}

/**
 * **Written in full, then named** — so whoever reads the folder (an
 * ERP's import, say) never takes half a file: the bytes go to
 * `name.part`, which is renamed when complete. A file already there by
 * the final name is never overwritten (`exists`).
 */
async function put(sftp, path, contentBase64) {
  const temp = `${path}.part`;
  const bytes = Buffer.from(contentBase64 ?? "", "base64");
  try {
    await call((cb) => sftp.writeFile(temp, bytes, cb));
  } catch (err) {
    throw fromSftp(err, `writing ${temp}`);
  }
  try {
    await call((cb) => sftp.rename(temp, path, cb));
  } catch (err) {
    await call((cb) => sftp.unlink(temp, cb)).catch(() => undefined);
    const there = await call((cb) => sftp.stat(path, cb)).then(
      () => true,
      () => false
    );
    if (there) throw new RunnerError("exists", `${path} is already there, and is not overwritten`);
    throw fromSftp(err, `naming ${temp} as ${path}`);
  }
  return { path, bytes: bytes.length };
}

async function get(sftp, path) {
  let size;
  try {
    size = (await call((cb) => sftp.stat(path, cb))).size ?? 0;
  } catch (err) {
    throw fromSftp(err, `reading ${path}`);
  }
  if (size > MAX_GET_BYTES) throw new RunnerError("too_large", `${path} is ${size} bytes, more than the ${MAX_GET_BYTES} a file may be`);
  try {
    const bytes = await call((cb) => sftp.readFile(path, cb));
    return { path, bytes: bytes.length, contentBase64: Buffer.from(bytes).toString("base64") };
  } catch (err) {
    throw fromSftp(err, `reading ${path}`);
  }
}

async function move(sftp, from, to) {
  try {
    await call((cb) => sftp.rename(from, to, cb));
  } catch (err) {
    const there = await call((cb) => sftp.stat(to, cb)).then(
      () => true,
      () => false
    );
    if (there) throw new RunnerError("exists", `${to} is already there, and is not overwritten`);
    throw fromSftp(err, `moving ${from} to ${to}`);
  }
  return { from, to };
}

/** A folder, made where it is not there yet; one that is, is left as it is. */
async function ensureDir(sftp, path) {
  const there = await call((cb) => sftp.stat(path, cb)).then(
    (attrs) => attrs,
    () => null
  );
  if (there) {
    if (((there.mode ?? 0) & 0o170000) !== 0o040000) throw new RunnerError("failed", `${path} is there, but is not a folder`);
    return { path, made: false };
  }
  try {
    await call((cb) => sftp.mkdir(path, cb));
  } catch (err) {
    throw fromSftp(err, `making the folder ${path}`);
  }
  return { path, made: true };
}

async function one(sftp, op) {
  switch (op?.op) {
    case "list":
      return { entries: await list(sftp, op.path) };
    case "put":
      return await put(sftp, op.path, op.contentBase64);
    case "get":
      return await get(sftp, op.path);
    case "move":
      return await move(sftp, op.from, op.to);
    case "ensureDir":
      return await ensureDir(sftp, op.path);
    default:
      throw new RunnerError("bad_request", `there is no operation ${op?.op}`);
  }
}

/** Checks a request has what signing in needs, in words. */
function checkConnection(c) {
  if (!c || typeof c !== "object") return "name the server to connect to";
  if (typeof c.host !== "string" || c.host.trim() === "") return "name the server's host";
  if (c.port !== undefined && !(Number.isInteger(c.port) && c.port > 0 && c.port < 65536)) return "the port must be a number from 1 to 65535";
  if (typeof c.username !== "string" || c.username === "") return "name the user to sign in as";
  if (!c.password && !c.privateKey) return "give a password or a private key";
  return null;
}

/**
 * `run({ connection, ops })`: sign in, then each operation in order on one
 * connection. An operation that fails stops the rest (`skipped`). The
 * answer always says the host key seen, when the server got that far.
 *
 * @returns `{ hostKey, results: [{ ok: true, ... } | { ok: false, error: { code, message } }] }`
 *   or, where it never signed in, `{ hostKey, error: { code, message } }`.
 */
export async function run(request, { timeoutMs = 20_000 } = {}) {
  const connection = request?.connection;
  const ops = Array.isArray(request?.ops) ? request.ops : [];
  const problem = checkConnection(connection);
  if (problem) return { hostKey: null, error: { code: "bad_request", message: problem } };

  const client = new Client();
  let hostKey = null;
  let mismatch = false;
  const pinned = typeof connection.hostKey === "string" && connection.hostKey !== "" ? connection.hostKey : null;

  const signedIn = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ error: { code: "timeout", message: `${connection.host} did not answer within ${Math.round(timeoutMs / 1000)} seconds` } });
      client.end();
    }, timeoutMs + 1000);
    client.on("ready", () => {
      clearTimeout(timer);
      resolve({ ok: true });
    });
    client.on("error", (err) => {
      clearTimeout(timer);
      if (mismatch) {
        resolve({ error: { code: "host_key_changed", message: `${connection.host} showed a different identity (${hostKey}) from the one trusted (${pinned}); nothing was sent` } });
      } else if (err.level === "client-authentication") {
        resolve({ error: { code: "auth_failed", message: `${connection.username} could not sign in to ${connection.host}: the server refused the password or key` } });
      } else if (["ENOTFOUND", "EAI_AGAIN"].includes(err.code)) {
        resolve({ error: { code: "connect_failed", message: `there is no server named ${connection.host}` } });
      } else if (["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET"].includes(err.code)) {
        resolve({ error: { code: "connect_failed", message: `${connection.host}:${connection.port ?? 22} could not be reached (${err.code})` } });
      } else if (err.level === "client-timeout") {
        resolve({ error: { code: "timeout", message: `${connection.host} did not answer within ${Math.round(timeoutMs / 1000)} seconds` } });
      } else {
        resolve({ error: { code: "connect_failed", message: `${connection.host}: ${err.message}` } });
      }
    });
    try {
      client.connect({
        host: connection.host.trim(),
        port: connection.port ?? 22,
        username: connection.username,
        ...(connection.password ? { password: connection.password } : {}),
        ...(connection.privateKey ? { privateKey: connection.privateKey } : {}),
        ...(connection.passphrase ? { passphrase: connection.passphrase } : {}),
        readyTimeout: timeoutMs,
        hostVerifier: (key) => {
          hostKey = fingerprint(key);
          if (pinned && pinned !== hostKey) {
            mismatch = true;
            return false;
          }
          return true;
        },
      });
    } catch (err) {
      clearTimeout(timer);
      // A private key that cannot be read is refused here, before anything is sent.
      resolve({ error: { code: "bad_key", message: `the private key could not be read: ${err.message}` } });
    }
  });

  if (signedIn.error) {
    client.end();
    return { hostKey, error: signedIn.error };
  }

  try {
    const sftp = await call((cb) => client.sftp(cb)).catch((err) => {
      throw new RunnerError("no_sftp", `${connection.host} signed in but offers no SFTP: ${err.message}`);
    });
    const results = [];
    let stopped = false;
    for (const op of ops) {
      if (stopped) {
        results.push({ ok: false, error: { code: "skipped", message: "not tried, as an earlier step failed" } });
        continue;
      }
      try {
        results.push({ ok: true, ...(await one(sftp, op)) });
      } catch (err) {
        const e = err instanceof RunnerError ? err : fromSftp(err, op?.op ?? "a step");
        results.push({ ok: false, error: { code: e.code, message: e.message } });
        stopped = true;
      }
    }
    return { hostKey, results };
  } catch (err) {
    return { hostKey, error: { code: err.code ?? "failed", message: err.message } };
  } finally {
    client.end();
  }
}
