import { createOrbView } from "./orb.js"
import { SAY_LAG } from "../plugin/orb.mjs"

const $ = id => document.getElementById(id)
const canvas = $("orb"), textEl = $("text"), saidEl = $("said"), lineEl = $("line"), hintEl = $("hint"), moreEl = $("more")
const traceEl = $("trace")
const spokenEl = $("spoken"), askEl = $("ask"), qtEl = $("qt"), nEl = $("n"), labelEl = $("label"), drainEl = $("drain")
const restEl = $("rest"), longEl = $("long"), allowEl = $("allow"), denyEl = $("deny"), stopEl = $("stop")
const installEl = $("install"), awayEl = $("away"), offerEl = $("offer"), yesEl = $("yes"), noEl = $("no")
const TAP_MS = 250, HANDOFF_MS = 30000, RELOAD_MS = 30000, ARM_MS = 400, UNHEARD_MS = 4000, CLOCK_AFTER = 10
const WORK = new Set(["thinking", "tool"])
const ORB_Y_OF_HEIGHT = 0.33, ORB_RADIUS_STAGE_PX = 135, TALK_RADII = 1.5, DISCARD_RADII = 2
const HEARD_S_PER_WORD = 0.025, SPOKEN_LEAD_S = 0.05, VOICED_LEVEL = 8, VOICE_GAP_S = 0.12, PAUSE_SNAP_S = 0.6
const TRACE_SHOWN = 3
const BUZZ = { start: 12, sent: [12, 70, 12], ask: [40, 80, 40, 80, 40], failed: [180] }

let installer = null, booted = false, persisted = false
let reactions = {}, offline = false, shell = null, stale = false
let server = null, local = null, turn = null, approvals = []
let heard = "", reply = null, note = "", awaiting = 0, offering = false
let cleared = false, typeHeard = false, since = 0, armed = 0, lapsed = false
let trace = [], traceFor = null
let orb

// Chrome fires beforeinstallprompt once per page load, possibly during the first await below.
addEventListener("beforeinstallprompt", e => {
  e.preventDefault()
  if (!matchMedia("(display-mode: standalone)").matches) { installer = e; if (booted) render() }
})
addEventListener("appinstalled", () => { installer = null; if (booted) render() })
installEl.addEventListener("click", () => { installer?.prompt(); installer = null; render() })

const pair = () => { location.href = "/pair" }
// navigator.vibrate does nothing before the first tap, or while the ringer is silent.
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
{
  const r = await fetch("/api/reactions").catch(() => null)
  if (r?.status === 401) pair()
  else if (r?.ok) reactions = await r.json()
  shell = r?.headers.get("X-Glitch-Set")
}
const listenLook = () => reactions.listening || null
const restLook = () => reactions.mood?.calm || null
const awayLook = () => reactions.mood?.sorry || null

const ac = new AudioContext()
let unlocked = ac.state === "running", ran = unlocked
const sounds = {}
for (const n of ["start", "stop", "unsure"])
  sounds[n] = fetch(`/sounds/${n}.wav`).then(r => r.arrayBuffer()).then(b => ac.decodeAudioData(b)).catch(() => null)

// Android takes a running context out of "running" (suspended, or Chrome's "interrupted") for a
// phone call, audio focus loss or an output route change. It stays there, its clock stopped,
// until resume().
ac.addEventListener("statechange", audio)

function audio() {
  const was = unlocked
  unlocked = ac.state === "running"
  ran ||= unlocked
  if (!booted || was === unlocked) return
  if (unlocked) pump()
  else interrupted()
  render()
}

// A touch grants user activation on release, not on press (only a mouse's pointerdown
// does), so a phone's first press can't start audio. Audio unlocks on the release.
function unlock() {
  if (ac.state !== "running") ac.resume().then(audio, () => {})
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

// getOutputTimestamp reads 0 until output starts.
function heardNow() {
  const o = ac.getOutputTimestamp?.()
  return o?.contextTime > 0 ? o.contextTime : ac.currentTime - (ac.outputLatency || 0)
}

const opts = {
  dpr: Math.min(2, devicePixelRatio || 1),
  origin: (W, H) => [W / 2, H * ORB_Y_OF_HEIGHT],
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
  opts.scale = Math.min(innerWidth, innerHeight * 0.75) / 520
  document.documentElement.style.setProperty("--top", `${ORB_Y_OF_HEIGHT * innerHeight + TALK_RADII * ORB_RADIUS_STAGE_PX * opts.scale}px`)
}
fit()
addEventListener("resize", fit)
const reach = e => Math.hypot(e.clientX - innerWidth / 2, e.clientY - ORB_Y_OF_HEIGHT * innerHeight) / (ORB_RADIUS_STAGE_PX * opts.scale)

try { orb = await createOrbView(canvas, opts) } catch (e) {
  if (/HTTP 401/.test(e.message)) pair()
  note = "can't draw the orb here"
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

const mss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

function status() {
  if (offline) return "can't reach home"
  if (local === "listening") return press?.discard ? "release to discard" : press?.at ? mss((Date.now() - press.at) / 1000) : ""
  if (local) return ""
  if (note) return note
  if (turn === "desk") return "thinking"
  const s = server?.status || "", t = (Date.now() - since) / 1000
  if (s && turn === "phone" && WORK.has(server.state) && t >= CLOCK_AFTER) return `${s} · ${mss(t)}`
  if (s) return s
  if (!heard && !reply && !talked()) return "hold to talk"
  return ""
}

const tidy = s => {
  const t = (s || "").replace(/^need you:\s*/i, "")
  return t && t[0].toUpperCase() + t.slice(1)
}

const shownReply = () =>
  !offline && local !== "listening" && !note && !cleared && turn !== "desk" && reply?.shown ? reply : null

let saidFor = "", lineFor = null, moreFor = null

function render() {
  // Android keeps a hidden page's stream open for a while. Closed, this server sees no page and pushes.
  if (document.hidden && !playing && es) leave()
  if (update()) return
  const a = offline ? null : approvals[0], busy = !!turn || local === "listening"
  awayEl.hidden = !offline
  installEl.hidden = !installer || offline || !!a || busy || offering
  offerEl.hidden = !offering || offline || !!a || busy
  stopEl.hidden = !turn || offline || !!a || local === "listening"
  card(a)
  const r = shownReply()
  said(r || offline || local === "listening" || cleared || turn === "desk" ? "" : heard)
  if (r) line(r)
  else statusLine(status())
  traced(r || a || offline || local === "listening" || cleared || turn === "desk" ? [] : trace)
  hintEl.hidden = !r || unlocked || !queue.length
  more(r?.shown === "full" ? r.extra ??= extra(r) : "", r)
  edges(textEl)
  wake()
}

function said(text) {
  if (text === saidFor) return
  saidFor = text
  textEl.scrollTop = 0
  drop(saidEl)
  if (text && typeHeard) {
    const t0 = performance.now() / 1000
    type(saidEl, text, words(text).map((_, i) => t0 + i * HEARD_S_PER_WORD), () => performance.now() / 1000)
  } else saidEl.textContent = text
  if (text) typeHeard = false
}

function line(r) {
  lineEl.classList.remove("status")
  if (lineFor === r) return
  lineFor = r
  textEl.scrollTop = 0
  drop(lineEl)
  const text = tidy(r.summary)
  spokenEl.textContent = text
  if (r.shown === "typing") r.typer = type(lineEl, text, r.times, heardNow, () => { r.shown = "full"; render() })
  else lineEl.textContent = text
}

function traced(list) {
  const rows = list.filter(t => t.kind !== "zh" || t.heard).slice(-TRACE_SHOWN).reverse()
  const key = rows.map(t => t.n + (t.heard || "")).join()
  traceEl.hidden = !rows.length
  if (key === traceFor) return
  traceFor = key
  const row = (text, cls) => {
    const e = make("p", text, cls), k = `${cls} ${text}`
    if (tracedRows.has(k)) e.style.animation = "none"
    tracedRows.add(k)
    return e
  }
  if (!rows.length) tracedRows.clear()
  traceEl.replaceChildren(...rows.flatMap(t => t.kind !== "zh" ? [row(t.text, t.kind)]
    : [hanzi(t, row(t.ruby?.length ? "" : t.zh, "zh")), ...t.heard === "done" ? [row(t.text, "en")] : []]))
}
const tracedRows = new Set()

function hanzi(t, p) {
  p.lang = "zh-Hans"
  for (const [text, py] of t.ruby || []) {
    if (!py) { p.append(text); continue }
    const r = make("ruby", text)
    r.append(Object.assign(make("rt", py), { lang: "zh-Latn-pinyin" }))
    p.append(r)
  }
  return p
}

let traceN = 0
const traceIn = (t, restored) => ({ ...t, n: ++traceN, heard: restored && t.kind === "zh" ? "done" : "" })
const muttered = (id, how) => { const t = trace.find(t => t.clip === id); if (t && t.heard !== "done") t.heard = how }

function dropMutters() {
  for (const c of queue) if (c.kind === "mutter") muttered(c.id, "done")
  queue = queue.filter(c => c.kind !== "mutter")
  if (playing?.c.kind !== "mutter") return
  muttered(playing.c.id, "done")
  stop(playing)
  playing = null
  orb.event("hush")
  pump()
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

function edges(el) {
  const below = el.scrollHeight - el.scrollTop - el.clientHeight
  el.classList.toggle("above", el.scrollTop > 2)
  el.classList.toggle("below", below > 2)
  return below
}
textEl.addEventListener("scroll", () => { if (stale) render(); else edges(textEl) }, { passive: true })

const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

function extra(r) {
  const s = norm(r.summary)
  const rest = (r.body || "").split(/\n\s*\n/).filter(p => norm(p) !== s).join("\n\n").trim()
  return norm(rest) && !s.includes(norm(rest)) ? rest : ""
}

const make = (tag, text, className) => {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  if (className) e.className = className
  return e
}

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

const words = text => text.match(/\S+\s*/g) || []
const typers = new Set()
let ticking = 0

function type(el, text, times, clock, onend) {
  const t = { el, spans: [], times, clock, onend, i: 0 }
  el.textContent = ""
  for (const w of words(text)) t.spans.push(el.appendChild(Object.assign(make("span", w, "w"), { ariaHidden: "true" })))
  el.append(make("span", text, "sr"))
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

function speechTimes(ws, ms, env) {
  const at = [0]
  for (const w of ws) at.push(at.at(-1) + w.length)
  const total = at.pop() || 1
  const [hz, ...v] = (env || "").split(" ").map(Number)
  const on = v.map(x => x >= VOICED_LEVEL), resumes = [], before = [0]
  let last = -1
  for (let k = 0; k < on.length; k++) if (on[k]) {
    if (last >= 0 && k - last - 1 <= VOICE_GAP_S * hz) on.fill(true, last + 1, k)
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
    if (!near || Math.abs(near[1] - k) > PAUSE_SNAP_S * hz) continue
    const i = anchors.findIndex(a => a[0] > near[0])
    if (anchors[i - 1][0] < near[0] && anchors[i - 1][1] < k && anchors[i][1] > k) anchors.splice(i, 0, [near[0], k])
  }
  return at.map(c => {
    const i = anchors.findIndex(a => a[0] > c)
    return frame(c, anchors[i - 1], anchors[i]) / hz
  })
}

function setReply(r, audible) {
  if (r && reply && r.summary === reply.summary && r.body === reply.body) return
  if (reply) full(reply)
  reply = r
  if (!r) return
  if (audible && r.speech !== false && unlocked && !document.hidden && local !== "listening")
    r.wait = setTimeout(() => { full(r); render() }, UNHEARD_MS)
  else r.shown = "full"
}

function speak(r, at, c) {
  clearTimeout(r.wait)
  const all = words(r.summary), shown = words(tidy(r.summary)).length
  r.times = speechTimes(all, c.ms, c.env).slice(all.length - shown).map(t => at + t - SPOKEN_LEAD_S)
  r.shown = "typing"
  render()
}

function full(r) {
  clearTimeout(r.wait)
  r.shown = "full"
  finish(r.typer)
}

const received = a => ({ ...a, got: performance.now() })

function command(label) {
  return label.split(/(\n(?:[^\S\n]*\n){3,})/).flatMap((s, i) =>
    i % 2 ? ["\n", make("span", `⏎ ×${s.split("\n").length - 2}`, "dim"), "\n"] : s ? [s] : [])
}

function card(a) {
  askEl.hidden = !a
  if (!a) return void delete askEl.dataset.id
  nEl.hidden = approvals.length < 2
  nEl.textContent = `${approvals.length - 1} more after this`
  if (askEl.dataset.id === a.id) return void commandEdges()
  askEl.dataset.id = a.id
  armed = performance.now() + ARM_MS
  qtEl.textContent = a.ask || ""
  const cut = a.cut > 0
  labelEl.replaceChildren(...command(a.label || ""), ...cut ? ["\n", make("span", `${a.cut} more characters not shown`, "dim")] : [])
  allowEl.hidden = cut
  longEl.hidden = !cut
  labelEl.scrollTop = 0
  allowEl.disabled = denyEl.disabled = false
  const total = a.timeout || 60, left = Math.max(0, Math.min(total, (a.left ?? total) - (performance.now() - a.got) / 1000))
  drainEl.getAnimations().forEach(x => x.cancel())
  drainEl.animate([{ transform: `scaleX(${left / total})` }, { transform: "scaleX(0)" }], { duration: left * 1000, fill: "forwards" })
  commandEdges()
}

function commandEdges() {
  const below = edges(labelEl), n = Math.ceil(below / (parseFloat(getComputedStyle(labelEl).lineHeight) || 19))
  restEl.hidden = below <= 2
  restEl.textContent = n === 1 ? "1 more line" : `${n} more lines`
}
labelEl.addEventListener("scroll", commandEdges, { passive: true })

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
    if (c.kind === "mutter") muttered(c.id, "done")
    else if (c.kind !== "cue") api("/api/played", { id: c.id })
    return
  }
  if (c.kind === "mutter" && (!unlocked || document.hidden || approvals.length)) return void muttered(c.id, "done")
  if (c.kind !== "cue" && c.kind !== "mutter") dropMutters()
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
  if (playing || !queue.length || !unlocked || document.hidden) return
  const c = queue.shift(), p = playing = { c }
  let buf, cue
  try { [buf, cue] = await Promise.all([load(c), c.with && started.get(c.with)]) } catch {
    if (playing === p) {
      playing = null
      if (c.kind === "say" && reply && !reply.shown) full(reply)
      if (c.kind === "mutter") muttered(c.id, "done")
      else api("/api/played", { id: c.id })
      pump()
      render()
    }
    return
  }
  if (playing !== p) return
  if (ac.state !== "running") {
    unlocked = false
    interrupted()
    return render()
  }
  const at = Math.max(ac.currentTime, cue ? cue + c.delay / 1000 : 0)
  p.src = sound(buf, at)
  started.set(c.id, at)
  if (c.kind === "say" && reply && !reply.shown) speak(reply, at, c)
  if (c.kind === "mutter") setTimeout(() => { if (playing === p) { muttered(c.id, "on"); render() } }, Math.max(0, (at - ac.currentTime + (ac.outputLatency || 0)) * 1000))
  const ms = (at - ac.currentTime + Math.max(0, (ac.outputLatency || 0) - SAY_LAG)) * 1000
  p.timer = setTimeout(() => { if (c.env) orb.event("say " + c.env) }, ms)
  p.src.onended = () => {
    if (playing !== p) return
    playing = null
    if (c.kind === "mutter") muttered(c.id, "done")
    else api("/api/played", { id: c.id })
    pump()
    render()
  }
  render()
}

function stop(p) {
  clearTimeout(p.timer)
  try { p.src?.stop() } catch {}
}

function interrupted() {
  if (reply) full(reply)
  if (!playing) return
  stop(playing)
  if (playing.c.kind === "mutter") muttered(playing.c.id, "done")
  else queue.unshift(playing.c)
  playing = null
  orb.event("hush")
}

function forget() {
  lapsed = false
  heard = note = ""
  trace = []
  setReply(null)
  server = null
  hush(false)
  if (!local) show()
}

function hush(ack) {
  if (reply) full(reply)
  if (!playing && !queue.length) return
  for (const t of trace) if (t.kind === "zh") t.heard = "done"
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
  if (!a || (allow && (a.cut > 0 || a.refused))) return
  unlock()
  allowEl.disabled = denyEl.disabled = true
  const r = await api("/api/approve", { id: a.id, allow }).catch(() => null)
  if (r?.status === 409) answered(a.id)
  else if (r?.status === 422 && allow) { a.refused = true; allowEl.hidden = true; longEl.hidden = false; denyEl.disabled = false }
  else if (!r?.ok) allowEl.disabled = denyEl.disabled = false
  render()
}
allowEl.addEventListener("click", () => { if (performance.now() >= armed) answer(true) })
denyEl.addEventListener("click", () => { if (performance.now() >= armed) answer(false) })
stopEl.addEventListener("click", () => { unlock(); api("/api/cancel").catch(() => {}) })

const LOST_MS = 3000, PROBE_MS = 3000
let es = null, lost = 0, probing = 0, synced, met = false, opening = true

function goOffline() {
  leave()
  if (!offline) {
    offline = true
    server = turn = null
    approvals = []
    show()
  }
  probeSoon(PROBE_MS)
}

function leave() {
  clearTimeout(lost)
  lost = 0
  clearTimeout(probing)
  es?.close()
  es = null
}

function probeSoon(ms) {
  clearTimeout(probing)
  probing = setTimeout(probe, ms)
}

async function probe(asked = notice()) {
  clearTimeout(probing)
  const r = await asked
  if (document.hidden) return
  if (r?.status === 401) return pair()
  const open = es?.readyState === EventSource.OPEN
  if (r?.ok) { if (!es || (lost && !open)) { es?.close(); connect() } }
  else if (!met || offline) goOffline()
  else if (!open) { lost ||= setTimeout(goOffline, LOST_MS); probeSoon(500) }
}

function reconnect() {
  opening = true
  leave()
  connect()
  probe()
}

function connect() {
  if (document.hidden) return
  const me = es = new EventSource("/api/events")
  const on = (type, fn) => me.addEventListener(type, e => { fn(JSON.parse(e.data)); render() })
  on("hello", h => {
    clearTimeout(lost)
    lost = 0
    offline = false
    met = true
    if (!persisted) { persisted = true; navigator.storage?.persist?.().catch(() => {}) }
    if (synced !== globalThis.Notification?.permission) sync()
    if (opening && !h.turn && canOffer()) offering = true
    opening = false
    turn = h.turn
    if (turn === "phone") since ||= Date.now()
    else if (!turn) orb.event("rest")
    approvals = (h.approve || []).map(received)
    const replay = h.replay || []
    if (!(lapsed && !h.heard && !h.reply)) {
      lapsed = false
      server = h.state || null
      heard = h.heard || ""
      trace = (h.trace || []).map(t => trace.find(o => o.clip && o.clip === t.clip) || traceIn(t, true))
      setReply(h.reply, replay.some(c => c.kind === "say"))
    }
    dropMutters()
    if (playing && !replay.some(x => x.id === playing.c.id)) { stop(playing); playing = null; orb.event("hush") }
    queue = queue.filter(c => replay.some(x => x.id === c.id))
    for (const c of replay) clip(c)
    pump()
    if (!local) show()
    opened()
  })
  on("turn", m => {
    if (turn === "phone" && !m.turn && canOffer()) offering = true
    if (m.turn === "phone" && turn !== "phone") since = Date.now()
    if (m.turn) note = ""
    turn = m.turn
  })
  on("state", m => {
    server = m
    if (m.state === "error") buzz(BUZZ.failed)
    if (awaiting) { clearTimeout(awaiting); awaiting = 0; local = null }
    if (!local) orb.set({ state: m.state, reaction: m.reaction })
  })
  on("trace", m => { trace.push(traceIn(m)) })
  on("signal", m => {
    if (m.line === "turn" || m.line === "rest") approvals = []
    if (m.line === "turn") trace = []
    orb.event(m.line)
  })
  on("heard", m => {
    heard = m.text
    trace = []
    setReply(null)
    note = ""
    cleared = false
    typeHeard = true
    since = Date.now()
    lapsed = false
  })
  on("fresh", m => {
    if (m.idle && !document.hidden) lapsed = true
    else forget()
  })
  on("reply", m => {
    dropMutters()
    setReply(m, true)
    if (local !== "listening") cleared = false
  })
  on("clip", clip)
  on("approve", m => {
    if (approvals.some(a => a.id === m.id)) return
    approvals.push(received(m))
    dropMutters()
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

const canOffer = () => "PushManager" in window && !!navigator.serviceWorker?.controller &&
  Notification.permission === "default" && !localStorage.getItem("glitch.push")

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
  const a = approvals.find(a => a.id === id)
  if (Date.now() - at < HANDOFF_MS && !document.hidden && a?.oneline && !(a.cut > 0)) answer(true, id)
}

function update() {
  if (!stale || document.hidden || turn || local || press || playing || queue.length || approvals.length || WORK.has(server?.state)) return false
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
  if (!r.ok) throw new Error(`key ${r.status}`)
  const key = bytes((await r.json()).key)
  let sub = await reg.pushManager.getSubscription()
  const old = sub && new Uint8Array(sub.options.applicationServerKey || [])
  // PushManager refuses to subscribe with a different key while an old subscription exists.
  if (sub && old.join() !== key.join()) { await sub.unsubscribe(); sub = null }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const sent = await api("/api/push", { endpoint: sub.endpoint })
  if (!sent.ok) throw new Error(`endpoint ${sent.status}`)
}

function sync() {
  synced = globalThis.Notification?.permission
  if (synced === "granted") subscribe().catch(() => { synced = null })
  else if (synced) api("/api/push", { endpoint: null }).catch(() => {})
}

yesEl.addEventListener("click", async () => {
  offering = false
  render()
  // Chrome resolves "default" when its prompt is dismissed without a choice.
  if (await Notification.requestPermission().catch(() => null) === "default") { offering = true; render() }
  sync()
})
// Chrome's site controls can grant or take back notifications with no prompt from the page.
let watched
navigator.permissions?.query({ name: "notifications" }).then(p => { watched = p; p.onchange = sync }, () => {})
noEl.addEventListener("click", () => {
  offering = false
  localStorage.setItem("glitch.push", "no")
  render()
})

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
    note = e.name === "NotAllowedError" ? "microphone blocked: allow it for this site" : "no microphone"
    local = null
    show()
  })
}

canvas.addEventListener("contextmenu", e => e.preventDefault())
canvas.addEventListener("pointerdown", e => {
  if (press || e.button > 0 || reach(e) > TALK_RADII) return
  canvas.setPointerCapture(e.pointerId)
  offering = false
  if (offline) { unlock(); press = { id: e.pointerId, offline: true }; return render() }
  const first = !unlocked
  unlock()
  note = ""
  const p = press = { id: e.pointerId }, t = performance.now()
  const talk = () => { p.t = t; dropMutters(); hush(true); record(p) }
  if (first && queue.length) { p.timer = setTimeout(() => { talk(); begin(p) }, TAP_MS); return }
  const speaking = !!(playing || queue.length)
  talk()
  if (speaking) p.timer = setTimeout(() => begin(p), TAP_MS)
  else begin(p)
})

canvas.addEventListener("pointermove", e => {
  const p = press
  if (!p?.t || e.pointerId !== p.id || !!p.discard === reach(e) > DISCARD_RADII) return
  p.discard = !p.discard
  render()
})

function release(e, cancel = false) {
  const p = press
  if (!p || (e && e.pointerId !== p.id)) return
  if (e && !cancel) unlock()
  press = null
  if (p.offline) return void (cancel || ac.resume().then(() => chime("unsure"), () => {}))
  clearTimeout(p.timer)
  if (!p.t) return
  const rec = p.rec
  if (cancel) p.discard = true
  if (p.discard || performance.now() - p.t < TAP_MS || !rec) {
    rec?.stop()
    if (p.discard && p.begun && !document.hidden) chime("unsure")
    if (p.begun) { local = null; cleared = false; if (!p.discard && turn !== "desk") note ||= "hold to talk"; show() }
    return
  }
  chime("stop")
  buzz(BUZZ.sent)
  local = "transcribing"
  show()
  rec.onstop = () => send(new Blob(p.chunks, { type: rec.mimeType }))
  rec.stop()
}
canvas.addEventListener("pointerup", e => release(e))
canvas.addEventListener("pointercancel", e => release(e, true))

document.addEventListener("pointerdown", e => {
  const mine = e.target === canvas && reach(e) <= TALK_RADII
  poke = mine || e.target.closest("button, a") ? null : { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }
})
document.addEventListener("pointerup", e => {
  if (ran) unlock()
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
  } catch { return failed("couldn't reach home") }
  if (r.status === 401) return pair()
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.outcome === "error") return failed(j.error === "audio" ? "couldn't read that recording" : "something went wrong")
  if (j.outcome !== "empty") localStorage.setItem("glitch.talked", "1")
  if (j.outcome === "turn" && local === "transcribing") {
    awaiting = setTimeout(() => { awaiting = 0; local = null; show() }, 4000)
    return
  }
  local = null
  show()
}

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
    release(null, true)
    dropMic()
    orb.stop()
    if (lapsed) forget()
    render()
  } else {
    if (ran) unlock()
    orb.start()
    reconnect()
  }
  wake()
})

booted = true
show()
orb.start()
