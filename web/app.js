// The phone portal (libexec/portal serves it; its docstring is the wire format).
import { createOrbView } from "./orb.js"

const $ = id => document.getElementById(id)
const canvas = $("orb"), textEl = $("text"), heardEl = $("heard"), lineEl = $("line"), bodyEl = $("body")
const askEl = $("ask"), labelEl = $("label"), allowEl = $("allow"), denyEl = $("deny"), cancelEl = $("cancel")
const awayEl = $("away"), offerEl = $("offer"), yesEl = $("yes"), noEl = $("no")
const TAP_MS = 250, HANDOFF_MS = 30000, RELOAD_MS = 30000
const WORK = new Set(["thinking", "tool"])

const pair = () => { location.href = "/pair" }

async function api(path, body) {
  const r = await fetch(path, body === undefined ? { method: "POST" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (r.status === 401) pair()
  return r
}

navigator.serviceWorker?.register("/sw.js").catch(() => {})

const notice = () => fetch("/api/notice", { cache: "no-store", signal: AbortSignal.timeout(3000) }).catch(() => null)
const reached = notice()
let reactions = {}, offline = false, shell = null, stale = false
{
  const r = await fetch("/api/reactions").catch(() => null)
  if (r?.status === 401) pair()
  else if (r?.ok) reactions = await r.json()
  shell = r?.headers.get("X-Glitch-Set")
}
const listenLook = () => reactions.listening || null
const restLook = () => reactions.mood?.calm || null
const awayLook = () => reactions.mood?.sorry || null

// --- audio: one context, unlocked by the first press, so later clips need no gesture ---

const ac = new AudioContext()
let unlocked = ac.state === "running"
const sounds = {}
for (const n of ["start", "stop", "unsure"])
  sounds[n] = fetch(`/sounds/${n}.wav`).then(r => r.arrayBuffer()).then(b => ac.decodeAudioData(b)).catch(() => null)

// A touch grants user activation on release, not on press (only a mouse's
// pointerdown does), so a phone's first press can't start audio: it unlocks on release.
function unlock() {
  ac.resume().then(() => { if (!unlocked) { unlocked = true; pump() } }, () => {})
}

function sound(buf, at = 0) {
  const s = ac.createBufferSource()
  s.buffer = buf
  s.connect(ac.destination)
  s.start(at)
  return s
}

async function chime(name) {
  const b = await sounds[name]
  if (b && ac.state === "running") sound(b)
}

// --- the orb ---

const opts = {
  dpr: Math.min(2, devicePixelRatio || 1),
  origin: (W, H) => [W / 2, H * 0.42],
  onBeforeStep(f) {
    if (!f.listening || !analyser) return
    analyser.getFloatTimeDomainData(samples)
    let peak = 0
    for (const v of samples) peak = Math.max(peak, Math.abs(v))
    orb.mic(Math.min(1, peak))
  },
  persist: true
}
const fit = () => { opts.scale = Math.min(innerWidth, innerHeight * 0.75) / 590 }
fit()
addEventListener("resize", fit)
let server = null, local = null, turn = null, approvals = []
let heard = "", reply = null, note = "", awaiting = 0, offering = false
let orb
try { orb = await createOrbView(canvas, opts) } catch (e) {
  if (/HTTP 401/.test(e.message)) pair()
  note = "Can't draw the orb here"
  orb = { set() {}, event() {}, mic() {}, reduceMotion() {}, start() {}, stop() {} }
}
const motion = matchMedia("(prefers-reduced-motion: reduce)")
orb.reduceMotion(motion.matches)
motion.addEventListener("change", () => orb.reduceMotion(motion.matches))

function rest() {
  orb.set({ state: "idle", reaction: offline ? awayLook() : restLook() })
}

function show() {
  if (local) orb.set({ state: local, reaction: listenLook() })
  else if (server) orb.set({ state: server.state, reaction: server.reaction })
  else rest()
  render()
}

function render() {
  if (update()) return
  awayEl.hidden = !offline
  offerEl.hidden = !offering || offline || approvals.length > 0
  if (offline) {
    heardEl.textContent = ""
    lineEl.textContent = "Can't reach home"
    textEl.classList.remove("dim", "body")
    bodyEl.hidden = askEl.hidden = cancelEl.hidden = true
    return wake()
  }
  const s = server?.state, d = server?.detail || ""
  const detail = (WORK.has(s) || s === "idle") && d !== heard ? d : ""
  heardEl.textContent = heard
  lineEl.textContent = note || (!unlocked && queue.length ? "tap to hear" : "") || reply?.summary || detail
  textEl.classList.toggle("dim", !!local)
  textEl.classList.toggle("body", !!reply?.body && !note)
  if (!reply?.body) bodyEl.hidden = true
  const a = approvals[0]
  askEl.hidden = !a
  if (a && askEl.dataset.id !== a.id) {
    askEl.dataset.id = a.id
    labelEl.textContent = a.label
    allowEl.disabled = denyEl.disabled = false
  }
  if (!a) delete askEl.dataset.id
  cancelEl.hidden = !turn
  wake()
}

textEl.addEventListener("click", () => {
  if (!reply?.body) return
  bodyEl.textContent = reply.body
  bodyEl.hidden = !bodyEl.hidden
})
bodyEl.addEventListener("click", () => { bodyEl.hidden = true })

// --- clips: cues play on arrival, speech one at a time in arrival order ---

const seen = new Set(), started = new Map()
let queue = [], playing = null

function load(c) {
  c.buf ||= fetch(c.url).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(b => ac.decodeAudioData(b))
  c.buf.catch(() => {})
  return c.buf
}

function clip(c) {
  if (seen.has(c.id)) return
  seen.add(c.id)
  if (local === "listening") {
    if (c.kind !== "cue") api("/api/played", { id: c.id })
    return
  }
  if (c.kind === "cue") {
    if (unlocked) started.set(c.id, load(c).then(b => { sound(b); return ac.currentTime }, () => null))
    return
  }
  load(c)
  queue.push(c)
  pump()
}

async function pump() {
  if (!unlocked) render()
  if (playing || !queue.length || !unlocked) return
  const c = queue.shift(), p = playing = { c }
  let buf, cue
  try { [buf, cue] = await Promise.all([load(c), c.with && started.get(c.with)]) } catch {
    if (playing === p) { playing = null; api("/api/played", { id: c.id }); pump() }
    return
  }
  if (playing !== p) return
  const at = Math.max(ac.currentTime, cue ? cue + c.delay / 1000 : 0)
  p.src = sound(buf, at)
  started.set(c.id, at)
  const ms = (at - ac.currentTime + Math.max(0, (ac.outputLatency || 0) - 0.06)) * 1000
  p.timer = setTimeout(() => { if (c.env) orb.event("say " + c.env) }, ms)
  p.src.onended = () => {
    if (playing !== p) return
    playing = null
    api("/api/played", { id: c.id })
    pump()
    render()
  }
  render()
}

function stop(p) {
  clearTimeout(p.timer)
  try { p.src?.stop() } catch {}
}

function hush(ack) {
  if (!playing && !queue.length) return
  if (playing) stop(playing)
  playing = null
  queue = []
  orb.event("hush")
  if (ack) api("/api/played")
}

function answered(id) {
  approvals = approvals.filter(a => a.id !== id)
  queue = queue.filter(c => c.approve !== id)
  if (playing?.c.approve === id) {
    stop(playing)
    playing = null
    orb.event("hush")
    pump()
  }
}

async function answer(allow, id) {
  const a = id ? approvals.find(a => a.id === id) : approvals[0]
  if (!a) return
  unlock()
  allowEl.disabled = denyEl.disabled = true
  const r = await api("/api/approve", { id: a.id, allow }).catch(() => null)
  if (r?.status === 409) answered(a.id)
  else if (!r?.ok) allowEl.disabled = denyEl.disabled = false
  render()
}
allowEl.addEventListener("click", () => answer(true))
denyEl.addEventListener("click", () => answer(false))
cancelEl.addEventListener("click", () => { unlock(); api("/api/cancel").catch(() => {}) })

// --- events ---

const LOST_MS = 3000, PROBE_MS = 3000
let es = null, lost = 0, probing = 0, synced = false, met = false

function goOffline() {
  clearTimeout(lost)
  lost = 0
  es?.close()
  es = null
  if (!offline) {
    offline = true
    server = turn = null
    approvals = []
    show()
  }
  probeSoon(PROBE_MS)
}

function probeSoon(ms) {
  clearTimeout(probing)
  probing = setTimeout(probe, ms)
}

async function probe(asked = notice()) {
  clearTimeout(probing)
  const r = await asked
  if (r?.status === 401) return pair()
  if (r?.ok) { if (!es) connect() }
  else if (!met) goOffline()
  else if (offline || !es) probeSoon(PROBE_MS)
}

function connect() {
  const me = es = new EventSource("/api/events")
  const on = (type, fn) => me.addEventListener(type, e => { fn(JSON.parse(e.data)); render() })
  on("hello", h => {
    clearTimeout(lost)
    lost = 0
    offline = false
    met = true
    if (!synced && globalThis.Notification?.permission === "granted") { synced = true; subscribe().catch(() => {}) }
    turn = h.turn
    server = h.turn === "phone" ? h.state : null
    approvals = h.approve || []
    heard = h.heard || ""
    reply = h.reply
    for (const c of h.replay || []) clip(c)
    if (!local) show()
    opened()
  })
  on("turn", m => {
    if (turn === "phone" && !m.turn && canOffer()) offering = true
    turn = m.turn
  })
  on("state", m => {
    server = m
    if (awaiting) { clearTimeout(awaiting); awaiting = 0; local = null }
    if (!local) orb.set({ state: m.state, reaction: m.reaction })
  })
  on("signal", m => {
    if (m.line === "turn" || m.line === "rest") approvals = []
    orb.event(m.line)
  })
  on("heard", m => { heard = m.text; reply = null; note = "" })
  on("reply", m => { reply = m })
  on("clip", clip)
  on("approve", m => { if (!approvals.some(a => a.id === m.id)) approvals.push(m) })
  on("approved", m => answered(m.id))
  on("hush", () => hush(false))
  me.onerror = () => {
    if (es !== me) return
    lost ||= setTimeout(goOffline, LOST_MS)
    if (me.readyState === EventSource.CLOSED) { es = null; probeSoon(500) }
  }
}
connect()
probe(reached)

addEventListener("online", () => { if (offline || !es) probe() })

// --- install: Chrome only raises its own prompt from a tap ---

let installer = null
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installer = e; $("install").hidden = false })
addEventListener("appinstalled", () => { $("install").hidden = true })
$("install").addEventListener("click", () => { $("install").hidden = true; installer?.prompt() })

// --- notifications ---

const canOffer = () => "PushManager" in window && !!navigator.serviceWorker?.controller &&
  Notification.permission === "default" && !localStorage.getItem("glitch.push")

// --- open with home answering: notices cleared, an Allow from a notification sent, a newer shell loaded when idle ---

if (navigator.serviceWorker) navigator.serviceWorker.onmessage = e => {
  if (shell && e.data?.set && e.data.set !== shell) { stale = true; render() }
}

async function opened() {
  if (document.hidden) return
  navigator.serviceWorker?.controller?.postMessage("refresh")
  navigator.serviceWorker?.getRegistration().then(r => r?.getNotifications({ tag: "glitch" }))
    .then(ns => ns?.forEach(n => n.close()), () => {})
  const c = await globalThis.caches?.open("handoff"), r = await c?.match("/allow")
  if (!r || !await c.delete("/allow")) return
  const { id, at } = await r.json().catch(() => ({}))
  if (Date.now() - at < HANDOFF_MS && !document.hidden && approvals.some(a => a.id === id)) answer(true, id)
}

function update() {
  if (!stale || turn || local || press || playing || queue.length || approvals.length || WORK.has(server?.state)) return false
  if (Date.now() - (+sessionStorage.getItem("glitch.reload") || 0) < RELOAD_MS) return false
  sessionStorage.setItem("glitch.reload", Date.now())
  location.reload()
  return true
}

const bytes = b64 => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))

async function subscribe() {
  const reg = await navigator.serviceWorker.ready
  const r = await fetch("/api/push")
  if (!r.ok) return
  const key = bytes((await r.json()).key)
  let sub = await reg.pushManager.getSubscription()
  const old = sub && new Uint8Array(sub.options.applicationServerKey || [])
  if (sub && old.join() !== key.join()) { await sub.unsubscribe(); sub = null }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await api("/api/push", { endpoint: sub.endpoint })
}

yesEl.addEventListener("click", async () => {
  offering = false
  render()
  if (await Notification.requestPermission() === "granted") subscribe().catch(() => {})
  else localStorage.setItem("glitch.push", "no")
})
noEl.addEventListener("click", () => {
  offering = false
  localStorage.setItem("glitch.push", "no")
  render()
})

// --- the mic: kept open while the page is visible, so a press catches the first syllable ---

let stream = null, asking = null, analyser = null, source = null
const samples = new Float32Array(1024)

function mic() {
  if (stream) return Promise.resolve(stream)
  return asking ||= navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
    if (document.hidden) { s.getTracks().forEach(t => t.stop()); throw new DOMException("hidden", "AbortError") }
    stream = s
    analyser = ac.createAnalyser()
    analyser.fftSize = samples.length
    source = ac.createMediaStreamSource(s)
    source.connect(analyser)
    return s
  }).finally(() => { asking = null })
}

function dropMic() {
  stream?.getTracks().forEach(t => t.stop())
  source?.disconnect()
  stream = analyser = source = null
}

// --- hold to talk ---

let press = null

function begin(p) {
  p.begun = true
  chime("start")
  local = "listening"
  show()
}

function record(p) {
  mic().then(s => {
    if (press !== p) return
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t))
    p.rec = new MediaRecorder(s, type ? { mimeType: type } : undefined)
    p.chunks = []
    p.rec.ondataavailable = e => { if (e.data.size) p.chunks.push(e.data) }
    p.rec.start()
  }, e => {
    if (e.name === "AbortError") return
    if (press === p) press = null
    clearTimeout(p.timer)
    chime("unsure")
    note = e.name === "NotAllowedError" ? "Microphone blocked: allow it for this site" : "No microphone"
    local = null
    show()
  })
}

canvas.addEventListener("contextmenu", e => e.preventDefault())
canvas.addEventListener("pointerdown", e => {
  if (press || e.button > 0) return
  canvas.setPointerCapture(e.pointerId)
  offering = false
  if (offline) { unlock(); press = { id: e.pointerId, away: true }; return render() }
  const first = !unlocked
  unlock()
  note = ""
  bodyEl.hidden = true
  if (first && queue.length) { press = { id: e.pointerId }; return }
  const speaking = !!(playing || queue.length)
  hush(true)
  const p = press = { id: e.pointerId, t: performance.now() }
  if (speaking) p.timer = setTimeout(() => begin(p), TAP_MS)
  else begin(p)
  record(p)
})

function release(e) {
  const p = press
  if (!p || (e && e.pointerId !== p.id)) return
  if (e) unlock()
  press = null
  if (p.away) return void ac.resume().then(() => chime("unsure"), () => {})
  clearTimeout(p.timer)
  if (!p.t) return
  const rec = p.rec
  if (performance.now() - p.t < TAP_MS || !rec) {
    rec?.stop()
    if (p.begun) { local = null; note ||= "hold to talk"; show() }
    return
  }
  chime("stop")
  local = "transcribing"
  show()
  rec.onstop = () => send(new Blob(p.chunks, { type: rec.mimeType }))
  rec.stop()
}
canvas.addEventListener("pointerup", release)
canvas.addEventListener("pointercancel", release)

function failed(msg) {
  chime("unsure")
  note = msg
  local = null
  show()
}

async function send(blob) {
  let r
  try {
    r = await fetch("/api/talk", { method: "POST", headers: { "Content-Type": blob.type.split(";")[0] || "audio/webm" }, body: blob })
  } catch { return failed("Couldn't reach glitch") }
  if (r.status === 401) return pair()
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.outcome === "error") return failed(j.error === "audio" ? "Couldn't read that recording" : "Something went wrong")
  if (j.outcome === "turn" && local === "transcribing") {
    awaiting = setTimeout(() => { awaiting = 0; local = null; show() }, 4000)
    return
  }
  local = null
  show()
}

// --- the screen stays on while a phone turn or the talk around it runs ---

let lock = null, wantLock = false
function wake() {
  const s = server?.state
  wantLock = !document.hidden && !!(turn === "phone" || local || playing || WORK.has(s) || s === "speaking")
  if (wantLock && !lock && navigator.wakeLock) {
    lock = navigator.wakeLock.request("screen").catch(() => null)
    lock.then(l => {
      if (!l) { lock = null; return }
      l.onrelease = () => { lock = null }
      if (!wantLock) l.release()
    })
  } else if (!wantLock && lock) lock.then(l => l?.release())
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    release()
    dropMic()
    orb.stop()
  } else {
    orb.start()
    if (offline || !es) probe()
    else opened()
  }
  wake()
})

show()
orb.start()
