// The glitch creature as one fragment shader, in CSS px. Patterns, palettes and
// glows are Beep Jev's (beepjev.replit.app). The eye is the pattern: texture
// space is centred on the gaze point and magnified there. The globe edge
// foreshortens and thins the pattern toward a soft rim, so drift reads as
// turning. The rim's ticks, the moons and the surprised pill are drawn here too.
// Shared by both orbs: plugin/build-shader moves the uniform lines into Qt's
// uniform block for glitch.frag.qsb, and web/orb.js prepends a WebGL2 header.
// orb.mjs supplies every uniform but aa.

uniform vec4 primary;      // palette color1
uniform vec4 secondary;    // palette color2
uniform vec4 bg;           // palette bg
uniform float itemPx;      // item side in CSS px (creature + glow padding)
uniform float diameter;    // creature diameter in CSS px
uniform float glowBlur;    // outer glow blur radius, CSS px
uniform float glowAlpha;   // outer glow strength (0.25 at rest)
uniform float pattern;     // 0 rings, 1 checker, 2 waves, 3 dots, 4 stripes, 5 noise, 6 fine
uniform float pattern2;    // the pattern being blended from
uniform float patMix;      // 0 = pattern only, 1 = pattern2 only
uniform vec2 eye;          // gaze point from centre, CSS px
uniform float lens;        // magnification at the gaze point (0 = blinked shut)
uniform float lensSize;    // radius of the magnified patch, CSS px
uniform float eyeGlow;     // glow at the gaze point
uniform float aa;          // one device pixel in CSS px
uniform vec2 scroll;       // pattern drift (token speed), CSS px
uniform float ringPhase;   // rings travel: + inward, - outward
uniform float swellPhase;  // waves: undulation phase
uniform float swellDrift;  // waves: roll, CSS px
uniform float reveal;      // checker: share of cells filled in
uniform float flash;       // an edit just landed: new cells and the rim flash
uniform float wobble;      // rim give with the voice (about 0.01 at full level)
uniform float wobblePhase;
uniform float radar;       // look: sweep strength
uniform float radarAngle;
uniform float comet;       // a tool is out: comet strength
uniform float cometAngle;
uniform float tide;        // context fill 0..1
uniform float workShow;    // 0..1: the tide and the ticks, shown while working
uniform float tidePhase;
uniform vec4 pings;        // up to four pings, progress 0..1 (0 = off)
uniform float pingDir;     // 1 outward (it speaks), -1 inward (you speak)
uniform float ring;        // excited: ping ring progress 0..1 (0 = off)
uniform float ticks;       // tool calls this turn, one tick each on the rim (up to 39)
uniform vec2 tickFresh;    // the newest tick's index and its glow 0..1
uniform vec4 moon0;        // a subagent: position from centre, out 0..1, home 0..1
uniform vec4 moon1;
uniform vec4 moon2;
uniform vec4 moon3;
uniform vec4 moon4;
uniform vec4 moon5;
uniform vec2 pill;         // surprised: shown 0/1, lift 0..1

const float GLOBE = 0.75;
const float LIMB = 0.22;
const float MOAT = 0.55;
const float TAU = 6.2831853;

vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
vec4 pm(vec4 c, float a) { return vec4(c.rgb * c.a * a, c.a * a); }
float up(float x, float a, float b) { return clamp((x - a) / max(b - a, 1e-4), 0.0, 1.0); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// feTurbulence fractalNoise, baseFrequency .65, 3 octaves (approximation).
float turbulence(vec2 p) {
    float v = 0.0, a = 0.5, f = 0.65;
    for (int o = 0; o < 3; o++) { v += a * vnoise(p * f); f *= 2.0; a *= 0.5; }
    return v / 0.875;
}

float disc(vec2 p, float r) { return clamp((r - length(p)) / aa + 0.5, 0.0, 1.0); }

vec4 moon(vec4 m, vec2 c, vec4 pale) {
    vec2 p = c - m.xy;
    vec4 halo = pm(secondary, 0.16 * m.z * (1.0 - m.w) * disc(p, 13.0));
    return over(pm(pale, 0.95 * (1.0 - m.w) * disc(p, 4.6 * (0.4 + 0.6 * m.z) * (1.0 - 0.4 * m.w))), halo);
}

vec4 dots(vec2 p, float period, float r) {
    float h = period * 0.5;
    float d1 = length(mod(p, period) - h);
    float d2 = length(mod(p - h, period) - h);
    return over(pm(primary, 1.0 - up(d1, r - aa * 0.5, r + aa * 0.5)),
                pm(secondary, 1.0 - up(d2, r - aa * 0.5, r + aa * 0.5)));
}

vec4 bands(float v) {
    float m = mod(v, 40.0);
    float a1 = (m < 10.0) ? m / 10.0 : (m < 11.0 ? 11.0 - m : 0.0);
    float a2 = (m >= 20.0 && m < 30.0) ? (m - 20.0) / 10.0 : (m >= 30.0 && m < 31.0 ? 31.0 - m : 0.0);
    return over(pm(primary, a1), pm(secondary, a2));
}

vec4 patternColor(int pat, vec2 q, vec2 q0, float R) {
    if (pat == 0) {
        float m = mod(length(q0) + ringPhase, 42.0);
        float a1 = up(m, 13.0, 14.0) * (1.0 - up(m, 16.0, 17.0));
        float a2 = up(m, 28.0, 29.0) * (1.0 - up(m, 31.0, 32.0));
        return over(pm(primary, a1), pm(secondary, a2));
    }
    if (pat == 1) {
        vec2 p = q + 7.0;
        vec2 t = mod(p, 28.0) - 14.0;
        vec3 rgb = (t.x * t.y < 0.0) ? primary.rgb : secondary.rgb;
        float h = fract(sin(dot(floor(p / 14.0), vec2(12.9898, 78.233))) * 43758.5453);
        float on = step(h, reveal);
        float fresh = clamp(1.0 - (reveal - h) / 0.10, 0.0, 1.0) * on * flash;
        rgb = mix(rgb, vec3(1.0), fresh * 0.8);
        float a = mix(0.10, 1.0, on);
        return vec4(rgb * a, a);
    }
    if (pat == 2) {
        vec2 p = q0 + R;
        float und = 9.0 * sin(q0.x * 0.045 + swellPhase) + 4.0 * sin(q0.x * 0.11 - 2.0 * swellPhase + q0.y * 0.02);
        return bands(0.5 * length(p) + 0.5 * (p.y + und) + 0.25 * und + swellDrift);
    }
    if (pat == 3) return dots(q + 10.0, 20.0, 2.828);
    if (pat == 4) {
        // repeating-linear-gradient(45deg, secondary 0 10px, primary 10px 20px)
        float t = mod(dot(q, vec2(0.70710678, -0.70710678)), 20.0);
        float k = up(t, 10.0 - aa * 0.5, 10.0 + aa * 0.5) * (1.0 - up(t, 20.0 - aa, 20.0));
        return mix(pm(secondary, 1.0), pm(primary, 1.0), k);
    }
    if (pat == 5) {
        // noise: linear-gradient(135deg, primary, secondary) multiplied with turbulence.
        float g = clamp(dot(q0 / (2.0 * R), vec2(0.70710678)) * 0.70710678 + 0.5, 0.0, 1.0);
        return vec4(mix(primary.rgb, secondary.rgb, g) * turbulence(q + R), 1.0);
    }
    return dots(q + 6.0, 12.0, 1.55) * 0.4;
}

void main() {
    vec2 c = qt_TexCoord0 * itemPx - vec2(itemPx * 0.5);
    float R = diameter * 0.5;
    float d = length(c);
    float ang = atan(c.y, c.x);

    float dn = d / (1.0 + wobble * (1.3 * cos(2.0 * ang + wobblePhase * 3.1) + cos(3.0 * ang - wobblePhase * 5.3)));

    float sigma = max(glowBlur * 0.5, 1.0);
    float outside = max(dn - R, 0.0);
    float room = 1.0 - up(d, itemPx * 0.5 - 70.0, itemPx * 0.5 - 2.0);
    vec4 col = pm(secondary, glowAlpha * room * exp(-0.5 * (outside * outside) / (sigma * sigma)));

    if (ring > 0.0) {
        float rr = R * (1.0 + ring) - 2.0 * (1.0 + ring);
        float w = 4.0 * (1.0 + ring);
        col = over(vec4((1.0 - up(abs(d - rr), w * 0.5 - aa, w * 0.5)) * 0.2 * (1.0 - ring)), col);
    }
    for (int i = 0; i < 4; i++) {
        float u = pings[i];
        if (u <= 0.0) continue;
        float rr = pingDir > 0.0 ? R * (1.0 + 0.5 * u) : R * (1.5 - 0.5 * u);
        float a = pingDir > 0.0 ? 0.28 * (1.0 - u) : 0.22 * u;
        col = over(pm(secondary, a * (1.0 - up(abs(dn - rr), 1.5 - aa, 1.5))), col);
    }

    float inside = 1.0 - up(dn, R - aa - 4.0, R);
    if (inside > 0.0) {
        float r = clamp(dn / R, 0.0, 0.9995);
        float k = r / max(d, 1e-3);
        float nz = sqrt(1.0 - r * r);
        vec2 t = c + (vec2(atan(c.x * k, nz), asin(clamp(c.y * k, -1.0, 1.0))) * R - c) * GLOBE;

        vec2 f = t - eye;
        float fr2 = dot(f, f);
        vec2 q0 = f * (1.0 - lens * exp(-fr2 / (lensSize * lensSize)));
        vec2 q = q0 + scroll;

        vec4 A = patternColor(int(pattern + 0.5), q, q0, R);
        if (patMix > 0.0) A = mix(A, patternColor(int(pattern2 + 0.5), q, q0, R), patMix);
        A *= 1.0 - pow(up(dn, R * (1.0 - LIMB), R * 0.995), 1.5);
        float moat = (sqrt(fr2) - 1.55 * lensSize) / (0.55 * lensSize);
        A *= 1.0 - MOAT * min(lens * 1.6, 1.0) * exp(-moat * moat);

        vec4 body = over(A, pm(bg, 0.9));

        if (tide > 0.0 && workShow > 0.0) {
            float level = R - 2.0 * R * tide + 3.0 * sin(t.x * 0.07 + tidePhase * 2.2) + 1.5 * sin(t.x * 0.16 - tidePhase * 3.1);
            body = over(pm(primary, 0.10 * workShow * clamp((t.y - level) / (2.0 * aa) + 0.5, 0.0, 1.0)), body);
            float ld = (t.y - level) / 1.3;
            body = over(vec4(0.275 * workShow * exp(-0.5 * ld * ld)), body);
        }

        float edge = R - dn;
        body = over(pm(secondary, 0.25 * exp(-0.5 * (edge * edge) / 400.0)), body);
        float gs = lensSize * 0.8;
        body.rgb += primary.rgb * eyeGlow * exp(-fr2 / (gs * gs));

        if (radar > 0.0)
            body.rgb += primary.rgb * exp(-mod(radarAngle - ang, TAU) / 0.8) * radar * (1.0 - up(dn, R - 3.0, R - 2.0));

        vec4 rim = vec4(mix(secondary.rgb, vec3(1.0), 0.8 * flash), secondary.a);
        float rd = (R - dn) / 4.5;
        body = over(pm(rim, 0.55 * exp(-0.5 * rd * rd)), body);

        if (comet > 0.0) {
            float cd = (dn - R + 1.0) / 2.6;
            float m = exp(-mod(cometAngle - ang, TAU) / 1.1) * exp(-0.5 * cd * cd) * comet;
            body = mix(body, vec4(primary.rgb * 0.4 + 0.6, 1.0), m);
        }
        col = mix(col, body, inside);
    }

    vec4 pale = vec4(mix(secondary.rgb, vec3(1.0), 0.55), 1.0);
    float orbit = R + 10.0;
    if (ticks > 0.0 && workShow > 0.0 && abs(d - orbit) < 8.0) {
        float near = floor(mod(ang + 0.25 * TAU, TAU) / 0.161 + 0.5);
        for (int j = -1; j <= 1; j++) {
            float i = mod(near + float(j), 39.0);
            if (i >= ticks) continue;
            float a = -0.25 * TAU + i * 0.161;
            float fresh = i == tickFresh.x ? tickFresh.y : 0.0;
            float cover = disc(c - orbit * vec2(cos(a), sin(a)), 3.3 + 1.9 * fresh);
            col = over(pm(pale, workShow * (0.55 + 0.45 * fresh) * cover), col);
        }
    }
    col = over(moon(moon0, c, pale), col);
    col = over(moon(moon1, c, pale), col);
    col = over(moon(moon2, c, pale), col);
    col = over(moon(moon3, c, pale), col);
    col = over(moon(moon4, c, pale), col);
    col = over(moon(moon5, c, pale), col);
    if (pill.x > 0.0) {
        float mid = -R - 16.0 - 40.0 * pill.y;
        col = over(vec4(0.5 * disc(vec2(c.x, max(abs(c.y - mid) - 8.0, 0.0)), 8.0)), col);
    }
    fragColor = col * qt_Opacity;
}
