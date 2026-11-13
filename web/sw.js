// The phone portal's service worker: keeps the app shell for when home is out
// of reach, and turns payload-less pushes into notifications (libexec/portal's
// docstring has the push side).
//
// The shell is saved as whole sets, one cache each ("shell-<ms>"), and a page loads
// every file from the set its navigation got; saved files carry X-Glitch-Set: <name>.
// A page's message "refresh" refreshes the saved set and is answered {set: <newest>}.
// Cache "handoff" holds /allow {id, at}: Allow once pressed on a notification, for the page to send once
// it's open (a notification action works on a locked phone; opening the app doesn't). Allow once is offered
// only when the approval's oneline is set: bin/glitch sets it for a plain Bash command of at most 40
// characters, which a collapsed notification's single line shows whole. The page checks oneline again;
// neither has a rule of its own.
const FILES = ["/", "/app.js", "/orb.js", "/plugin/orb.mjs", "/plugin/orb.glsl", "/sounds/start.wav", "/sounds/stop.wav",
  "/sounds/unsure.wav", "/icon-192.png", "/icon-512.png", "/icon-mono-192.png", "/manifest.webmanifest", "/api/reactions"]
const SET = "shell-", HANDOFF = "handoff", TAG = "glitch"
// Away without Tailscale, the home address mostly hangs rather than failing, so a slow
// answer counts as none and the saved set opens.
const WAIT_MS = 1800, GIVE_UP_MS = 20000, FRESH_MS = 5000
const pins = new Map()
let running = null, refreshed = 0

// The server redirects unpaired requests to /pair or answers 401: only a plain 200 is a shell.
const good = r => r.ok && r.type === "basic" && !r.redirected
function same(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}
const newest = async () => (await caches.keys()).filter(n => n.startsWith(SET)).sort().at(-1) || null
const saved = (name, path) => name ? caches.match(path, { cacheName: name }) : Promise.resolve(undefined)

// Resolves to the network's "/" when the set couldn't be fetched whole, else null.
function refresh() {
  if (Date.now() - refreshed < FRESH_MS) return Promise.resolve(null)
  return running ||= (async () => {
    const got = await Promise.all(FILES.map(f => fetch(f, { cache: "no-cache", redirect: "manual", signal: AbortSignal.timeout(GIVE_UP_MS) })))
    if (!got.every(good)) return got[0]
    const bufs = await Promise.all(got.map(r => r.arrayBuffer()))
    const old = await newest()
    const was = await Promise.all(FILES.map(f => saved(old, f).then(r => r?.arrayBuffer())))
    if (!was.every((b, i) => b && same(b, bufs[i]))) {
      const name = SET + Date.now(), c = await caches.open(name)
      await Promise.all(FILES.map((f, i) => {
        const headers = new Headers(got[i].headers)
        headers.set("X-Glitch-Set", name)
        return c.put(f, new Response(bufs[i], { status: 200, headers }))
      }))
      for (const n of await caches.keys()) if (n !== name && n !== old && n !== HANDOFF) await caches.delete(n)
    }
    refreshed = Date.now()
    return null
  })().finally(() => { running = null })
}

self.addEventListener("install", e => {
  self.skipWaiting()
  e.waitUntil(refresh().catch(() => {}))
})

self.addEventListener("activate", e => e.waitUntil(clients.claim()))

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url)
  if (req.method !== "GET" || url.origin !== location.origin || !FILES.includes(url.pathname)) return
  if (req.mode === "navigate") {
    const job = refresh()
    e.waitUntil(job.catch(() => {}))
    return e.respondWith(open(req, job, e.resultingClientId))
  }
  e.respondWith((async () => {
    const name = pins.has(e.clientId) ? pins.get(e.clientId) : await newest()
    return await saved(name, url.pathname) || fetch(req)
  })())
})

async function open(req, job, client) {
  const net = await Promise.race([job, new Promise(ok => setTimeout(ok, WAIT_MS, null))]).catch(() => null)
  const name = await newest(), home = await saved(name, "/")
  if (home && !(net && (net.type === "opaqueredirect" || net.status === 401))) {
    pins.set(client, name)
    return home
  }
  pins.set(client, null)
  return net?.clone() || fetch(req)
}

self.addEventListener("message", e => {
  if (e.data === "refresh") e.waitUntil(refresh().catch(() => {}).then(newest).then(set => e.source.postMessage({ set })))
})

// --- notifications ---

// Chrome subscriptions are userVisibleOnly: a push must show a notification
// unless a tab of the site is visible ("Sites with a currently visible tab don't
// need to show notifications", chrome/browser/push_messaging/
// push_messaging_notification_manager.cc), and it forgives an occasional miss.
// One of the site's notifications still showing counts as shown.
self.addEventListener("push", e => e.waitUntil(woke()))

async function woke(answered) {
  const wins = await clients.matchAll({ type: "window", includeUncontrolled: true })
  if (wins.some(w => w.visibilityState === "visible" && w.focused && new URL(w.url).pathname === "/")) return
  let n = null
  try {
    const r = await fetch("/api/notice", { cache: "no-store", signal: AbortSignal.timeout(5000) })
    if (r.ok) n = await r.json()
  } catch {}
  // A push without a payload can't say which it was, so out of reach it's one text for both.
  if (!n) return show("glitch", "Something's waiting at home.")
  const a = n.approve?.[0]
  if (a) return show("glitch needs you", a.short ?? brief(a.label || ""), {
    data: { id: a.id }, requireInteraction: true,
    actions: [a.oneline ? { action: "allow", title: "Allow once" } : { action: "open", title: "Open" }, { action: "deny", title: "Deny" }]
  })
  if (n.reply) return show("glitch finished", n.reply.summary)
  const left = await self.registration.getNotifications({ tag: TAG })
  if (!answered && left.some(x => x.data?.id)) return show("glitch", "No longer waiting for you.", { silent: true, renotify: false })
  if (answered) for (const x of left) x.close()
}

// Text only, for an approval from before short existed; what it offers depends on oneline alone.
function brief(label, max = 120) {
  const first = label.split("\n")[0], chars = Array.from(first)
  return chars.length > max || first !== label ? chars.slice(0, max - 1).join("").trimEnd() + "…" : label
}

function show(title, body, opts = {}) {
  return self.registration.showNotification(title, { body, tag: TAG, renotify: true, icon: "/icon-192.png", badge: "/icon-mono-192.png", ...opts })
}

self.addEventListener("notificationclick", e => {
  e.notification.close()
  e.waitUntil(clicked(e.action, e.notification.data?.id))
})

async function clicked(action, id) {
  if (id && action === "deny") {
    const r = await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, allow: false }) }).catch(() => null)
    if (r?.ok) return woke(true)
  } else if (id && action === "allow") {
    await (await caches.open(HANDOFF)).put("/allow", new Response(JSON.stringify({ id, at: Date.now() })))
  }
  const [w] = await clients.matchAll({ type: "window", includeUncontrolled: true })
  return w ? w.focus() : clients.openWindow("/")
}
