import { contentSchema, publicationIssues, publishedContent } from "../app/content-validation";

export interface Env {
  DB: D1Database; ASSETS: Fetcher; APP_URL: string;
  PASSWORD_PEPPER: string;
}
type Role = "student" | "editor" | "admin";
type User = { id: string; username: string; name: string; role: Role };
type Session = User & { token_hash: string; csrf_token: string };
type Version = { version: number; draft_json: string; published_json: string };
const roles: Role[] = ["student", "editor", "admin"];
const now = () => Math.floor(Date.now() / 1000);
const random = () => crypto.randomUUID() + crypto.randomUUID();
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join(""); }
function cookies(request: Request) { return Object.fromEntries((request.headers.get("Cookie") || "").split(";").map(s => s.trim().split("=")).filter(s => s.length === 2)); }
function cookie(env: Env, name: string, value: string, age: number) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(env.APP_URL).protocol === "https:" ? "; Secure" : ""}`; }
async function session(request: Request, env: Env): Promise<Session | null> {
  const token = cookies(request).habra_session;
  if (!token || token.length > 200) return null;
  return env.DB.prepare("SELECT u.id,u.username,u.name,u.role,s.token_hash,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(await hash(token), now()).first<Session>();
}
function authorize(request: Request, env: Env, user: Session | null, allowed: Role[]) {
  if (!user) throw new HttpError(401, "Nejprve se přihlas.");
  if (!allowed.includes(user.role)) throw new HttpError(403, "Pro tuto změnu nemáš oprávnění.");
  if (request.method !== "GET") {
    if (request.headers.get("Origin") !== new URL(env.APP_URL).origin || request.headers.get("X-CSRF-Token") !== user.csrf_token) throw new HttpError(403, "Neplatný požadavek. Obnov stránku a zkus to znovu.");
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new HttpError(415, "Požadavek musí být JSON.");
  }
  return user;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "Chybí data.");
  let size = 0; const parts: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 500_000) { await reader.cancel(); throw new HttpError(413, "Obsah smí mít nejvýše 500 kB."); } parts.push(value); }
  const joined = new Uint8Array(size); let offset = 0; for (const part of parts) { joined.set(part, offset); offset += part.length; }
  try { const parsed: unknown = JSON.parse(new TextDecoder().decode(joined)); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed as Record<string, unknown>; }
  catch { throw new HttpError(400, "Neplatný JSON."); }
}
async function latest(env: Env) { const row = await env.DB.prepare("SELECT version,draft_json,published_json FROM content_versions ORDER BY version DESC LIMIT 1").first<Version>(); if (!row) throw new HttpError(503, "Databáze otázek zatím není naplněná."); return row; }
function sameOrigin(request: Request, env: Env) {
  if (request.headers.get("Origin") !== new URL(env.APP_URL).origin || !request.headers.get("Content-Type")?.startsWith("application/json")) throw new HttpError(403, "Neplatný požadavek.");
}
function hex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join(""); }
export async function passwordHash(password: string, salt: string, pepper: string) {
  const encoder = new TextEncoder();
  const pepperKey = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const protectedPassword = await crypto.subtle.sign("HMAC", pepperKey, encoder.encode(password));
  const key = await crypto.subtle.importKey("raw", protectedPassword, "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100_000 }, key, 256));
}
function equalHash(a: string, b: string) { let different = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return different === 0; }
async function rateLimit(env: Env, key: string, max: number) {
  const result = await env.DB.prepare("INSERT INTO auth_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts").bind(key, now()+900, now(), now()).first<{ attempts: number }>();
  if (!result || result.attempts > max) throw new HttpError(429, "Příliš mnoho pokusů. Zkus to za 15 minut.");
}
async function credentials(request: Request, env: Env, register: boolean) {
  sameOrigin(request, env);
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 32) throw new HttpError(503, "Přihlášení správce ještě nenastavil.");
  const input = await body(request);
  if (typeof input.username !== "string" || typeof input.password !== "string") throw new HttpError(400, "Vyplň uživatelské jméno a heslo.");
  const username = input.username.trim().toLowerCase(); const password = input.password;
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username) || password.length < 12 || password.length > 128) throw new HttpError(400, "Jméno: 3–32 znaků (a–z, číslice, tečka, pomlčka, podtržítko). Heslo: 12–128 znaků.");
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  await rateLimit(env, (register ? "register-ip:" : "login-ip:") + await hash(ip), register ? 6 : 30);
  await rateLimit(env, "user:" + username, 10);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_limits WHERE expires_at<=?").bind(now()),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now())
  ]);
  let user = await env.DB.prepare("SELECT id,password_hash,password_salt FROM users WHERE username=?").bind(username).first<{ id: string; password_hash: string; password_salt: string }>();
  if (register) {
    const salt = random(); const derived = await passwordHash(password, salt, env.PASSWORD_PEPPER);
    const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : username;
    const id = crypto.randomUUID();
    const inserted = await env.DB.prepare("INSERT INTO users(id,username,password_hash,password_salt,name,role,created_at) VALUES(?,?,?,?,?,'student',?) ON CONFLICT(username) DO NOTHING").bind(id, username, derived, salt, name, now()).run();
    if (!inserted.meta.changes) throw new HttpError(409, "Toto uživatelské jméno už nelze použít.");
    user = { id, password_hash: derived, password_salt: salt };
  } else {
    const derived = await passwordHash(password, user?.password_salt || "unknown-user-dummy-salt", env.PASSWORD_PEPPER);
    if (!equalHash(derived, user?.password_hash || "0".repeat(64)) || !user) throw new HttpError(401, "Nesprávné uživatelské jméno nebo heslo.");
  }
  const secret = random(); const csrf = random();
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)").bind(await hash(secret), user.id, csrf, now() + 604800).run();
  const publicUser = await env.DB.prepare("SELECT id,username,name,role FROM users WHERE id=?").bind(user.id).first<User>();
  const response = json({ user: publicUser, csrfToken: csrf, loginAvailable: true });
  response.headers.set("Set-Cookie", cookie(env, "habra_session", secret, 604800)); return response;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && (path === "/api/auth/login" || path === "/api/auth/register")) return credentials(request, env, path.endsWith("register"));
  if (path === "/api/content" && request.method === "GET") return json(JSON.parse((await latest(env)).published_json));
  const user = await session(request, env);
  if (path === "/api/me" && request.method === "GET") return json({ user: user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null, csrfToken: user?.csrf_token || null, loginAvailable: !!env.PASSWORD_PEPPER && env.PASSWORD_PEPPER.length >= 32 });
  if (path === "/api/auth/logout" && request.method === "POST") {
    const current = authorize(request, env, user, roles); await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(current.token_hash).run();
    const response = json({ ok: true }); response.headers.set("Set-Cookie", cookie(env, "habra_session", "", 0)); return response;
  }
  if (path === "/api/auth/password" && request.method === "POST") {
    const current = authorize(request, env, user, roles); const input = await body(request);
    if (typeof input.oldPassword !== "string" || input.oldPassword.length > 128 || typeof input.newPassword !== "string" || input.newPassword.length < 12 || input.newPassword.length > 128) throw new HttpError(400, "Nové heslo musí mít 12–128 znaků.");
    await rateLimit(env, "password:" + current.id, 5);
    const saved = await env.DB.prepare("SELECT password_hash,password_salt FROM users WHERE id=?").bind(current.id).first<{ password_hash: string; password_salt: string }>();
    if (!saved || !equalHash(await passwordHash(input.oldPassword, saved.password_salt, env.PASSWORD_PEPPER), saved.password_hash)) throw new HttpError(401, "Současné heslo není správné.");
    const salt = random(); const derived = await passwordHash(input.newPassword, salt, env.PASSWORD_PEPPER);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=?").bind(derived, salt, current.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash!=?").bind(current.id, current.token_hash)
    ]);
    return json({ ok: true });
  }
  if (path === "/api/editor/draft" && request.method === "GET") {
    authorize(request, env, user, ["editor", "admin"]); const row = await latest(env); return json({ version: row.version, content: JSON.parse(row.draft_json) });
  }
  if ((path === "/api/editor/draft" || path === "/api/editor/publish" || path === "/api/editor/restore") && request.method === "POST") {
    const current = authorize(request, env, user, ["editor", "admin"]); const input = await body(request);
    if (!Number.isSafeInteger(input.version) || Number(input.version) < 0) throw new HttpError(400, "Chybí verze konceptu.");
    const row = await latest(env); if (row.version !== input.version) throw new HttpError(409, "Obsah změnil jiný editor. Exportuj své změny a načti aktuální koncept.");
    let candidate = input.content;
    if (path.endsWith("restore")) {
      if (!Number.isSafeInteger(input.restoreVersion) || Number(input.restoreVersion) < 0) throw new HttpError(400, "Neplatná verze pro obnovení.");
      const old = await env.DB.prepare("SELECT draft_json FROM content_versions WHERE version=?").bind(input.restoreVersion).first<{ draft_json: string }>();
      if (!old) throw new HttpError(404, "Verze neexistuje."); candidate = JSON.parse(old.draft_json);
    }
    const parsed = contentSchema.safeParse(candidate); if (!parsed.success) throw new HttpError(400, "Neplatná struktura otázek.");
    const publish = path.endsWith("publish"); const issues = publicationIssues(parsed.data);
    if (publish && issues.length) throw new HttpError(400, issues.slice(0, 5).map(i => i.message).join("; "));
    const result = await env.DB.prepare("INSERT INTO content_versions(version,draft_json,published_json,action,author_id,created_at) SELECT ?,?,?,?,?,? WHERE ? = (SELECT MAX(version) FROM content_versions)").bind(row.version + 1, JSON.stringify(parsed.data), publish ? JSON.stringify(publishedContent(parsed.data)) : row.published_json, publish ? "publish" : path.endsWith("restore") ? "restore" : "save", current.id, now(), row.version).run();
    if (!result.meta.changes) throw new HttpError(409, "Obsah změnil jiný editor. Exportuj své změny a načti aktuální koncept.");
    return json({ version: row.version + 1, content: parsed.data });
  }
  if (path === "/api/editor/history" && request.method === "GET") {
    authorize(request, env, user, ["editor", "admin"]);
    return json((await env.DB.prepare("SELECT v.version,v.action,v.created_at,u.name AS author FROM content_versions v LEFT JOIN users u ON u.id=v.author_id ORDER BY v.version DESC LIMIT 50").all()).results);
  }
  if (path === "/api/admin/users" && request.method === "GET") { authorize(request, env, user, ["admin"]); return json((await env.DB.prepare("SELECT id,username,name,role FROM users ORDER BY name LIMIT 500").all()).results); }
  if (path === "/api/admin/role" && request.method === "POST") {
    const current = authorize(request, env, user, ["admin"]); const input = await body(request);
    if (typeof input.userId !== "string" || !roles.includes(input.role as Role)) throw new HttpError(400, "Neplatný uživatel nebo role.");
    const target = await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(input.userId).first<{ role: Role }>();
    if (!target) throw new HttpError(404, "Uživatel neexistuje.");
    try { await env.DB.batch([
      env.DB.prepare("INSERT INTO role_changes(actor_id,target_id,old_role,new_role,created_at) SELECT ?,id,role,?,? FROM users WHERE id=?").bind(current.id, input.role, now(), input.userId),
      env.DB.prepare("UPDATE users SET role=? WHERE id=?").bind(input.role, input.userId)
    ]); } catch (error) { if (String(error).includes("last_admin")) throw new HttpError(409, "Alespoň jeden správce musí zůstat."); throw error; }
    return json({ ok: true });
  }
  throw new HttpError(404, "Rozhraní neexistuje.");
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try { return await handleApi(request, env); }
    catch (error) { if (error instanceof HttpError) return json({ error: error.message }, error.status); console.error("HABRA API request failed", error instanceof Error ? error.name : "UnknownError"); return json({ error: "Server nemohl požadavek dokončit. Zkus to později." }, 500); }
  }
};
