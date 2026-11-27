/**
 * Gains de pions mis en évidence, dans tous les modes :
 *   - compteur de la barre du haut (.nav__level) : pions + jauge du plafond du jour (rendu par pages/achievements.js) ;
 *   - à chaque hausse du compte (économie), un « +N ♟ » part de l'échiquier vers le compteur, avec un petit
 *     son de monnaie (désactivable : bouton .nav__coin-sound, réglage gardé dans le navigateur) ;
 *   - fenêtre flottante « Crédités sur ce coup » (viewers crédités du dernier coup), visible à l'écran du
 *     streameur donc sur son live : les viewers du chat y voient leur pseudo passer ;
 *   - toast personnel du viewer crédité.
 * window.CoinFx = { PAWN, fly, ding, showCredits, toastMine, setSource, soundOn }
 */
const T = (k, p, f) => (window.tt ? window.tt(k, p, f) : f);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString(document.documentElement.lang || 'fr');
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const PAWN = '<svg class="coin-pawn" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-1.8 5.4C8.9 9 8 10.2 8 11.5h1.5l-1 5h7l-1-5H16c0-1.3-.9-2.5-2.2-3.1A3 3 0 0 0 12 3zM6.5 18h11v2.5h-11z" fill="currentColor"/></svg>';

// ---------------------------------------------------------------- son
const SOUND_KEY = 'coinSound';
let soundOn = (() => { try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; } })();
let actx = null;

/** Petit son de monnaie, synthétisé (deux notes claires) ; big : palier, trois notes */
export function ding(big = false) {
    if (!soundOn) return;
    try {
        actx ||= new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume();
        const t0 = actx.currentTime + 0.01;
        const notes = big ? [1318.5, 1760, 2637] : [1567.98, 2093];
        notes.forEach((f, i) => {
            const o = actx.createOscillator(), g = actx.createGain();
            o.type = 'triangle';
            o.frequency.value = f;
            const t = t0 + i * 0.075;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.11, t + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
            o.connect(g).connect(actx.destination);
            o.start(t);
            o.stop(t + 0.34);
        });
    } catch { /* pas d'audio : tant pis */ }
}

function renderSoundBtn() {
    const label = T(soundOn ? 'coinfx.soundOn' : 'coinfx.soundOff', null, soundOn ? 'Son des gains : activé' : 'Son des gains : coupé');
    document.querySelectorAll('.nav__coin-sound').forEach(b => {
        b.hidden = !window.economy?.account;
        b.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
        b.title = label;
        b.setAttribute('aria-label', label);
        b.innerHTML = `<i class="fas ${soundOn ? 'fa-volume-high' : 'fa-volume-xmark'}" aria-hidden="true"></i>`;
    });
}

document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.nav__coin-sound')) return;
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch {}
    renderSoundBtn();
    if (soundOn) ding();
});

// ---------------------------------------------------------------- envol vers le compteur
let source = null, sourceAt = 0;
/** Point de départ du prochain envol (élément ou {x, y}), valable quelques secondes */
export function setSource(el) { source = el; sourceAt = Date.now(); }

function startPoint() {
    const fresh = source && Date.now() - sourceAt < 6000;
    if (fresh && !(source instanceof Element)) return source;
    let el = fresh && source.isConnected ? source : null;
    el ||= [...document.querySelectorAll('.page.is-active .board-b72b1, .page.is-active canvas.wheel-canvas')].find(x => x.offsetParent);
    if (el) {
        const r = el.getBoundingClientRect();
        if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Compteur visible de la barre du haut */
const counter = () => [...document.querySelectorAll('.nav__level')].find(el => !el.hidden && el.offsetParent);

function bump(n) {
    const el = counter();
    if (!el) return;
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
    let d = el.querySelector('.nav__level-delta');
    if (!d) { d = document.createElement('span'); d.className = 'nav__level-delta'; el.appendChild(d); }
    d.textContent = `+${fmt(n)}`;
    d.classList.remove('is-on');
    void d.offsetWidth;
    d.classList.add('is-on');
}

/** « +N ♟ » qui part de l'échiquier (ou de from) et rejoint le compteur */
export function fly(n, from = null) {
    if (!(n > 0)) return;
    const target = counter();
    ding(n >= 10);
    if (!target || reduced() || document.hidden) return bump(n);
    const a = from ? (from instanceof Element ? (() => { const r = from.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : from) : startPoint();
    const r = target.getBoundingClientRect();
    const b = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const chip = document.createElement('div');
    chip.className = 'coin-fly';
    chip.setAttribute('aria-hidden', 'true');
    chip.innerHTML = `${PAWN}<b>+${fmt(n)}</b>`;
    document.body.appendChild(chip);
    const w = chip.offsetWidth / 2, h = chip.offsetHeight / 2;
    const at = (x, y, s, o = 1) => ({ transform: `translate(${x - w}px, ${y - h}px) scale(${s})`, opacity: o });
    // Trajectoire en arc : monte d'abord, puis file vers le compteur en rapetissant
    const mx = a.x + (b.x - a.x) * 0.35, my = Math.min(a.y, b.y) - 60;
    const anim = chip.animate([
        { ...at(a.x, a.y, 0.4, 0), offset: 0 },
        { ...at(a.x, a.y - 14, 1.15), offset: 0.14 },
        { ...at(a.x, a.y - 18, 1), offset: 0.3 },
        { ...at(mx, my, 0.85), offset: 0.62 },
        { ...at(b.x, b.y, 0.35, 0.6), offset: 1 }
    ], { duration: 1150, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'forwards' });
    anim.onfinish = () => { chip.remove(); bump(n); };
}

// Toute hausse du compte (coups, puzzles, rush, pronostics, succès…) : envol vers le compteur
let last = null;
window.addEventListener('economyChanged', (e) => {
    const acc = e.detail;
    if (acc && last && acc.login === last.login && acc.coins > last.coins) fly(acc.coins - last.coins);
    last = acc ? { login: acc.login, coins: acc.coins } : null;
    renderSoundBtn();
});
window.addEventListener('languageChanged', renderSoundBtn);

// ---------------------------------------------------------------- « Crédités sur ce coup »
const COLORS = ['#ff8a3d', '#ffb27a', '#d9c3b0', '#c98a5e', '#a8998c', '#e0a57c', '#b9aea6', '#f4c29a'];
const colorOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; };
let box = null, hideTimer = null;

/**
 * Fenêtre flottante des viewers crédités sur le dernier coup.
 * opts : { move, ply, rows: [{ login, name, via, coins, pic }], n (total crédités), me, ms }
 *   via : '#chaîne', 'site' ou null (chat du streameur)
 */
export function showCredits({ move = '', ply = null, rows = [], n = null, me = null, ms = 7000 } = {}) {
    if (!rows.length) return;
    if (!box) {
        box = document.createElement('aside');
        box.className = 'coin-credits';
        box.setAttribute('aria-live', 'polite');
        document.body.appendChild(box);
        box.addEventListener('click', (e) => { if (e.target.closest('.coin-credits__close')) hideCredits(); });
    }
    const total = n ?? rows.length;
    const shown = rows.slice(0, 5);
    const more = total - shown.length;
    const num = ply ? `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ` : '';
    // Provenance : « #chaîne » (chat Twitch) ou, sans chaîne, le site
    const via = (r) => r.via || T('coinfx.site', null, 'site');
    box.innerHTML = `<header class="coin-credits__head">
            <h2>${esc(T('coinfx.credited', null, 'Crédités sur ce coup'))}</h2>
            <span class="coin-credits__move">${esc(num)}<b>${esc(move)}</b></span>
            <button type="button" class="coin-credits__close" aria-label="${esc(T('coinfx.close', null, 'Fermer'))}"><i class="fas fa-xmark" aria-hidden="true"></i></button>
        </header>
        <ul>${shown.map(r => `<li class="${r.login === me ? 'is-me' : ''}">
            ${r.pic ? `<img class="coin-credits__pic" src="${esc(r.pic)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                : `<span class="coin-credits__pic" style="background:${colorOf(r.login)}">${esc(String(r.name || r.login || '?')[0].toUpperCase())}</span>`}
            <span class="coin-credits__who"><b>${esc(r.name || r.login)}</b><small>${esc(via(r))}</small></span>
            ${r.coins > 0 ? `<span class="coin-credits__n">+${fmt(r.coins)}${PAWN}</span>`
                : `<span class="coin-credits__n is-cap">${esc(T('coinfx.capped', null, 'plafond atteint'))}</span>`}
        </li>`).join('')}</ul>
        ${more > 0 ? `<p class="coin-credits__more">${esc(T('coinfx.more', { n: more }, `+ ${more} autre(s) viewer(s)`))}</p>` : ''}`;
    box.classList.remove('is-out');
    box.classList.remove('is-in');
    void box.offsetWidth;
    box.classList.add('is-in');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCredits, ms);
}

export function hideCredits() {
    clearTimeout(hideTimer);
    if (box?.classList.contains('is-in')) { box.classList.remove('is-in'); box.classList.add('is-out'); }
}

/** Toast du viewer crédité : « +2 pions crédités · Ton vote Nf3 a été joué » */
export function toastMine({ coins, move, solved = false }) {
    if (!(coins > 0) || !window.AppToast) return;
    const line = T(solved ? 'coinfx.mineSolved' : 'coinfx.mine', { move: '\u0001' }, solved ? 'Ta réponse \u0001 était la bonne' : 'Ton vote \u0001 a été joué');
    const html = `<span class="coin-toast">${PAWN}<span><b>${esc(T('coinfx.toastTitle', { n: coins }, `+${coins} pions crédités`))}</b>`
        + `<small>${esc(line).replace('\u0001', `<b class="coin-toast__move">${esc(move)}</b>`)}</small></span></span>`;
    window.AppToast.show(html, 'info', 4500);
}

const CoinFx = { PAWN, fly, ding, showCredits, hideCredits, toastMine, setSource, get soundOn() { return soundOn; } };
window.CoinFx = CoinFx;
renderSoundBtn();
export default CoinFx;

// Partie du streameur (chat Twitch) et problèmes : réponse du serveur aux stats des votes (core/viewerStats.js)
window.addEventListener('coinsCredited', (e) => {
    const d = e.detail || {};
    const via = d.channel ? `#${d.channel}` : null;
    showCredits({ move: d.move, ply: d.ply, rows: (d.rows || []).map(r => ({ ...r, via })), me: window.economy?.account?.login });
});
