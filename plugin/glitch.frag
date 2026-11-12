#version 440
// The glitch creature as one fragment shader. Its patterns, palettes and glows
// come from Beep Jev (beepjev.replit.app), in CSS px so the numbers match the
// original. What's added on top:
//   - the eye is the pattern: texture space is centred on the gaze point and
//     magnified there, so every pattern grows its own pupil;
//   - a globe edge: the pattern foreshortens and thins toward a soft rim, so a
//     drifting pattern reads as turning, not sliding behind a cutout;
//   - live signals: voice (halo, rim give, rings), token drift, radar, comet,
//     cell fill, and the context tide.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 primary;      // palette color1
    vec4 secondary;    // palette color2
    vec4 bg;           // palette bg
    float itemPx;      // item side in CSS px (creature + glow padding)
    float diameter;    // creature diameter in CSS px
    float glowBlur;    // outer glow blur radius, CSS px
    float glowAlpha;   // outer glow strength (0.25 at rest)
    float pattern;     // 0 rings, 1 checker, 2 waves, 3 dots, 4 stripes, 5 noise, 6 fine
    float pattern2;    // the pattern being blended from
    float patMix;      // 0 = pattern only, 1 = pattern2 only
    vec2 eye;          // gaze point from centre, CSS px
    float lens;        // magnification at the gaze point (0 = blinked shut)
    float lensSize;    // radius of the magnified patch, CSS px
    float eyeGlow;     // glow at the gaze point
    float aa;          // one device pixel in CSS px
    vec2 scroll;       // pattern drift (token speed), CSS px
    float ringPhase;   // rings travel: + inward, - outward
    float swellPhase;  // waves: undulation phase
    float swellDrift;  // waves: roll, CSS px
    float reveal;      // checker: share of cells filled in
    float flash;       // an edit just landed: new cells and the rim flash
    float wobble;      // rim give with the voice (about 0.01 at full level)
    float wobblePhase;
    float radar;       // look: sweep strength
    float radarAngle;
    float comet;       // a tool is out: comet strength
    float cometAngle;
    float tide;        // context fill 0..1
    float tideShow;    // 0..1: shown while working
    float tidePhase;
    vec4 pings;        // up to four voice rings, progress 0..1 (0 = off)
    float pingDir;     // 1 outward (it speaks), -1 inward (you speak)
    float ring;        // excited: ping ring progress 0..1 (0 = off)
};

const float GLOBE = 0.75;  // share of a true sphere's foreshortening
const float LIMB = 0.22;   // outer share of the radius where the pattern thins out
const float MOAT = 0.55;   // how much the pattern calms in a ring around the pupil
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

// Two dot lattices, the second offset by half a period.
vec4 dots(vec2 p, float period, float r) {
    float h = period * 0.5;
    float d1 = length(mod(p, period) - h);
    float d2 = length(mod(p - h, period) - h);
    return over(pm(primary, 1.0 - up(d1, r - aa * 0.5, r + aa * 0.5)),
                pm(secondary, 1.0 - up(d2, r - aa * 0.5, r + aa * 0.5)));
}

// Jev's wave band: a soft ramp up to a crisp crest, the two colours taking turns.
vec4 bands(float v) {
    float m = mod(v, 40.0);
    float a1 = (m < 10.0) ? m / 10.0 : (m < 11.0 ? 11.0 - m : 0.0);
    float a2 = (m >= 20.0 && m < 30.0) ? (m - 20.0) / 10.0 : (m >= 30.0 && m < 31.0 ? 31.0 - m : 0.0);
    return over(pm(primary, a1), pm(secondary, a2));
}

// q: texture space centred on the gaze point, with drift; q0: the same without
// drift (rings stay centred on the eye).
vec4 patternColor(int pat, vec2 q, vec2 q0, float R) {
    if (pat == 0) {
        // repeating-radial-gradient: primary 14-16px, secondary 29-31px, period 42px.
        float m = mod(length(q0) + ringPhase, 42.0);
        float a1 = up(m, 13.0, 14.0) * (1.0 - up(m, 16.0, 17.0));
        float a2 = up(m, 28.0, 29.0) * (1.0 - up(m, 31.0, 32.0));
        return over(pm(primary, a1), pm(secondary, a2));
    }
    if (pat == 1) {
        // Checker, 14px cells. While editing, cells fill in as `reveal` grows.
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
        // Waves: halfway between Jev's corner arcs and swells that roll through.
        vec2 p = q + R;
        float und = 9.0 * sin(q.x * 0.045 + swellPhase) + 4.0 * sin(q.x * 0.11 - 2.0 * swellPhase + q.y * 0.02);
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
        float g = clamp(dot(q / (2.0 * R), vec2(0.70710678)) * 0.70710678 + 0.5, 0.0, 1.0);
        return vec4(mix(primary.rgb, secondary.rgb, g) * turbulence(q + R), 1.0);
    }
    // fine: the dot lattice at 60% size and 40% strength, like frosted glass.
    return dots(q + 6.0, 12.0, 1.55) * 0.4;
}

void main() {
    vec2 c = qt_TexCoord0 * itemPx - vec2(itemPx * 0.5);  // CSS px from centre
    float R = diameter * 0.5;
    float d = length(c);
    float ang = atan(c.y, c.x);

    // Rim give: the silhouette moves a little with the voice.
    float dn = d / (1.0 + wobble * (1.3 * cos(2.0 * ang + wobblePhase * 3.1) + cos(3.0 * ang - wobblePhase * 5.3)));

    // Outer glow (box-shadow 0 0 blur color2).
    float sigma = max(glowBlur * 0.5, 1.0);
    float outside = max(dn - R, 0.0);
    // (faded out before the item's edge, so a wide halo never shows a square)
    float room = 1.0 - up(d, itemPx * 0.5 - 70.0, itemPx * 0.5 - 2.0);
    vec4 col = pm(secondary, glowAlpha * room * exp(-0.5 * (outside * outside) / (sigma * sigma)));

    // Excited: animate-ping ring (scale to 2x and fade).
    if (ring > 0.0) {
        float rr = R * (1.0 + ring) - 2.0 * (1.0 + ring);
        float w = 4.0 * (1.0 + ring);
        col = over(vec4((1.0 - up(abs(d - rr), w * 0.5 - aa, w * 0.5)) * 0.2 * (1.0 - ring)), col);
    }
    // Voice rings: one per syllable, leaving when it speaks, arriving when you do.
    for (int i = 0; i < 4; i++) {
        float u = pings[i];
        if (u <= 0.0) continue;
        float rr = pingDir > 0.0 ? R * (1.0 + 0.5 * u) : R * (1.5 - 0.5 * u);
        float a = pingDir > 0.0 ? 0.28 * (1.0 - u) : 0.22 * u;
        col = over(pm(secondary, a * (1.0 - up(abs(dn - rr), 1.5 - aa, 1.5))), col);
    }

    float inside = 1.0 - up(dn, R - aa - 4.0, R);
    if (inside > 0.0) {
        // Globe: foreshorten toward the rim, with no lighting.
        float r = clamp(dn / R, 0.0, 0.9995);
        float k = r / max(d, 1e-3);
        float nz = sqrt(1.0 - r * r);
        vec2 t = c + (vec2(atan(c.x * k, nz), asin(clamp(c.y * k, -1.0, 1.0))) * R - c) * GLOBE;

        // The eye: centre texture space on the gaze point and magnify around it.
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

        // Context tide: a faint level inside the body.
        if (tide > 0.0 && tideShow > 0.0) {
            float level = R - 2.0 * R * tide + 3.0 * sin(t.x * 0.07 + tidePhase * 2.2) + 1.5 * sin(t.x * 0.16 - tidePhase * 3.1);
            body = over(pm(primary, 0.10 * tideShow * clamp((t.y - level) / (2.0 * aa) + 0.5, 0.0, 1.0)), body);
            float ld = (t.y - level) / 1.3;
            body = over(vec4(0.275 * tideShow * exp(-0.5 * ld * ld)), body);
        }

        // Inset glow, then the pupil's own light.
        float edge = R - dn;
        body = over(pm(secondary, 0.25 * exp(-0.5 * (edge * edge) / 400.0)), body);
        float gs = lensSize * 0.8;
        body.rgb += primary.rgb * eyeGlow * exp(-fr2 / (gs * gs));

        // Look: a radar sweep with a fading trail.
        if (radar > 0.0)
            body.rgb += primary.rgb * exp(-mod(radarAngle - ang, TAU) / 0.8) * radar * (1.0 - up(dn, R - 3.0, R - 2.0));

        // A soft luminous rim that runs on into the outer glow; it flashes on an edit.
        vec4 rim = vec4(mix(secondary.rgb, vec3(1.0), 0.8 * flash), secondary.a);
        float rd = (R - dn) / 4.5;
        body = over(pm(rim, 0.55 * exp(-0.5 * rd * rd)), body);

        // A tool is out: a comet runs the rim until it returns.
        if (comet > 0.0) {
            float cd = (dn - R + 1.0) / 2.6;
            float m = exp(-mod(cometAngle - ang, TAU) / 1.1) * exp(-0.5 * cd * cd) * comet;
            body = mix(body, vec4(primary.rgb * 0.4 + 0.6, 1.0), m);
        }
        col = mix(col, body, inside);
    }
    fragColor = col * qt_Opacity;
}
