// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const fetch = require("node-fetch"); // please npm install

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// trust proxy because you run behind nginx optionally
app.set("trust proxy", true);

// Paths
const dataRoot = path.join(__dirname, "backend", "data");
const usersFile = path.join(dataRoot, "users", "userdata.json");
const blacklistFile = path.join(dataRoot, "blacklists", "blacklists.json");
const announcementsFile = path.join(dataRoot, "announcements", "announcements.json");
const filesFile = path.join(dataRoot, "files", "files.json");
const chatFile = path.join(dataRoot, "chat", "chat.json");
const tagsFile = path.join(dataRoot, "tags", "tags.json");

// Ensure data files and folders exist & create safe defaults
[
  usersFile,
  blacklistFile,
  announcementsFile,
  filesFile,
  chatFile,
  tagsFile
].forEach(f => {
  const dir = path.dirname(f);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(f)) {
    if (f.endsWith("userdata.json")) fs.writeFileSync(f, JSON.stringify({
      "admin": { "password": "duck123", "role": "admin", "tags": ["founder"] },
      "announcer": { "password": "quackpost", "role": "announcer", "tags": [] },
      "user": { "password": "quack", "role": "user", "tags": [] }
    }, null, 2));
    else if (f.endsWith("announcements.json")) fs.writeFileSync(f, JSON.stringify([{
      "author":"admin",
      "text":"Welcome to Duck Corporations! Stay yellow 🌟",
      "date": new Date().toISOString()
    }], null, 2));
    else if (f.endsWith("files.json")) fs.writeFileSync(f, JSON.stringify([
      { "name": "TrueNAS UI", "url": "/truenas/", "embed": true },
      { "name": "Company Handbook", "url": "https://example.com/handbook.pdf" }
    ], null, 2));
    else if (f.endsWith("chat.json")) fs.writeFileSync(f, JSON.stringify([], null, 2));
    else if (f.endsWith("tags.json")) fs.writeFileSync(f, JSON.stringify(["employee","dev","admin","founder"], null, 2));
    else fs.writeFileSync(f, JSON.stringify({}, null, 2));
  }
});

// Helpers
function readJSON(file, fallback = null) {
  try { const raw = fs.readFileSync(file,"utf8"); return raw.trim() ? JSON.parse(raw) : fallback; }
  catch(e){ return fallback; }
}
function writeJSON(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

// Role hierarchy: higher index == more privileges
const ROLES = ["user","employee","announcer","dev","admin"];
function roleAtLeast(userRole, requiredRole) {
  if (!userRole) return false;
  const u = ROLES.indexOf(userRole);
  const r = ROLES.indexOf(requiredRole);
  return u >= r;
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "duck_secret_change_me",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// BLACKLIST CHECK MIDDLEWARE (req.ip respects trust proxy)
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || "";
  const blacklists = readJSON(blacklistFile, {});
  if (blacklists && blacklists[ip]) return res.redirect("/blocked.html");
  next();
});

// redirect root to login to match expected UX
app.get("/", (req,res) => res.redirect("/login.html"));

// static files
app.use(express.static(path.join(__dirname, "public")));

// ---------- AUTH / USERS ----------
app.post("/login", (req, res) => {
  const { username = "", password = "" } = req.body;
  const users = readJSON(usersFile, {});
  if (users[username] && users[username].password === password) {
    req.session.user = { username, role: users[username].role, tags: users[username].tags || [] };
    return res.redirect("/announcements.html");
  }
  res.status(401).send(`<p>Invalid login. <a href="/login.html">Back</a></p>`);
});

app.post("/register", (req, res) => {
  const { username = "", password = "" } = req.body;
  if (!username || !password) return res.status(400).send("Missing username or password");
  const users = readJSON(usersFile, {});
  if (users[username]) return res.status(409).send("Username already exists");
  users[username] = { password, role: "user", tags: [] };
  writeJSON(usersFile, users);
  req.session.user = { username, role: "user", tags: [] };
  res.redirect("/announcements.html");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login.html"));
});

// lightweight session info
app.get("/api/session", (req, res) => {
  res.json({ user: req.session.user || null });
});

// change password
app.post("/api/change-password", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const { oldPassword, newPassword } = req.body;
  const users = readJSON(usersFile, {});
  const u = users[req.session.user.username];
  if (!u || u.password !== oldPassword) return res.status(403).json({ error: "Bad password" });
  u.password = newPassword;
  writeJSON(usersFile, users);
  res.json({ ok: true });
});

// admin-only list users
app.get("/api/users", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  if (!roleAtLeast(req.session.user.role, "admin")) return res.status(403).json({ error: "Admin only" });
  const users = readJSON(usersFile, {});
  res.json(users);
});

// admin set role for a user
app.post("/api/user/set-role", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  if (!roleAtLeast(req.session.user.role, "admin")) return res.status(403).json({ error: "Admin only" });
  const { username, role } = req.body;
  if (!username || !role) return res.status(400).json({ error: "Missing fields" });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Unknown role" });
  const users = readJSON(usersFile, {});
  if (!users[username]) return res.status(404).json({ error: "No such user" });
  users[username].role = role;
  writeJSON(usersFile, users);
  res.json({ ok: true });
});

// admin add tag to a user
app.post("/api/user/add-tag", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  if (!roleAtLeast(req.session.user.role, "admin")) return res.status(403).json({ error: "Admin only" });
  const { username, tag } = req.body;
  if (!username || !tag) return res.status(400).json({ error: "Missing fields" });
  const users = readJSON(usersFile, {});
  const tags = readJSON(tagsFile, []);
  if (!tags.includes(tag)) return res.status(400).json({ error: "Tag does not exist. Create it first." });
  if (!users[username]) return res.status(404).json({ error: "No such user" });
  users[username].tags = users[username].tags || [];
  if (!users[username].tags.includes(tag)) users[username].tags.push(tag);
  writeJSON(usersFile, users);
  res.json({ ok: true });
});

// create a new GLOBAL tag (only employee or higher)
app.post("/api/tags/create", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  if (!roleAtLeast(req.session.user.role, "employee")) return res.status(403).json({ error: "employee+ only" });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing name" });
  const tags = readJSON(tagsFile, []);
  if (tags.includes(name)) return res.status(409).json({ error: "Tag exists" });
  tags.push(name);
  writeJSON(tagsFile, tags);
  res.json({ ok: true });
});

app.get("/api/tags", (req, res) => {
  res.json(readJSON(tagsFile, []));
});

// ---------- ANNOUNCEMENTS ----------
app.get("/api/announcements", (req, res) => {
  res.json(readJSON(announcementsFile, []));
});

app.post("/api/announce", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const users = readJSON(usersFile, {});
  const u = users[req.session.user.username];
  if (!u || (!roleAtLeast(u.role, "announcer") && !roleAtLeast(u.role, "dev") && !roleAtLeast(u.role, "admin"))) {
    return res.status(403).json({ error: "Not allowed" });
  }
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Empty" });
  const announcements = readJSON(announcementsFile, []);
  announcements.unshift({ author: req.session.user.username, text: text.trim(), date: new Date().toISOString() });
  writeJSON(announcementsFile, announcements);
  res.json({ ok: true });
});

// ---------- CHAT ----------
app.get("/api/chat", (req, res) => {
  const list = readJSON(chatFile, []);
  res.json(list.slice(0, 500));
});

app.post("/api/chat", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Empty" });
  const messages = readJSON(chatFile, []);
  const msg = { author: req.session.user.username, text: text.trim(), date: new Date().toISOString() };
  messages.unshift(msg);
  // keep last 1000 messages
  writeJSON(chatFile, messages.slice(0, 1000));
  res.json({ ok: true });
});

// ---------- FILES ----------
app.get("/api/files", (req, res) => res.json(readJSON(filesFile, [])));

// ---------- BLACKLIST (employee+ can add) ----------
app.get("/api/blacklist", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const users = readJSON(usersFile, {});
  const u = users[req.session.user.username];
  if (!u || !roleAtLeast(u.role, "employee")) return res.status(403).json({ error: "employee+ only" });
  res.json(readJSON(blacklistFile, {}));
});

app.post("/api/blacklist", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const users = readJSON(usersFile, {});
  const u = users[req.session.user.username];
  if (!u || !roleAtLeast(u.role, "employee")) return res.status(403).json({ error: "employee+ only" });
  const ip = req.body.ip;
  if (!ip) return res.status(400).json({ error: "No IP provided" });
  const blacklists = readJSON(blacklistFile, {});
  blacklists[ip] = true;
  writeJSON(blacklistFile, blacklists);
  res.json({ ok: true });
});

// ---------- DUCKDUCKGO PROXY SEARCH ----------
app.get("/proxy/search", async (req, res) => {
  // Example: /proxy/search?q=search+terms
  const q = req.query.q || "";
  // use DuckDuckGo HTML endpoint
  const target = `https://html.duckduckgo.com/html?q=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(target, { method: "GET", headers: { "User-Agent": "DuckCorpProxy/1.0" } });
    const body = await r.text();
    // return the HTML (we do no rewriting of assets; for basic searches this works)
    res.set("Content-Type", "text/html");
    res.send(body);
  } catch (err) {
    res.status(502).send("Failed to fetch search results.");
  }
});

// start server
app.listen(PORT, HOST, () => console.log(`Duck Corp server running at http://${HOST}:${PORT}`));
