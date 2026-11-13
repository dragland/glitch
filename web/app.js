// The phone portal (libexec/portal serves it; its docstring is the wire format).
import { createOrbView } from "./orb.js"

const $ = id => document.getElementById(id)
const canvas = $("orb"), textEl = $("text"), saidEl = $("said"), lineEl = $("line"), hintEl = $("hint"), moreEl = $("more")
const spokenEl = $("spoken"), askEl = $("ask"), qtEl = $("qt"), nEl = $("n"), labelEl = $("label"), drainEl = $("drain")
const allowEl = $("allow"), denyEl = $("deny"), stopEl = $("stop")
const awayEl = $("away"), offerEl = $("offer"), yesEl = $("yes"), noEl = $("no")
const TAP_MS = 250, HANDOFF_MS = 30000, RELOAD_MS = 30000, ARM_MS = 400, UNHEARD_MS = 4000, CLOCK_AFTER = 10
const WORK = new Set(["thinking", "tool"])
// The orb's centre as a fraction of the height, its resting radius in stage px, and in those radii
// the talk target and the line past which a held recording is discarded.
const CY = 0.38, ORB_R = 135, TARGET = 1.5, AWAY = 2
// Seconds per word for his words, how early a spoken word shows, the envelope level that counts
// as voiced, the longest quiet inside speech that doesn't pause the words, and how far a pause
// may be from where a word after punctuation would fall and still be taken as its pause.
const WORD_S = 0.025, LEAD_S = 0.05, VOICED = 8, GAP_S = 0.12, SNAP_S = 0.6
const BUZZ = { start: 12, sent: [12, 70, 12], ask: [40, 80, 40, 80, 40], failed: [180] }

const pair = () => { location.href = "/pair" }
const buzz = p => navigator.vibrate?.(p)
const talked = () => !!localStorage.getItem("glitch.talked")

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

// The context time of what the speaker is playing now. getOutputTimestamp reads 0 until output starts.
function heardNow() {
  const o = ac.getOutputTimestamp?.()
  return o?.contextTime > 0 ? o.contextTime : ac.currentTime - (ac.outputLatency || 0)
}

// --- the orb ---

const opts = {
  dpr: Math.min(2, devicePixelRatio || 1),
  origin: (W, H) => [W / 2, H * CY],
  onBeforeStep(f) {
    if (!f.listening || !analyser) return
    analyser.getFloatTimeDomainData(samples)
    let peak = 0
    for (const v of samples) peak = Math.max(peak, Math.abs(v))
    orb.mic(Math.min(1, peak))
  },
  persist: true
}
const fit = () => {
  opts.scale = Math.min(innerWidth, innerHeight * 0.75) / 590
  document.documentElement.style.setProperty("--top", `${CY * innerHeight + TARGET * ORB_R * opts.scale}px`)
}
fit()
addEventListener("resize", fit)
const reach = e => Math.hypot(e.clientX - innerWidth / 2, e.clientY - CY * innerHeight) / (ORB_R * opts.scale)

let server = null, local = null, turn = null, approvals = []
let heard = "", reply = null, note = "", awaiting = 0, offering = false
let cleared = false, typeHeard = false, since = 0, doing = "", armed = 0
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

// --- what the text area shows ---

const mss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

function status() {
  if (offline) return "Can't reach home"
  if (local === "listening") return press?.discard ? "release to discard" : press?.at ? mss((Date.now() - press.at) / 1000) : ""
  if (local) return ""
  if (note) return note
  if (turn === "desk") return "thinking"
  const s = server?.state, d = server?.detail || ""
  if (turn === "phone" && WORK.has(s)) return working(s, d)
  if (s === "idle" && d && d !== heard) return d
  if (!heard && !reply && !talked()) return "hold to talk"
  return ""
}

function working(s, d) {
  const told = d && d !== heard && !d.startsWith("approved: ")
  if (s === "tool" && told) doing = describe(d)
  const what = (s === "tool" ? doing : told && d) || "thinking", t = (Date.now() - since) / 1000
  return t >= CLOCK_AFTER ? `${what} · ${mss(t)}` : what
}

// bin/glitch's tool labels ("<Tool>: <what>", the adapters' tlabel/toolline) as what it's doing.
const VERBS = {
  Bash: a => "running " + program(a), Shell: a => "running " + program(a),
  Read: a => "reading " + file(a), LS: a => "listing " + file(a),
  Edit: a => "editing " + file(a), MultiEdit: a => "editing " + file(a), NotebookEdit: a => "editing " + file(a),
  Write: a => "writing " + file(a), Delete: a => "deleting " + file(a),
  Grep: () => "searching files", Glob: () => "finding files",
  WebFetch: a => "reading " + (/^\w+:\/\/(?:www\.)?([^/]+)/.exec(a)?.[1] || "a web page"),
  WebSearch: () => "searching the web", ToolSearch: () => "looking up tools",
  Task: () => "delegating", Agent: () => "delegating",
  TodoWrite: () => "updating the to-do list", Skill: () => "loading a skill",
  BashOutput: () => "checking a background command",
  KillShell: () => "stopping a background command", KillBash: () => "stopping a background command"
}
const WRAPPERS = /^(sudo|doas|env|time|nice|nohup|exec|command|timeout|\d+[smhd]?|\w+=\S*)$/
const SUBCOMMANDS = new Set(["git", "npm", "pnpm", "yarn", "bun", "cargo", "go", "make", "systemctl", "docker", "podman",
  "pacman", "yay", "uv", "pip", "gh", "kubectl"])

function describe(label) {
  const [, name, arg = ""] = /^([^\s:]+)(?:: ([\s\S]*))?$/.exec(label) || [null, label]
  if (VERBS[name]) return VERBS[name](arg.trim())
  if (name.startsWith("mcp__")) return "using " + name.split("__")[1]
  if (/^[\w-]+\.\w+$/.test(name)) return "using " + name.split(".")[0]
  return name
}

function file(path) {
  const p = path.replace(/ \+\d+$/, "").replace(/\/+$/, "")
  return !p || p.endsWith("…") ? "a file" : p.split("/").pop()
}

function program(cmd) {
  for (const part of cmd.replace(/…$/, "").split(/&&|\|\||[;|]/)) {
    const w = part.trim().split(/\s+/).filter(Boolean)
    while (w.length && WRAPPERS.test(w[0])) w.shift()
    if (!w.length || w[0] === "cd") continue
    const p = w[0].replace(/^['"(]+/, "").split("/").pop()
    return SUBCOMMANDS.has(p) && /^[a-z][\w-]*$/.test(w[1] || "") ? `${p} ${w[1]}` : p
  }
  return "a command"
}

const shownReply = () =>
  !offline && local !== "listening" && !note && !cleared && turn !== "desk" && reply?.shown ? reply : null

let saidFor = "", lineFor = null, moreFor = null

function render() {
  if (update()) return
  const a = offline ? null : approvals[0]
  awayEl.hidden = !offline
  offerEl.hidden = !offering || offline || !!a
  stopEl.hidden = !turn || offline || !!a || local === "listening"
  card(a)
  const r = shownReply()
  said(r || offline || local === "listening" || cleared || turn === "desk" ? "" : heard)
  if (r) line(r)
  else statusLine(status())
  hintEl.hidden = !r || unlocked || !queue.length
  more(r?.shown === "full" ? r.extra ??= extra(r) : "", r)
  edges()
  wake()
}

function said(text) {
  if (text === saidFor) return
  saidFor = text
  textEl.scrollTop = 0
  drop(saidEl)
  if (text && typeHeard) {
    const t0 = performance.now() / 1000
    type(saidEl, text, words(text).map((_, i) => t0 + i * WORD_S), () => performance.now() / 1000)
  } else saidEl.textContent = text
  if (text) typeHeard = false
}

function line(r) {
  lineEl.classList.remove("status")
  if (lineFor === r) return
  lineFor = r
  textEl.scrollTop = 0
  drop(lineEl)
  spokenEl.textContent = r.summary
  if (r.shown === "typing") r.typer = type(lineEl, r.summary, r.times, heardNow, () => { r.shown = "full"; render() })
  else lineEl.textContent = r.summary
}

function statusLine(s) {
  lineEl.classList.add("status")
  if (lineFor === s) return
  lineFor = s
  drop(lineEl)
  lineEl.textContent = s
}

function more(text, r) {
  moreEl.hidden = !text
  if (!text || moreFor === r) return
  moreFor = r
  moreEl.replaceChildren(...format(text))
}

function edges() {
  const t = textEl
  t.classList.toggle("above", t.scrollTop > 2)
  t.classList.toggle("below", t.scrollHeight - t.scrollTop - t.clientHeight > 2)
}
textEl.addEventListener("scroll", () => { if (stale) render(); else edges() }, { passive: true })

const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

// The written reply past what was said: paragraphs that only repeat the spoken line are left out.
function extra(r) {
  const s = norm(r.summary)
  const rest = (r.body || "").split(/\n\s*\n/).filter(p => norm(p) !== s).join("\n\n").trim()
  return norm(rest) && !s.includes(norm(rest)) ? rest : ""
}

const make = (tag, text) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e }

// Plain text with ``` fences as code blocks and `x` as inline code; nothing else is markup.
function format(text) {
  const out = []
  text.split(/^[ \t]*```.*$/m).forEach((part, i) => {
    if (i % 2) return out.push(make("pre", part.replace(/^\n|\n$/g, "")))
    for (const para of part.split(/\n\s*\n/)) {
      if (!para.trim()) continue
      const p = make("p"), bits = para.trim().split("`")
      if (bits.length % 2 === 0) bits.splice(0, bits.length, bits.join("`"))
      bits.forEach((bit, j) => {
        if (j % 2) return p.append(make("code", bit))
        bit.split("\n").forEach((ln, k) => { if (k) p.append(make("br")); p.append(ln) })
      })
      out.push(p)
    }
  })
  return out
}

// --- words that arrive: each fades in at its time on a clock (seconds) ---

const words = text => text.match(/\S+\s*/g) || []
const typers = new Set()
let ticking = 0

function type(el, text, times, clock, onend) {
  const t = { el, spans: [], times, clock, onend, i: 0 }
  el.textContent = ""
  for (const w of words(text)) t.spans.push(el.appendChild(Object.assign(make("span", w), { className: "w", ariaHidden: "true" })))
  typers.add(t)
  ticking ||= requestAnimationFrame(tick)
  return t
}

function tick() {
  ticking = 0
  for (const t of typers) {
    const now = t.clock()
    while (t.i < t.spans.length && now >= t.times[t.i]) t.spans[t.i++].classList.add("on")
    if (t.i === t.spans.length) done(t)
  }
  if (typers.size && !ticking) ticking = requestAnimationFrame(tick)
}

function finish(t) {
  if (!t || !typers.has(t)) return
  for (const s of t.spans) s.classList.add("on")
  done(t)
}

function done(t) {
  typers.delete(t)
  t.onend?.()
}

function drop(el) {
  for (const t of typers) if (t.el === el) typers.delete(t)
}

// When each word starts, in seconds into the clip. Words share the voiced frames of the envelope
// by their length, so the text waits while the voice pauses, and a word after punctuation starts
// where the nearest pause ends. Linear over the clip without an envelope.
function speechTimes(ws, ms, env) {
  const at = [0]
  for (const w of ws) at.push(at.at(-1) + w.length)
  const total = at.pop() || 1
  const [hz, ...v] = (env || "").split(" ").map(Number)
  const on = v.map(x => x >= VOICED), resumes = [], before = [0]
  let last = -1
  for (let k = 0; k < on.length; k++) if (on[k]) {
    if (last >= 0 && k - last - 1 <= GAP_S * hz) on.fill(true, last + 1, k)
    else if (last >= 0) resumes.push(k)
    last = k
  }
  for (const x of on) before.push(before.at(-1) + x)
  if (!(hz > 0) || before.at(-1) < 3) return at.map(c => c / total * ms / 1000)
  const frame = (c, a, b) => {
    const goal = before[a[1]] + (c - a[0]) / (b[0] - a[0]) * (before[b[1]] - before[a[1]])
    let k = a[1]
    while (k < b[1] && before[k + 1] <= goal) k++
    return k
  }
  const anchors = [[0, on.indexOf(true)], [total, on.length]]
  const marks = at.filter((c, i) => i > 0 && /[,.;:!?]["')\]]?\s*$/.test(ws[i - 1]))
    .map(c => [c, frame(c, ...anchors)])
  for (const k of resumes) {
    const near = marks.reduce((m, x) => Math.abs(x[1] - k) < Math.abs((m?.[1] ?? -1e9) - k) ? x : m, null)
    if (!near || Math.abs(near[1] - k) > SNAP_S * hz) continue
    const i = anchors.findIndex(a => a[0] > near[0])
    if (anchors[i - 1][0] < near[0] && anchors[i - 1][1] < k && anchors[i][1] > k) anchors.splice(i, 0, [near[0], k])
  }
  return at.map(c => {
    const i = anchors.findIndex(a => a[0] > c)
    return frame(c, anchors[i - 1], anchors[i]) / hz
  })
}

// A reply shows in step with its say clip when that will be heard now, else at once.
function setReply(r, audible) {
  if (r && reply && r.summary === reply.summary && r.body === reply.body) return
  if (reply) full(reply)
  reply = r
  if (!r) return
  if (audible && unlocked && !document.hidden && local !== "listening") r.wait = setTimeout(() => { full(r); render() }, UNHEARD_MS)
  else r.shown = "full"
}

function speak(r, at, c) {
  clearTimeout(r.wait)
  r.times = speechTimes(words(r.summary), c.ms, c.env).map(t => at + t - LEAD_S)
  r.shown = "typing"
  render()
}

function full(r) {
  clearTimeout(r.wait)
  r.shown = "full"
  finish(r.typer)
}

// --- approvals ---

function card(a) {
  askEl.hidden = !a
  if (!a) return void delete askEl.dataset.id
  nEl.hidden = approvals.length < 2
  nEl.textContent = `${approvals.length - 1} more after this`
  if (askEl.dataset.id === a.id) return
  askEl.dataset.id = a.id
  armed = performance.now() + ARM_MS
  const q = (a.ask || "Okay to do that?").replace(/^need you:\s*/i, "")
  qtEl.textContent = q[0].toUpperCase() + q.slice(1)
  labelEl.textContent = a.label.replace(/^(Bash|Shell|Edit|MultiEdit|Write|NotebookEdit): /, "")
  labelEl.scrollTop = 0
  allowEl.disabled = denyEl.disabled = false
  drainEl.getAnimations().forEach(x => x.cancel())
  drainEl.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: (a.timeout || 60) * 1000, fill: "forwards" })
}

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
    if (playing === p) {
      playing = null
      if (c.kind === "say" && reply && !reply.shown) full(reply)
      api("/api/played", { id: c.id })
      pump()
      render()
    }
    return
  }
  if (playing !== p) return
  const at = Math.max(ac.currentTime, cue ? cue + c.delay / 1000 : 0)
  p.src = sound(buf, at)
  started.set(c.id, at)
  if (c.kind === "say" && reply && !reply.shown) speak(reply, at, c)
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
  if (reply) full(reply)
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
allowEl.addEventListener("click", () => { if (performance.now() >= armed) answer(true) })
denyEl.addEventListener("click", () => { if (performance.now() >= armed) answer(false) })
stopEl.addEventListener("click", () => { unlock(); api("/api/cancel").catch(() => {}) })

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
    if (turn === "phone") since ||= Date.now()
    server = h.turn === "phone" ? h.state : null
    approvals = h.approve || []
    heard = h.heard || ""
    setReply(h.reply, (h.replay || []).some(c => c.kind === "say"))
    for (const c of h.replay || []) clip(c)
    if (!local) show()
    opened()
  })
  on("turn", m => {
    if (turn === "phone" && !m.turn && canOffer()) offering = true
    if (m.turn === "phone" && turn !== "phone") since = Date.now()
    turn = m.turn
  })
  on("state", m => {
    server = m
    if (m.state === "error") buzz(BUZZ.failed)
    if (awaiting) { clearTimeout(awaiting); awaiting = 0; local = null }
    if (!local) orb.set({ state: m.state, reaction: m.reaction })
  })
  on("signal", m => {
    if (m.line === "turn" || m.line === "rest") approvals = []
    orb.event(m.line)
  })
  on("heard", m => {
    heard = m.text
    setReply(null)
    note = doing = ""
    cleared = false
    typeHeard = true
    since = Date.now()
  })
  on("reply", m => {
    setReply(m, true)
    if (local !== "listening") cleared = false
  })
  on("clip", clip)
  on("approve", m => {
    if (approvals.some(a => a.id === m.id)) return
    approvals.push(m)
    buzz(BUZZ.ask)
  })
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
setInterval(() => { if (local === "listening" || turn) render() }, 250)

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
  if (typers.size || textEl.scrollTop > 0) return false
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

// --- hold to talk: only the orb and its halo; a touch elsewhere only hushes ---

let press = null, poke = null

function begin(p) {
  p.begun = true
  p.at = Date.now()
  cleared = true
  chime("start")
  buzz(BUZZ.start)
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
  if (press || e.button > 0 || reach(e) > TARGET) return
  canvas.setPointerCapture(e.pointerId)
  offering = false
  if (offline) { unlock(); press = { id: e.pointerId, offline: true }; return render() }
  const first = !unlocked
  unlock()
  note = ""
  if (first && queue.length) { press = { id: e.pointerId }; return }
  const speaking = !!(playing || queue.length)
  hush(true)
  const p = press = { id: e.pointerId, t: performance.now() }
  if (speaking) p.timer = setTimeout(() => begin(p), TAP_MS)
  else begin(p)
  record(p)
})

canvas.addEventListener("pointermove", e => {
  const p = press
  if (!p?.t || e.pointerId !== p.id || !!p.discard === reach(e) > AWAY) return
  p.discard = !p.discard
  render()
})

function release(e) {
  const p = press
  if (!p || (e && e.pointerId !== p.id)) return
  if (e) unlock()
  press = null
  if (p.offline) return void ac.resume().then(() => chime("unsure"), () => {})
  clearTimeout(p.timer)
  if (!p.t) return
  const rec = p.rec
  if (p.discard || performance.now() - p.t < TAP_MS || !rec) {
    rec?.stop()
    if (p.discard) chime("unsure")
    if (p.begun) { local = null; cleared = false; if (!p.discard) note ||= "hold to talk"; show() }
    return
  }
  chime("stop")
  buzz(BUZZ.sent)
  local = "transcribing"
  show()
  rec.onstop = () => send(new Blob(p.chunks, { type: rec.mimeType }))
  rec.stop()
}
canvas.addEventListener("pointerup", release)
canvas.addEventListener("pointercancel", release)

document.addEventListener("pointerdown", e => {
  const mine = e.target === canvas && reach(e) <= TARGET
  poke = mine || e.target.closest("button, a") ? null : { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }
})
document.addEventListener("pointerup", e => {
  const p = poke
  poke = null
  if (playing && p?.id === e.pointerId && e.timeStamp - p.t < 500 && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 12) {
    hush(true)
    render()
  }
})
document.addEventListener("pointercancel", () => { poke = null })

function failed(msg) {
  chime("unsure")
  buzz(BUZZ.failed)
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
  if (j.outcome !== "empty") localStorage.setItem("glitch.talked", "1")
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
