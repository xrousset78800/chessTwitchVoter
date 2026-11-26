/**
 * Accueil : présentation du site, tuto en 4 étapes, modes, 24/24 et progression.
 * La démo du haut rejoue un vote du chat en boucle (faux votes) sur un échiquier
 * qui suit le thème, la matière et les pièces choisis (classes de boardTheme.css).
 */
const tr = (key, params) => window.i18n?.t?.(key, params) ?? key;

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

const HomePage = {
    bound: false,
    init() {
        const page = document.getElementById('page-home');
        if (!page) return;
        if (!this.bound) {
            this.bound = true;
            page.addEventListener('click', (e) => {
                if (e.target.closest('[data-home-login]')) return window.twitchAuth?.login();
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
window.addEventListener('pieceSetChanged', () => { if (isActive()) renderBoard(); });
window.addEventListener('languageChanged', () => { if (isActive()) { renderVotes(); renderAuth(); } });

export default HomePage;
