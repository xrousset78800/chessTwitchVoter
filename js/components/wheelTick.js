/**
 * PHANTOM TWITCHESS - « Tic » de la roue et de la bande
 * Petit clic synthétisé à chaque passage de part sous le curseur (pas de fichier audio).
 * Les navigateurs n'autorisent le son qu'après une interaction : on réveille l'audio au premier clic.
 */

let audio = null;

function wake() {
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume?.().catch(() => {});
    } catch { audio = null; }
}

['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, wake, { capture: true, passive: true }));

/** Volume : celui du 24/24 sur cette page (muet compris), plein ailleurs */
function volume() {
    if (!location.pathname.startsWith('/24h')) return 1;
    try {
        if (localStorage.getItem('h24Muted') === '1') return 0;
        const v = parseFloat(localStorage.getItem('h24Volume'));
        return Number.isFinite(v) ? v : 1;
    } catch { return 1; }
}

let last = 0;
export function wheelTick() {
    try {
        const vol = volume();
        if (!vol) return;
        wake();
        if (!audio || audio.state !== 'running') return;
        const t = audio.currentTime;
        if (t - last < 0.025) return;   // la bande peut changer de case très vite au début
        last = t;
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(1700, t);
        o.frequency.exponentialRampToValueAtTime(700, t + 0.03);
        g.gain.setValueAtTime(0.06 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + 0.06);
    } catch { /* pas de son : tant pis */ }
}
