// The phone portal (libexec/portal serves it; its docstring is the wire format).
import { createOrbView } from "./orb.js"

const $ = id => document.getElementById(id)
const canvas = $("orb"), textEl = $("text"), heardEl = $("heard"), lineEl = $("line"), bodyEl = $("body")
const askEl = $("ask"), labelEl = $("label"), allowEl = $("allow"), denyEl = $("deny"), cancelEl = $("cancel")
const TAP_MS = 250
const WORK = new Set(["thinking", "tool"])

const pair = () => { location.href = "/pair" }

async function api(path, body) {
  const r = await fetch(path, body === undefined ? { method: "POST" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (r.status === 401) pair()
  return r
}

let reactions = {}
{
  const r = await fetch("/api/reactions")
  if (r.status === 401) pair()
  else if (r.ok) reactions = await r.json()
}
const listenLook = () => reactions.listening || null
const restLook = () => reactions.mood?.calm || null

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
  // The orb fades out after a resting state's linger (plugin/orb.mjs); the page keeps it.
  onFrame(f) { if (!f.shown) rest() }
}
const fit = () => { opts.scale = Math.min(innerWidth, innerHeight * 0.75) / 590 }
fit()
addEventListener("resize", fit)
let server = null, local = null, turn = null, approvals = []
let heard = "", reply = null, note = "", awaiting = 0
let orb
try { orb = await createOrbView(canvas, opts) } catch (e) {
  if (/HTTP 401/.test(e.message)) pair()
  note = "Can't draw the orb here"
  orb = { set() {}, event() {}, mic() {}, reduceMotion() {}, start() {}, stop() {}, frame: { shown: true } }
}
const motion = matchMedia("(prefers-reduced-motion: reduce)")
orb.reduceMotion(motion.matches)
motion.addEventListener("change", () => orb.reduceMotion(motion.matches))

function rest() {
  if (server?.state === "needs_you" && approvals.length) orb.set({ state: "needs_you", reaction: server.reaction })
  else orb.set({ state: "ready", reaction: restLook() })
}

function show() {
  if (local) orb.set({ state: local, reaction: listenLook() })
  else if (server) orb.set({ state: server.state, reaction: server.reaction })
  else rest()
  render()
}

function render() {
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

async function answer(allow) {
  const a = approvals[0]
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

function connect() {
  const es = new EventSource("/api/events")
  const on = (type, fn) => es.addEventListener(type, e => { fn(JSON.parse(e.data)); render() })
  on("hello", h => {
    turn = h.turn
    server = h.turn === "phone" ? h.state : null
    approvals = h.approve || []
    heard = h.heard || ""
    reply = h.reply
    for (const c of h.replay || []) clip(c)
    if (!local) show()
  })
  on("turn", m => { turn = m.turn })
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
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) return
    setTimeout(async () => {
      const r = await fetch("/api/reactions").catch(() => null)
      if (r?.status === 401) pair()
      else connect()
    }, 2000)
  }
}
connect()

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
    if (!orb.frame.shown) show()
    orb.start()
  }
  wake()
})

show()
orb.start()
