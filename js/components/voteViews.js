/**
 * Panneaux de vote partagés par les joueurs et les spectateurs :
 * - podium des votes en cours (top 3 avec la pièce jouée, le reste en puces)
 * - feuille de partie (# / Blancs / Noirs, score du vote sous chaque coup)
 * - bandeau des votes du chat sous l'échiquier
 */
import { paletteColors } from './votePalettes.js';
import { hideVoterNames, secretVotes } from './voteAnonymity.js';
import { fmtMove } from '../utils/moveMatch.js';

const t = (key, params, fallback) => {
    const s = window.i18n?.t(key, params);
    return s && s !== key ? s : fallback;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PIECE_IMG = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
const SAN_RE = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/;

/** Pièce qui joue le coup (null si ce n'est pas du SAN) */
export function pieceOf(san) {
    const s = String(san || '');
    if (!SAN_RE.test(s)) return null;
    if (s.startsWith('O-')) return 'K';
    return 'KQRBN'.includes(s[0]) ? s[0] : 'P';
}

// ---------------------------------------------------------------- Podium

const SLOT_ORDER = [2, 1, 3]; // 2e à gauche, 1er au centre, 3e à droite

function buildPodium(listEl) {
    listEl.innerHTML = `
        <div class="podium">
            <div class="podium__steps">${SLOT_ORDER.map(rank => `
                <div class="podium__slot is-empty" data-rank="${rank}">
                    <span class="podium__piece"><img alt="" draggable="false"></span>
                    <span class="podium__move"></span>
                    <div class="podium__step">
                        <span class="podium__pct"></span>
                        <span class="podium__count"></span>
                    </div>
                </div>`).join('')}
            </div>
            <div class="podium__rest"></div>
        </div>`;
    return listEl.querySelector('.podium');
}

/**
 * @param {HTMLElement} listEl  conteneur des votes
 * @param {HTMLElement|null} totalEl  ligne du total
 * @param {{move: string, count: number}[]} votes  triés, le plus voté en premier
 * @param {{turn?: 'w'|'b', colors?: string[], winner?: string}} opts
 */
export function renderPodium(listEl, totalEl, votes, opts = {}) {
    if (!listEl) return;
    const podium = listEl.querySelector(':scope > .podium') || buildPodium(listEl);
    const colors = opts.colors || paletteColors();
    const turn = opts.turn === 'b' ? 'b' : 'w';
    // Vote secret : podium vide, seul le nombre de votes s'affiche (opts.secret = true, ou ce nombre côté spectateur)
    const secret = opts.secret != null && opts.secret !== false;
    const all = (votes || []).filter(v => v && v.count > 0);
    // Vote secret avec les totaux : le podium vit en direct (hauteurs), mais les coups restent cachés
    const masked = secret && Array.isArray(opts.masked) ? opts.masked.filter(n => n > 0).map(n => ({ move: '?', count: n })) : null;
    const list = masked || (secret ? [] : all);
    const total = secret && typeof opts.secret === 'number' ? opts.secret : all.reduce((n, v) => n + v.count, 0);
    listEl.classList.toggle('is-secret', secret);
    podium.classList.toggle('is-masked', !!masked);
    const top = list[0]?.count || 1;

    podium.classList.toggle('is-empty', !list.length);
    podium.querySelectorAll('.podium__slot').forEach(slot => {
        const rank = Number(slot.dataset.rank);
        const v = list[rank - 1];
        slot.classList.toggle('is-empty', !v);
        slot.classList.toggle('is-winner', !!v && v.move === opts.winner);
        if (!v) {
            slot.dataset.move = '';
            slot.style.removeProperty('--c');
            slot.querySelector('.podium__step').style.height = '';
            return;
        }
        const color = colors[(rank - 1) % colors.length];
        const pct = total ? Math.round(v.count / total * 100) : 0;
        slot.dataset.move = v.move;
        slot.style.setProperty('--c', color);
        const piece = pieceOf(v.move);
        const img = slot.querySelector('.podium__piece img');
        const src = piece ? PIECE_IMG.replace('{piece}', turn + piece) : '';
        if (img.getAttribute('src') !== src) {
            if (src) img.setAttribute('src', src); else img.removeAttribute('src');
        }
        slot.querySelector('.podium__piece').hidden = !piece;
        slot.querySelector('.podium__move').textContent = fmtMove(v.move);
        slot.querySelector('.podium__pct').textContent = masked ? '' : `${pct}%`;
        slot.querySelector('.podium__count').textContent = masked ? '' : t(v.count > 1 ? 'podium.votesMany' : 'podium.votesOne', { n: v.count }, `${v.count} vote${v.count > 1 ? 's' : ''}`);
        // Hauteur de la marche : le 1er au maximum, les autres en proportion
        slot.querySelector('.podium__step').style.height = `${Math.round(40 + 64 * (v.count / top))}px`;
    });

    const rest = list.slice(3);
    const restEl = podium.querySelector('.podium__rest');
    if (secret) {
        restEl.innerHTML = `<span class="podium__hint podium__hint--secret"><i class="fas fa-eye-slash"></i> ${esc(t('anonymity.podium', null, 'Vote secret'))}<small>${esc(t('anonymity.podiumHint', null, 'Résultat à la fin du vote'))}</small></span>`;
    } else if (!list.length) {
        restEl.innerHTML = `<span class="podium__hint">${esc(t('podium.none', null, 'Aucun vote pour l\'instant'))}</span>`;
    } else {
        const shown = rest.slice(0, 30);
        restEl.innerHTML = shown.map((v, i) => `<span class="podium__chip" style="--c:${colors[(i + 3) % colors.length]}"><i>${i + 4}</i><b>${esc(fmtMove(v.move))}</b> ${v.count}${masked || !total ? '' : `<small>${Math.round(v.count / total * 100)}%</small>`}</span>`).join('')
            + (rest.length > shown.length ? `<span class="podium__chip podium__chip--more">+${rest.length - shown.length}</span>` : '');
    }
    if (totalEl) {
        totalEl.textContent = total ? t(total > 1 ? 'watch.totalMany' : 'watch.totalOne', { n: total }, `${total} vote${total > 1 ? 's' : ''}`) : '';
    }
}

/** Gagnant du tirage mis en avant sur le podium */
export function markPodiumWinner(listEl, move) {
    listEl?.querySelectorAll('.podium__slot').forEach(slot => {
        slot.classList.toggle('is-winner', !!move && slot.dataset.move === move);
    });
}

// ------------------------------------------------------ Feuille de partie

/**
 * @param {HTMLElement} el  .history-list
 * @param {{san: string, v?: number|'r'|null}[]} moves  dans l'ordre de la partie
 * @param {'w'|'b'} firstColor  camp du premier coup (problème qui commence aux Noirs)
 */
export function renderHistory(el, moves, firstColor = 'w') {
    if (!el) return;
    if (!moves?.length) {
        el.dataset.sig = '';
        el.innerHTML = `<div class="hist-empty">${esc(t('podium.noMoves', null, 'Aucun coup joué'))}</div>`;
        return;
    }
    // Rien de neuf : on ne reconstruit pas (pas de clignotement des pièces, animations préservées)
    const sig = firstColor + '|' + t('roster.white', null, 'Blancs') + '|' + moves.map(m => `${m.san}:${m.v ?? ''}`).join(',');
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const cells = firstColor === 'b' ? [null, ...moves] : [...moves];
    const lastIndex = cells.length - 1;
    const cell = (m, i) => {
        if (!m) return `<span class="hist-move hist-move--none">${i === 0 ? '…' : ''}</span>`;
        const vote = m.v === 'r' ? `<span class="hist-vote hist-vote--random" title="${esc(t('podium.random', null, 'Tirage au sort'))}">🎲</span>`
            : typeof m.v === 'number' ? `<span class="hist-vote">${m.v}%</span>` : '';
        // Pièce jouée, dans la couleur du camp (Blancs en colonne de gauche)
        const piece = pieceOf(m.san);
        const img = piece ? `<img class="hist-piece" src="${PIECE_IMG.replace('{piece}', (i % 2 ? 'b' : 'w') + piece)}" alt="" draggable="false">` : '';
        return `<span class="hist-move${i === lastIndex ? ' is-last' : ''}" data-ply="${i}">${img}<span class="hist-san">${esc(fmtMove(m.san))}</span>${vote}</span>`;
    };
    let rows = '';
    for (let i = 0; i < cells.length; i += 2) {
        rows += `<div class="hist-row"><span class="hist-num">${i / 2 + 1}.</span>${cell(cells[i], i)}${cell(cells[i + 1], i + 1)}</div>`;
    }
    el.innerHTML = `<div class="hist-table">
        <div class="hist-head"><span>#</span><span>${esc(t('roster.white', null, 'Blancs'))}</span><span>${esc(t('roster.black', null, 'Noirs'))}</span></div>
        ${rows}
    </div>`;
    el.scrollTop = el.scrollHeight;
}

// ------------------------------------------------------ Bandeau des votes

const MAX_TICKER = 30;

export function nameColor(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 75% 72%)`;
}

export const VoteTicker = {
    el() {
        const track = document.getElementById('vote-ticker-track');
        // Une seule ligne : la molette (geste vertical) fait défiler les votes à l'horizontale
        if (track && !track.dataset.wheelBound) {
            track.dataset.wheelBound = '1';
            track.addEventListener('wheel', (e) => {
                if (track.scrollWidth <= track.clientWidth) return;
                const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
                if (!d) return;
                e.preventDefault();
                track.scrollLeft += d;
            }, { passive: false });
        }
        return track;
    },
    /** Contenu d'un vote du bandeau, selon l'anonymat choisi */
    paint(item) {
        const { user, move } = item.dataset;
        const anon = hideVoterNames();
        const name = anon ? t('anonymity.viewer', null, 'Anonyme') : user;
        const shown = secretVotes() ? t('anonymity.voted', null, 'a voté') : fmtMove(move);
        item.classList.toggle('is-anon', anon);
        item.innerHTML = `<span class="vote-ticker__user"${anon ? '' : ` style="color:${nameColor(user)}"`}>${anon ? '<i class="fas fa-user-secret"></i> ' : ''}${esc(name)}</span> <span class="vote-ticker__move">${esc(shown)}</span>`;
    },
    /** Après un changement d'anonymat : on repeint les votes déjà affichés */
    repaint() {
        this.el()?.querySelectorAll('.vote-ticker__item').forEach(item => this.paint(item));
    },
    add(username, move) {
        const track = this.el();
        if (!track) return;
        const item = document.createElement('span');
        item.className = 'vote-ticker__item';
        item.dataset.user = username;
        item.dataset.move = move;
        this.paint(item);
        const keep = track.scrollLeft > 4; // l'utilisateur lit plus loin : on ne le fait pas sauter
        track.prepend(item);
        if (keep) track.scrollLeft += item.offsetWidth + 16;
        while (track.children.length > MAX_TICKER) track.lastElementChild.remove();
        track.closest('.vote-ticker')?.classList.add('has-votes');
    },
    clear() {
        const track = this.el();
        if (!track) return;
        track.innerHTML = '';
        track.closest('.vote-ticker')?.classList.remove('has-votes');
    }
};

/**
 * Colonne « Tape ton coup » : les coups déjà votés prennent la couleur du podium
 * et affichent leur nombre de votes ; les autres restent discrets.
 * @param {HTMLElement} panel - conteneur des boutons [data-move]
 * @param {Array<{move:string,count:number}>} votes - triés du plus voté au moins voté
 */
export function paintMoveChips(panel, votes, colors) {
    if (!panel) return;
    const clean = m => String(m || '').replace(/[+#!?]/g, '');
    const rank = new Map();
    (votes || []).filter(v => v.count > 0).forEach((v, i) => {
        if (!rank.has(clean(v.move))) rank.set(clean(v.move), { i, count: v.count });
    });
    panel.querySelectorAll('button[data-move]').forEach(btn => {
        const r = rank.get(clean(btn.dataset.move));
        btn.classList.toggle('is-voted', !!r);
        let badge = btn.querySelector('b');
        if (r) {
            btn.style.setProperty('--c', colors[r.i % colors.length]);
            if (!badge) { badge = document.createElement('b'); btn.appendChild(badge); }
            badge.textContent = r.count;
        } else {
            btn.style.removeProperty('--c');
            badge?.remove();
        }
    });
}

/**
 * Fondu enchaîné podium → roue : chaque marche du podium s'envole vers la roue
 * et s'y fond pendant que la roue se dévoile (le reste est en CSS : .votes-slot.is-drawing)
 */
export function morphPodiumToWheel(slot, target) {
    if (!slot || !target || typeof slot.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const box = slot.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const size = Math.min(t.width, t.height) || 240;
    const cx = t.left + t.width / 2 - box.left;
    const cy = t.top + t.height / 2 - box.top;
    slot.querySelectorAll('.podium__slot:not(.is-empty) .podium__step').forEach((step, i) => {
        const r = step.getBoundingClientRect();
        if (!r.width) return;
        const g = document.createElement('div');
        g.className = 'votes-slot__ghost';
        g.style.background = getComputedStyle(step.closest('.podium__slot')).getPropertyValue('--c') || '#8b5cf6';
        slot.appendChild(g);
        const end = size * (0.9 - i * 0.12);
        g.animate([
            { left: `${r.left - box.left}px`, top: `${r.top - box.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '10px 10px 4px 4px', opacity: 1 },
            { left: `${cx - end / 2}px`, top: `${cy - end / 2}px`, width: `${end}px`, height: `${end}px`, borderRadius: '50%', opacity: 0.55, offset: 0.7 },
            { left: `${cx - end / 2}px`, top: `${cy - end / 2}px`, width: `${end}px`, height: `${end}px`, borderRadius: '50%', opacity: 0 }
        ], { duration: 1000, delay: i * 70, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' }).onfinish = () => g.remove();
    });
}

// ------------------------------------------------------ Coup tiré, en grand dans l'encart du podium

/**
 * Affiche le coup tiré par la roue ou la bande, à la place du podium (mêmes visuels dans les deux styles)
 * @param {HTMLElement} slot  #votes-panel
 * @param {{move: string, color: string, pct: number|null, turn: 'w'|'b'}} w
 */
export function revealWinner(slot, { move, color, pct, turn = 'w' }) {
    if (!slot || !move) return;
    let el = slot.querySelector('.votes-slot__winner');
    if (!el) {
        el = document.createElement('div');
        el.className = 'votes-slot__winner';
        el.setAttribute('role', 'status');
        slot.appendChild(el);
    }
    const piece = pieceOf(move);
    const img = piece ? `<img class="votes-slot__winner-piece" src="${PIECE_IMG.replace('{piece}', turn + piece)}" alt="">` : '';
    const score = pct == null
        ? `<span class="votes-slot__winner-pct">🎲 ${esc(t('podium.random', null, 'Tirage au sort'))}</span>`
        : `<span class="votes-slot__winner-pct">${pct}%</span>`;
    el.style.setProperty('--win', color || '#10b981');
    el.innerHTML = `${img}<span class="votes-slot__winner-move">${esc(fmtMove(move))}</span>${score}`;
    slot.classList.add('has-winner');
}

export function clearWinner(slot) {
    slot?.classList.remove('has-winner');
}
