/**
 * Bilan de fin de partie, dans tous les modes (partie, multi, problèmes, Puzzle Rush, prédiction).
 *
 * Pendant la partie, la séance en cours accumule :
 *   - les gains du compte connecté, par source (événement « economyGain » émis par economy.noteGain) ;
 *   - les viewers crédités coup après coup (événement « coinsCredited », cf. viewerStats.js) et leur série
 *     de coups retenus d'affilée ;
 *   - les problèmes résolus / ratés (note()).
 * À la fin, show() relit le compte (écart réel de pions, d'XP et de succès depuis le début de la séance)
 * et ouvre la fenêtre : 4 chiffres, le détail des pions du streameur, les viewers crédités, puis
 * Boutique / partie suivante. La séance repart de zéro ensuite.
 *
 * window.GameBilan = { begin, note, show, discard, active, counts, close }
 */
import { go } from '../core/route.js';
import { PAWN } from './coinFx.js';

const T = (k, p, f) => (window.tt ? window.tt(k, p, f) : f);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString(document.documentElement.lang || 'fr');
const SOURCES = ['turns', 'vote', 'puzzle', 'rush', 'predictMove', 'predictWinner', 'multi', 'daily', 'other'];
const SOURCE_FALLBACK = {
    turns: 'Coups joués', vote: 'Tes votes retenus', puzzle: 'Puzzles résolus', rush: 'Run Puzzle Rush', predictMove: 'Coups devinés',
    predictWinner: 'Pronostic du vainqueur', multi: 'Résultat de la bataille', daily: 'Bonus du jour', other: 'Autres gains'
};
const MODE_FALLBACK = { game: 'Partie', multi: 'Multi', problems: 'Problèmes', rush: 'Puzzle Rush', predict: 'Prédiction' };

let S = null;

/** Nouvelle séance : photo du compte de départ */
function begin() {
    const a = window.economy?.account;
    S = {
        at: Date.now(),
        coins0: a?.coins || 0, xp0: a?.xp || 0, spent0: a?.spent || 0,
        ach0: new Set(Object.keys(a?.achievements || {})),
        lines: new Map(),            // source → { coins, xp, n }
        credits: new Map(),          // login → { name, via, pic, coins, n, last, cur, best }
        turn: 0,
        solved: 0, failed: 0,
    };
    return S;
}
const ses = () => S || begin();

function addLine(source, coins, xp) {
    if (!coins && !xp) return;
    const l = ses().lines.get(source) || { coins: 0, xp: 0, n: 0 };
    l.coins += coins || 0; l.xp += xp || 0; l.n++;
    S.lines.set(source, l);
}

window.addEventListener('economyGain', (e) => {
    const { gain, source } = e.detail || {};
    if (!gain || gain.duplicate) return;
    addLine(SOURCES.includes(source) ? source : 'other', gain.coins || 0, gain.xp || 0);
    if (gain.daily) addLine('daily', gain.daily, 0);
});

window.addEventListener('coinsCredited', (e) => {
    const rows = e.detail?.rows || [];
    if (!rows.length) return;
    const s = ses();
    s.turn++;
    for (const r of rows) {
        if (!r?.login) continue;
        const c = s.credits.get(r.login) || { name: r.name || r.login, via: r.via || null, pic: r.pic || null, coins: 0, n: 0, last: -1, cur: 0, best: 0 };
        c.coins += r.coins || 0;
        c.n++;
        c.cur = c.last === s.turn - 1 ? c.cur + 1 : 1;
        c.best = Math.max(c.best, c.cur);
        c.last = s.turn;
        s.credits.set(r.login, c);
    }
});

/** Problème résolu / raté (mode Problèmes) */
function note(kind) {
    const s = ses();
    if (kind === 'solved') s.solved++;
    else if (kind === 'failed') s.failed++;
}

/** La séance a-t-elle quelque chose à raconter ? */
function active() {
    return !!S && (S.lines.size > 0 || S.credits.size > 0 || S.solved + S.failed > 0);
}

function discard() { S = null; }

/** Problèmes résolus / ratés depuis le début de la séance */
function counts() { return { solved: S?.solved || 0, failed: S?.failed || 0 }; }

// ---------------------------------------------------------------- fenêtre

let overlay = null, onKey = null;

function close() {
    if (!overlay) return;
    overlay.classList.remove('is-in');
    const el = overlay;
    overlay = null;
    setTimeout(() => el.remove(), 250);
    document.removeEventListener('keydown', onKey);
}

/**
 * Ouvre le bilan et termine la séance.
 * @param {object} o
 * @param {'game'|'multi'|'problems'|'rush'|'predict'} o.mode
 * @param {string} o.title     - issue (« Victoire des Blancs », « Run de 17 puzzles »…)
 * @param {string} [o.meta]    - ligne de contexte (coups, adversaire, durée…)
 * @param {string} [o.note]    - remarque mise en avant (record battu…)
 * @param {{label:string, icon?:string, run:Function}} [o.next] - bouton principal (partie suivante, rejouer…)
 * @param {boolean} [o.win]   - victoire (ou record) : animation de victoire et fanfare du kit de sons
 * @param {number} [o.delay]   - ms avant de relire le compte (gain versé par le serveur juste après la fin)
 */
async function show(o = {}) {
    const s = S || begin();
    S = null;
    if (o.delay) await new Promise(r => setTimeout(r, o.delay));
    const a = window.twitchAuth?.isLoggedIn ? await window.economy?.refresh() : null;
    render(o, s, a);
    if (o.win) window.BoardFx?.victory();
}

function computeGains(s, a) {
    const lines = SOURCES.filter(k => s.lines.has(k)).map(k => ({ k, ...s.lines.get(k) }));
    let coins = lines.reduce((t, l) => t + l.coins, 0);
    let xp = lines.reduce((t, l) => t + l.xp, 0);
    if (a) {
        // Écart réel du compte (gains versés sans retour au navigateur : bataille Multi, succès…)
        const realCoins = (a.coins - s.coins0) + ((a.spent || 0) - s.spent0);
        const realXp = (a.xp || 0) - s.xp0;
        const extraCoins = Math.max(0, realCoins - coins), extraXp = Math.max(0, realXp - xp);
        if (extraCoins || extraXp) {
            const k = s.mode === 'multi' && !s.lines.has('multi') ? 'multi' : 'other';
            const l = lines.find(x => x.k === k);
            if (l) { l.coins += extraCoins; l.xp += extraXp; } else lines.push({ k, coins: extraCoins, xp: extraXp, n: 1 });
            coins += extraCoins; xp += extraXp;
        }
    }
    const ach = a ? Object.keys(a.achievements || {}).filter(id => !s.ach0.has(id)).length : 0;
    return { lines, coins, xp, ach };
}

function render(o, s, a) {
    close();
    s.mode = o.mode;
    const g = computeGains(s, a);
    const credits = [...s.credits.entries()].map(([login, c]) => ({ login, ...c }));
    const creditCoins = credits.reduce((t, c) => t + c.coins, 0);
    const best = credits.reduce((b, c) => (c.best > (b?.best || 0) ? c : b), null);
    const top = credits.sort((x, y) => y.coins - x.coins || y.n - x.n || y.best - x.best).slice(0, 6);
    const me = window.economy?.account?.login;

    const stat = (v, l, cls = '', sub = '') => `<div class="bilan__stat ${cls}"><b>${v}</b><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    const stats = [
        stat(`+${fmt(g.coins)}`, T('bilan.coins', null, 'pions'), 'is-main'),
        stat(`+${fmt(g.xp)}`, T('bilan.xp', null, 'XP')),
        // Seul (page Jouer) : pas de chat, donc pas de viewers crédités
        ...(o.solo ? [] : [
            stat(fmt(credits.length), T('bilan.viewers', null, 'viewers crédités')),
            stat(best ? fmt(best.best) : '—', T('bilan.streak', null, 'meilleure série'), '', best && best.best > 1 ? T('bilan.streakBy', { name: best.name }, `par ${best.name}`) : ''),
        ]),
    ].join('');

    let detail;
    if (!a) {
        detail = `<div class="bilan__login">
            <p>${esc(T('bilan.login', null, 'Connecte ta chaîne Twitch pour gagner des pions et de l’XP à chaque partie.'))}</p>
            <button type="button" class="btn btn--ghost" data-bilan="login"><i class="fab fa-twitch" aria-hidden="true"></i> ${esc(T('bilan.loginBtn', null, 'Connexion Twitch'))}</button>
        </div>`;
    } else {
        const rows = g.lines.length
            ? g.lines.map(l => `<li><span>${esc(T('bilan.src.' + l.k, null, SOURCE_FALLBACK[l.k]))}${l.n > 1 && l.k !== 'daily' && l.k !== 'other' ? ` <small>× ${fmt(l.n)}</small>` : ''}</span><b>+${fmt(l.coins)}</b></li>`).join('')
            : `<li class="is-empty"><span>${esc(T('bilan.none', null, 'Aucun pion gagné cette fois'))}</span></li>`;
        const cap = a.dailyCoinCap || 300, day = Math.min(cap, a.dayCoins || 0);
        const pct = Math.round(day / cap * 100);
        const lvl = a.max
            ? T('bilan.levelMax', { n: a.level }, `Niveau ${a.level} (max)`)
            : T('bilan.level', { n: a.level, xp: fmt(Math.max(0, a.nextXp - a.levelXp)), next: a.level + 1 }, `Niveau ${a.level} · ${fmt(a.nextXp - a.levelXp)} XP avant le niveau ${a.level + 1}`);
        detail = `<ul class="bilan__lines">${rows}</ul>
            <div class="bilan__foot">
                ${g.ach ? `<a class="bilan__ach" href="/achievements" data-bilan="ach"><i class="fas fa-trophy" aria-hidden="true"></i> ${esc(T('bilan.ach', { n: g.ach }, `${g.ach} succès débloqué(s) — à récupérer`))}</a>` : ''}
                <div class="bilan__cap"><span>${esc(T('bilan.cap', null, 'Plafond du jour'))}</span><span>${fmt(day)} / ${fmt(cap)}</span></div>
                <span class="bilan__bar${day >= cap ? ' is-full' : ''}"><i style="width:${pct}%"></i></span>
                <span class="bilan__lvl">${esc(lvl)}</span>
            </div>`;
    }

    const pic = (c, i) => c.pic
        ? `<img class="bilan__pic" data-look-pic="${esc(c.login)}" src="${esc(c.pic)}" alt="" loading="lazy">`
        : `<span class="bilan__pic" data-look-pic="${esc(c.login)}" data-i="${i}">${esc((c.name || '?')[0].toUpperCase())}</span>`;
    const viewers = top.length
        ? `<ol class="bilan__top">${top.map((c, i) => `<li class="${c.login === me ? 'is-me' : ''}">
                <span class="bilan__rank">${i + 1}</span>${pic(c, i)}
                <span class="bilan__who"><b data-look-name="${esc(c.login)}">${esc(c.name)}</b><small>${esc([c.via || T('coinfx.site', null, 'site'), c.best > 1 ? T('bilan.streakRow', { n: c.best }, `série de ${c.best}`) : ''].filter(Boolean).join(' · '))}</small></span>
                <b class="bilan__n">+${fmt(c.coins)}</b></li>`).join('')}</ol>`
        : `<p class="bilan__empty">${esc(T('bilan.noViewers', null, 'Aucun viewer crédité cette partie'))}</p>`;

    const nextBtn = o.next ? `<button type="button" class="btn btn--primary" data-bilan="next">${o.next.icon ? `<i class="fas ${esc(o.next.icon)}" aria-hidden="true"></i> ` : ''}${esc(o.next.label)}</button>` : '';
    const el = document.createElement('div');
    el.className = o.solo ? 'bilan bilan--solo' : 'bilan';
    el.innerHTML = `<section class="bilan__card" role="dialog" aria-modal="true" aria-labelledby="bilan-title">
        <button type="button" class="bilan__close" data-bilan="close" aria-label="${esc(T('bilan.close', null, 'Fermer'))}" title="${esc(T('bilan.close', null, 'Fermer'))}"><i class="fas fa-times" aria-hidden="true"></i></button>
        <header class="bilan__head">
            <div class="bilan__tagline"><span class="bilan__mode">${esc(T('bilan.mode.' + o.mode, null, MODE_FALLBACK[o.mode] || ''))}</span>${o.meta ? `<span class="bilan__meta">${esc(o.meta)}</span>` : ''}</div>
            <h1 id="bilan-title">${esc(o.title || T('bilan.title', null, 'Fin de partie'))}</h1>
            ${o.note ? `<p class="bilan__note">${esc(o.note)}</p>` : ''}
        </header>
        <div class="bilan__stats">${stats}</div>
        <div class="bilan__cols">
            <section class="bilan__box">
                <h2>${PAWN} ${esc(T('bilan.detail', null, 'Détail de tes pions'))}</h2>
                ${detail}
            </section>
            ${o.solo ? '' : `<section class="bilan__box">
                <h2>${esc(T('bilan.viewersTitle', null, 'Viewers crédités'))}${credits.length ? `<span>${esc(T('bilan.viewersSum', { n: fmt(credits.length), coins: fmt(creditCoins) }, `${credits.length} · ${creditCoins} pions`))}</span>` : ''}</h2>
                ${viewers}
            </section>`}
        </div>
        <footer class="bilan__actions">
            ${a ? `<button type="button" class="btn btn--ghost" data-bilan="shop"><i class="fas fa-store" aria-hidden="true"></i> ${esc(T('bilan.shop', null, 'Boutique'))}</button>` : ''}
            ${nextBtn || `<button type="button" class="btn btn--primary" data-bilan="close">${esc(T('bilan.close', null, 'Fermer'))}</button>`}
        </footer>
    </section>`;
    el.addEventListener('click', (e) => {
        if (e.target === el) return close();
        const act = e.target.closest('[data-bilan]')?.dataset.bilan;
        if (!act) return;
        if (act === 'close') close();
        else if (act === 'next') { close(); o.next?.run?.(); }
        else if (act === 'shop') { close(); go('/shop'); }
        else if (act === 'ach') { e.preventDefault(); close(); go('/achievements'); }
        else if (act === 'login') window.twitchAuth?.login();
    });
    onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    overlay = el;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
    el.querySelector(o.next ? '[data-bilan="next"]' : '.bilan__actions [data-bilan]')?.focus({ preventScroll: true });
}

const GameBilan = { begin, note, show, discard, active, counts, close };
window.GameBilan = GameBilan;
export default GameBilan;
