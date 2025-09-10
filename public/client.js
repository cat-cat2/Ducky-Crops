// client.js - used by all pages
async function getSession() {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin" });
    if (!res.ok) return { user: null };
    return res.json();
  } catch (e) { return { user: null }; }
}

// Simple redirect if not logged in
async function requireLoginRedirect() {
  const data = await getSession();
  if (!data.user) window.location = "/login.html";
}

// escape HTML helper
function escapeHtml(s){ 
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// render shared nav (call inside pages if needed)
async function renderNav(targetId = "mainNav"){
  const s = await getSession();
  const user = s.user;
  const nav = [
    '<a href="/announcements.html">Announcements</a>',
    '<a href="/files.html">Files</a>',
    '<a href="/chat.html">Chat</a>',
    '<a href="/search.html">Search</a>',
    '<a href="/settings.html">Settings</a>',
    '<a href="/blacklist.html">Blacklist</a>'
  ];
  if (!user) {
    nav.push('<a href="/login.html">Login</a>');
    nav.push('<a href="/register.html">Register</a>');
  } else {
    nav.push(`<span style="padding:6px 10px;border-radius:8px;background:#fff8e0;border:1px solid #f0d88a;font-weight:600;">${escapeHtml(user.username)}</span>`);
    nav.push('<a href="/logout">Logout</a>');
  }
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = nav.join(" | ");
}
