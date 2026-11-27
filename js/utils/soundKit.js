/**
 * Kits de sons du magasin, synthétisés (pas de fichier) : coup, prise, échec, tic de la roue, victoire.
 *   SoundKit.play(kind, vol, { mate, kit })  kind : move | capture | check → true si le kit a joué le son,
 *       false avec le kit classique (l'appelant joue alors ses mp3 habituels)
 *   SoundKit.tick(vol)  → true si le kit remplace le tic de la roue
 *   SoundKit.win(vol)   → petite fanfare de victoire du kit (rien avec le kit classique)
 *   SoundKit.demo(kit)  → coup, prise, échec à la suite (aperçu du magasin)
 * Le kit équipé vient de Cosmetics.get('sound').
 */
let ctx = null;
function wake() {
    try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume?.().catch(() => { });
    } catch { ctx = null; }
    return ctx;
}
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, wake, { capture: true, passive: true }));

let noiseBuf = null;
function noise() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
}

/** Note : oscillateur, enveloppe attaque / déclin exponentiel, glissement de fréquence facultatif */
function tone(t, { type = 'sine', f, f2 = null, dur = 0.15, gain = 0.2, attack = 0.004, filter = null, out }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o.connect(g);
    if (filter) {
        const bq = ctx.createBiquadFilter();
        bq.type = filter.type || 'lowpass';
        bq.frequency.value = filter.f;
        if (filter.q) bq.Q.value = filter.q;
        node = node.connect(bq);
    }
    node.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
}

/** Bruit filtré (choc, souffle) */
function burst(t, { dur = 0.08, gain = 0.2, type = 'bandpass', f = 1200, q = 1, out }) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), bq = ctx.createBiquadFilter();
    s.buffer = noise();
    bq.type = type; bq.frequency.value = f; bq.Q.value = q;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bq).connect(g).connect(out);
    s.start(t);
    s.stop(t + dur + 0.02);
}

const N = (semi) => 440 * Math.pow(2, semi / 12);   // demi-tons depuis le la 440

const KITS = {
    'kit-wood': {
        move: (t, o) => { tone(t, { f: 190, f2: 120, dur: 0.09, gain: 0.5, out: o }); burst(t, { f: 900, q: 2, dur: 0.04, gain: 0.35, out: o }); },
        capture: (t, o) => { KITS['kit-wood'].move(t, o); tone(t + 0.07, { f: 150, f2: 90, dur: 0.12, gain: 0.55, out: o }); burst(t + 0.07, { f: 700, q: 2, dur: 0.06, gain: 0.4, out: o }); },
        check: (t, o) => { for (const d of [0, 0.11]) { tone(t + d, { f: 320, f2: 220, dur: 0.08, gain: 0.45, out: o }); burst(t + d, { f: 1600, q: 3, dur: 0.03, gain: 0.3, out: o }); } },
        tick: (t, o) => burst(t, { f: 2200, q: 4, dur: 0.02, gain: 0.25, out: o }),
        win: (t, o) => [0, 4, 7, 12].forEach((s, i) => tone(t + i * 0.12, { type: 'triangle', f: N(s - 9), dur: 0.35, gain: 0.25, out: o })),
    },
    'kit-8bit': {
        move: (t, o) => { tone(t, { type: 'square', f: 660, dur: 0.05, gain: 0.12, attack: 0.001, out: o }); tone(t + 0.05, { type: 'square', f: 990, dur: 0.05, gain: 0.1, attack: 0.001, out: o }); },
        capture: (t, o) => tone(t, { type: 'square', f: 880, f2: 160, dur: 0.18, gain: 0.13, attack: 0.001, out: o }),
        check: (t, o) => [990, 1320, 990, 1320].forEach((f, i) => tone(t + i * 0.06, { type: 'square', f, dur: 0.05, gain: 0.1, attack: 0.001, out: o })),
        tick: (t, o) => tone(t, { type: 'square', f: 1400, dur: 0.015, gain: 0.06, attack: 0.001, out: o }),
        win: (t, o) => [0, 4, 7, 12, 7, 12].forEach((s, i) => tone(t + i * 0.09, { type: 'square', f: N(s + 3), dur: 0.09, gain: 0.1, attack: 0.001, out: o })),
    },
    'kit-marble': {
        move: (t, o) => { tone(t, { f: 2100, dur: 0.06, gain: 0.18, attack: 0.001, out: o }); tone(t, { f: 3300, dur: 0.04, gain: 0.08, attack: 0.001, out: o }); burst(t, { type: 'highpass', f: 3000, dur: 0.02, gain: 0.25, out: o }); },
        capture: (t, o) => { KITS['kit-marble'].move(t, o); KITS['kit-marble'].move(t + 0.06, o); tone(t + 0.06, { f: 520, dur: 0.25, gain: 0.12, out: o }); },
        check: (t, o) => [N(15), N(22), N(27)].forEach((f, i) => tone(t + i * 0.015, { f, dur: 0.9, gain: 0.12, attack: 0.002, out: o })),
        tick: (t, o) => tone(t, { f: 2600, dur: 0.025, gain: 0.08, attack: 0.001, out: o }),
        win: (t, o) => [3, 10, 15, 22].forEach((s, i) => tone(t + i * 0.1, { f: N(s + 12), dur: 1, gain: 0.1, attack: 0.002, out: o })),
    },
    'kit-arcade': {
        move: (t, o) => tone(t, { type: 'sawtooth', f: 300, f2: 900, dur: 0.08, gain: 0.1, filter: { f: 3000 }, out: o }),
        capture: (t, o) => { burst(t, { type: 'lowpass', f: 1400, dur: 0.3, gain: 0.45, out: o }); tone(t, { type: 'sawtooth', f: 500, f2: 60, dur: 0.25, gain: 0.12, filter: { f: 1800 }, out: o }); },
        check: (t, o) => { for (let i = 0; i < 3; i++) tone(t + i * 0.1, { type: 'sawtooth', f: 700, f2: 1100, dur: 0.09, gain: 0.09, filter: { f: 4000 }, out: o }); },
        tick: (t, o) => tone(t, { type: 'square', f: 1800, f2: 900, dur: 0.02, gain: 0.05, attack: 0.001, out: o }),
        win: (t, o) => { [0, 4, 7, 11, 12, 16, 19, 24].forEach((s, i) => tone(t + i * 0.06, { type: 'sawtooth', f: N(s), dur: 0.12, gain: 0.08, filter: { f: 5000 }, out: o })); },
    },
    'kit-orchestra': {
        // Pizzicato pour le coup, timbales sur le mat, cordes sur l'échec
        move: (t, o) => tone(t, { type: 'triangle', f: N(-2), dur: 0.22, gain: 0.3, attack: 0.002, filter: { f: 1800 }, out: o }),
        capture: (t, o) => { tone(t, { type: 'triangle', f: N(-9), dur: 0.3, gain: 0.35, attack: 0.002, filter: { f: 1200 }, out: o }); burst(t, { type: 'lowpass', f: 400, dur: 0.15, gain: 0.3, out: o }); },
        check: (t, o) => [-9, -5, 0].forEach(s => tone(t, { type: 'sawtooth', f: N(s), dur: 0.8, gain: 0.06, attack: 0.12, filter: { f: 1600, q: 0.7 }, out: o })),
        mate: (t, o) => { for (let i = 0; i < 6; i++) { tone(t + i * 0.07, { f: 98, f2: 80, dur: 0.6, gain: 0.35 - i * 0.03, attack: 0.002, out: o }); burst(t + i * 0.07, { type: 'lowpass', f: 300, dur: 0.12, gain: 0.25, out: o }); } tone(t + 0.45, { f: 73, f2: 60, dur: 1.4, gain: 0.5, attack: 0.002, out: o }); },
        tick: (t, o) => tone(t, { type: 'triangle', f: N(14), dur: 0.05, gain: 0.08, attack: 0.001, out: o }),
        win: (t, o) => { [[0, 4, 7], [5, 9, 12], [7, 11, 14], [12, 16, 19]].forEach((ch, i) => ch.forEach(s => tone(t + i * 0.28, { type: 'sawtooth', f: N(s - 9), dur: i === 3 ? 1.4 : 0.32, gain: 0.05, attack: 0.04, filter: { f: 2200 }, out: o }))); },
    },
    'kit-fanfare': {
        move: (t, o) => tone(t, { type: 'sawtooth', f: N(3), dur: 0.12, gain: 0.07, attack: 0.02, filter: { f: 1500 }, out: o }),
        capture: (t, o) => { tone(t, { type: 'sawtooth', f: N(3), dur: 0.08, gain: 0.07, attack: 0.01, filter: { f: 1500 }, out: o }); tone(t + 0.09, { type: 'sawtooth', f: N(-2), dur: 0.16, gain: 0.08, attack: 0.01, filter: { f: 1400 }, out: o }); },
        check: (t, o) => [3, 10].forEach((s, i) => tone(t + i * 0.13, { type: 'sawtooth', f: N(s), dur: 0.2, gain: 0.08, attack: 0.02, filter: { f: 2000 }, out: o })),
        tick: (t, o) => tone(t, { type: 'triangle', f: N(22), dur: 0.03, gain: 0.07, attack: 0.001, out: o }),
        win: (t, o) => { [[3, 0.14], [3, 0.14], [3, 0.14], [10, 0.5], [7, 0.16], [10, 0.9]].reduce((at, [s, d]) => { tone(t + at, { type: 'sawtooth', f: N(s), dur: d, gain: 0.09, attack: 0.02, filter: { f: 2400 }, out: o }); tone(t + at, { type: 'sawtooth', f: N(s - 12), dur: d, gain: 0.05, attack: 0.02, filter: { f: 1200 }, out: o }); return at + d * 0.95; }, 0); },
    },
};

/** Lance une fonction du kit si l'audio est prêt ; vrai si le kit gère ce son */
function run(kitId, kind, vol) {
    const kit = KITS[kitId];
    const fn = kit?.[kind];
    if (!fn) return false;
    if (!vol) return true;                  // muet : le kit « gère » (l'appelant ne joue pas son mp3)
    if (!wake() || ctx.state !== 'running') return true;
    try {
        const out = ctx.createGain();
        out.gain.value = Math.max(0, Math.min(1, vol));
        out.connect(ctx.destination);
        fn(ctx.currentTime + 0.005, out);
    } catch { }
    return true;
}

const equipped = () => window.Cosmetics?.get('sound') || null;
let lastTick = 0;

const SoundKit = {
    KITS: Object.keys(KITS),
    play(kind, vol = 1, { mate = false, kit = equipped() } = {}) {
        if (!kit) return false;
        return run(kit, mate && KITS[kit]?.mate ? 'mate' : kind, vol);
    },
    tick(vol = 1) {
        const kit = equipped();
        if (!kit) return false;
        if (ctx && ctx.currentTime - lastTick < 0.025) return true;
        lastTick = ctx?.currentTime || 0;
        return run(kit, 'tick', vol);
    },
    win(vol = 1, kit = equipped()) {
        return kit ? run(kit, 'win', vol) : false;
    },
    demo(kit) {
        wake();
        const seq = [['move', 0], ['capture', 0.45], ['check', 0.95], ['win', 2.1]];
        if (KITS[kit]?.mate) seq.splice(3, 0, ['mate', 2]), seq[4][1] = 3.6;
        seq.forEach(([k, at]) => setTimeout(() => run(kit, k, 0.8), at * 1000));
    },
};

window.SoundKit = SoundKit;
export default SoundKit;
