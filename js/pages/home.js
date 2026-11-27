/**
 * Accueil : présentation du site, tuto en 4 étapes, modes, 24/24 et progression.
 * La démo du haut rejoue un vote du chat en boucle (faux votes) sur un échiquier
 * qui suit le thème, la matière et les pièces choisis (classes de boardTheme.css).
 */
import { go } from '../core/route.js';

const tr = (key, params) => window.i18n?.t?.(key, params) ?? key;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 1.e4 e5 2.Cf3 Cc6 : le chat choisit le 3e coup des Blancs
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R';
const LAST = ['b8', 'c6'];
const WEIGHTS = [0.5, 0.33, 0.17];
const VIEWERS = 9;
const ROUND = 15;
const TICK_MS = 700;

let timer = null;
let left = ROUND;
let votes = [0, 0, 0];
let chat = [];

/** Coups proposés, notés dans la langue de la page (F/B pour le fou) */
function moves() {
    const bishop = (window.i18n?.currentLang || 'fr').startsWith('fr') ? 'F' : 'B';
    return [`${bishop}c4`, `${bishop}b5`, 'd4'];
}

function renderBoard() {
    const box = document.getElementById('home-board');
    if (!box) return;
    const url = window.pieceUrl || (p => `/img/chesspieces/classic/${p}.svg`);
    let html = '';
    FEN.split('/').forEach((row, r) => {
        let f = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) {
                for (let k = 0; k < +ch; k++, f++) html += square(r, f, '');
            } else {
                const code = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
                html += square(r, f, `<img src="${url(code)}" alt="" draggable="false">`);
                f++;
            }
        }
    });
    box.innerHTML = html;
}

function square(r, f, inner) {
    const name = 'abcdefgh'[f] + (8 - r);
    const cls = (r + f) % 2 ? 'black-3c85d' : 'white-1e1d7';
    return `<div class="${cls}${LAST.includes(name) ? ' is-last' : ''}">${inner}</div>`;
}

function renderVotes() {
    const box = document.getElementById('home-demo-votes');
    if (!box) return;
    const total = votes.reduce((a, b) => a + b, 0) || 1;
    const m = moves();
    box.innerHTML = m.map((mv, i) => `<div class="home-vote">
        <div class="home-vote__row"><b>${mv}</b><span>${tr('home.demo.votes', { n: votes[i] })}</span></div>
        <div class="home-vote__bar"><span style="width:${Math.round(votes[i] / total * 100)}%"></span></div>
    </div>`).join('');
    const t = document.getElementById('home-demo-timer');
    if (t) t.textContent = `0:${String(Math.max(0, left)).padStart(2, '0')}`;
    const c = document.getElementById('home-demo-chat');
    if (c) c.innerHTML = chat.map(l => `<span><b class="c${l.c}">viewer_${l.v}</b>${l.m}</span>`).join('');
}

function tick() {
    if (document.hidden) return;
    left--;
    if (left < 0) {
        left = ROUND;
        votes = [0, 0, 0];
        chat = [];
    } else {
        // Un ou deux votes par tic, tirés selon les poids
        for (let n = 0; n < 1 + (Math.random() < 0.4); n++) {
            let x = Math.random(), i = 0;
            while (i < WEIGHTS.length - 1 && x > WEIGHTS[i]) x -= WEIGHTS[i++];
            votes[i]++;
            const mv = moves()[i];
            chat.push({ v: 1 + Math.floor(Math.random() * VIEWERS), c: 1 + Math.floor(Math.random() * 3), m: Math.random() < 0.3 ? mv.toLowerCase() : mv });
            if (chat.length > 3) chat.shift();
        }
    }
    renderVotes();
}

/** Étape 1 du tuto et bouton du bas : la chaîne connectée remplace le bouton */
function renderAuth() {
    const auth = window.twitchAuth;
    const user = auth?.isLoggedIn ? auth.user : null;
    const chan = document.getElementById('home-chan');
    if (chan) chan.textContent = user?.displayName || tr('home.tuto.s1.chan');
    document.querySelectorAll('#page-home [data-home-login]').forEach(b => { b.hidden = !!user; });
    document.querySelectorAll('#page-home .home-step__ok').forEach(s => { s.hidden = !user; });
}

// ───────────── Pronos live : match du moment (accueil) et point « en direct » du menu ─────────────
const LIVE_MS = 120000;
let live = null;            // { games } : dernière liste de /api/tournament/live

const votesOf = g => (g.votes ? Object.values(g.votes).reduce((a, b) => a + (+b || 0), 0) : 0);
const eloOf = g => (+g.white?.elo || 0) + (+g.black?.elo || 0);
/** Match mis en avant : le plus pronostiqué, sinon le plus fort */
const featured = () => [...(live?.games || [])].sort((a, b) => votesOf(b) - votesOf(a) || eloOf(b) - eloOf(a))[0] || null;

/** Petit échiquier statique (Blancs en bas) */
function miniBoard(fen) {
    const rows = String(fen || '').split(' ')[0].split('/');
    if (rows.length !== 8 || !window.pieceUrl) return '';
    let html = '';
    rows.forEach((row, r) => {
        let c = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) {
                for (let k = 0; k < +ch; k++, c++) html += `<div class="mini-board__sq${(r + c) % 2 ? ' is-dark' : ''}"></div>`;
            } else {
                const p = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
                html += `<div class="mini-board__sq${(r + c) % 2 ? ' is-dark' : ''}"><img src="${esc(window.pieceUrl(p))}" alt=""></div>`;
                c++;
            }
        }
    });
    return `<div class="mini-board">${html}</div>`;
}

function renderPick() {
    const box = document.getElementById('home-pick');
    if (!box || !live) return;
    box.hidden = false;
    const g = featured();
    if (!g) { box.innerHTML = `<p class="home-pick__none">${esc(tr('home.picks.none'))}</p>`; return; }
    const n = live.games.length;
    const count = n === 1 ? tr('home.picks.one') : tr('home.picks.count', { n });
    const url = `/tournament?event=${encodeURIComponent(g.event?.slug || '')}&room=${encodeURIComponent(g.room?.slug || '')}&game=${encodeURIComponent(g.id)}`;
    const player = (p = {}, side) => `<span class="home-pick__player"><span class="home-pick__side is-${side}"></span>`
        + `${p.title ? `<span class="player-title">${esc(p.title)}</span>` : ''}<span class="home-pick__name">${esc(p.name || '?')}</span>`
        + `${p.elo ? `<small>${esc(p.elo)}</small>` : ''}</span>`;
    box.innerHTML = `<div class="home-pick__head"><span class="home-dot"></span> ${esc(count)}</div>
        <a class="home-pick__card" href="${esc(url)}" data-home-pick>
            <span class="home-pick__board">${miniBoard(g.fen)}</span>
            <span class="home-pick__info">
                <span class="home-pick__event">${esc(g.event?.name || '')}${g.room?.name && g.room.name !== g.event?.name ? ` · ${esc(g.room.name)}` : ''}</span>
                ${player(g.white, 'w')}${player(g.black, 'b')}
                <span class="home-btn home-btn--primary home-pick__go"><i class="fas fa-crosshairs" aria-hidden="true"></i> ${esc(tr('home.picks.cta'))}</span>
            </span>
        </a>`;
}

async function loadLive() {
    if (document.hidden && live) return;
    try {
        const r = await fetch('/api/tournament/live');
        if (!r.ok) throw new Error(r.status);
        const d = await r.json();
        live = { games: Array.isArray(d.games) ? d.games : [] };
    } catch {
        live = live || { games: [] };
    }
    document.querySelectorAll('[data-picks-dot]').forEach(d => { d.hidden = !live.games.length; });
    if (isActive()) renderPick();
}

/** Ouvre le match mis en avant sur la page Pronos live */
function openPick() {
    const g = featured();
    go('/tournament');
    if (g) setTimeout(() => window.tournamentPredict?.openLiveGame?.(g), 0);
}

const HomePage = {
    bound: false,
    init() {
        const page = document.getElementById('page-home');
        if (!page) return;
        if (!this.bound) {
            this.bound = true;
            page.addEventListener('click', (e) => {
                if (e.target.closest('[data-home-login]')) return window.twitchAuth?.login();
                if (e.target.closest('[data-home-pick]') && !(e.ctrlKey || e.metaKey || e.shiftKey || e.button)) {
                    e.preventDefault();
                    return openPick();
                }
                const scroll = e.target.closest('[data-home-scroll]');
                if (scroll) {
                    e.preventDefault();
                    document.querySelector(scroll.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }
        renderBoard();
        renderVotes();
        renderAuth();
        renderPick();
        loadLive();
        clearInterval(timer);
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (!still) timer = setInterval(tick, TICK_MS);
        else { votes = [6, 4, 2]; renderVotes(); }
    },
    stop() {
        clearInterval(timer);
        timer = null;
    },
};

const isActive = () => document.getElementById('page-home')?.classList.contains('is-active');
window.addEventListener('twitchAuthChange', () => { if (isActive()) renderAuth(); });
window.addEventListener('pieceSetChanged', () => { if (isActive()) { renderBoard(); renderPick(); } });
window.addEventListener('languageChanged', () => { if (isActive()) { renderVotes(); renderAuth(); renderPick(); } });
// Point « en direct » du menu Pronos live : vérifié au chargement puis toutes les 2 minutes
loadLive();
setInterval(loadLive, LIVE_MS);

export default HomePage;
