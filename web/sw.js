// The phone portal's service worker: keeps the app shell for when home is out
// of reach, and turns payload-less pushes into notifications (libexec/portal's
// docstring has the push side).
//
// Responses served from the saved copy carry X-Glitch-Saved: 1 (app.js reads it).
const SHELL = "glitch-shell", TAG = "glitch"
const FILES = ["/", "/app.js", "/orb.js", "/plugin/orb.mjs", "/plugin/orb.glsl", "/sounds/start.wav", "/sounds/stop.wav",
  "/sounds/unsure.wav", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", "/api/reactions"]
const WAIT_MS = 1800, DOWN_MS = 10000
let downAt = 0

// The server redirects unpaired requests to /pair or answers 401: only a plain 200 is a shell.
const good = r => r.ok && r.type === "basic" && !r.redirected

function keep(path, r) {
  if (!good(r)) return null
  const copy = r.clone()
  return caches.open(SHELL).then(c => c.put(path, copy))
}

function marked(r) {
  const headers = new Headers(r.headers)
  headers.set("X-Glitch-Saved", "1")
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers })
}

self.addEventListener("install", e => {
  self.skipWaiting()
  e.waitUntil(Promise.all(FILES.map(f => fetch(f, { redirect: "manual", cache: "no-cache" }).then(r => keep(f, r), () => {}))))
})

self.addEventListener("activate", e => e.waitUntil(clients.claim()))

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url)
  if (req.method !== "GET" || url.origin !== location.origin || !FILES.includes(url.pathname)) return
  let stored = null
  const net = Date.now() - downAt < DOWN_MS && req.mode !== "navigate" ? null
    : fetch(req).then(r => { downAt = 0; stored = keep(url.pathname, r); return r },
      err => { downAt = Date.now(); throw err })
  if (net) e.waitUntil(net.then(() => stored, () => {}))
  e.respondWith(answer(req, url.pathname, net))
})

async function answer(req, path, net) {
  if (net) {
    const r = await Promise.race([net.catch(() => null), new Promise(ok => setTimeout(ok, WAIT_MS))])
    if (r) return r
    downAt = Date.now()
  }
  const saved = await caches.match(path, { cacheName: SHELL })
  return saved ? marked(saved) : net || fetch(req)
}

// --- notifications ---

// Chrome subscriptions are userVisibleOnly: a push must show a notification
// unless a tab of the site is visible ("Sites with a currently visible tab don't
// need to show notifications", chrome/browser/push_messaging/
// push_messaging_notification_manager.cc), and it forgives an occasional miss.
self.addEventListener("push", e => e.waitUntil(woke()))

async function woke() {
  const wins = await clients.matchAll({ type: "window", includeUncontrolled: true })
  if (wins.some(w => w.visibilityState === "visible" && w.focused)) return
  let n = null
  try {
    const r = await fetch("/api/notice", { cache: "no-store", signal: AbortSignal.timeout(5000) })
    if (r.ok) n = await r.json()
  } catch {}
  // A push without a payload can't say which it was, so out of reach it's one text for both.
  if (!n) return show("glitch", "Something's waiting at home.")
  const a = n.approve?.[0]
  if (a) return show("glitch needs you", a.label, {
    data: { id: a.id }, requireInteraction: true,
    actions: [{ action: "allow", title: "Allow once" }, { action: "deny", title: "Deny" }]
  })
  if (n.reply) return show("glitch finished", n.reply.summary)
  for (const x of await self.registration.getNotifications({ tag: TAG })) x.close()
}

function show(title, body, opts = {}) {
  return self.registration.showNotification(title, { body, tag: TAG, renotify: true, icon: "/icon-192.png", ...opts })
}

self.addEventListener("notificationclick", e => {
  e.notification.close()
  e.waitUntil(clicked(e.action, e.notification.data))
})

async function clicked(action, data) {
  if (action && data?.id) {
    const r = await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: data.id, allow: action === "allow" }) }).catch(() => null)
    if (r?.ok || r?.status === 409) return
  }
  const [w] = await clients.matchAll({ type: "window", includeUncontrolled: true })
  return w ? w.focus() : clients.openWindow("/")
}
