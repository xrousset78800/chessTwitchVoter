/**
 * Panneaux de vote partagés par les joueurs et les spectateurs :
 * - podium des votes en cours (top 3 avec la pièce jouée, le reste en puces)
 * - feuille de partie (# / Blancs / Noirs, score du vote sous chaque coup)
 * - bandeau des votes du chat sous l'échiquier
 */
import { paletteColors } from './votePalettes.js';

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
    const list = (votes || []).filter(v => v && v.count > 0);
    const total = list.reduce((n, v) => n + v.count, 0);
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
        slot.querySelector('.podium__move').textContent = v.move;
        slot.querySelector('.podium__pct').textContent = `${pct}%`;
        slot.querySelector('.podium__count').textContent = t(v.count > 1 ? 'podium.votesMany' : 'podium.votesOne', { n: v.count }, `${v.count} vote${v.count > 1 ? 's' : ''}`);
        // Hauteur de la marche : le 1er au maximum, les autres en proportion
        slot.querySelector('.podium__step').style.height = `${Math.round(40 + 64 * (v.count / top))}px`;
    });

    const rest = list.slice(3);
    const restEl = podium.querySelector('.podium__rest');
    if (!list.length) {
        restEl.innerHTML = `<span class="podium__hint">${esc(t('podium.none', null, 'Aucun vote pour l\'instant'))}</span>`;
    } else {
        const shown = rest.slice(0, 6);
        restEl.innerHTML = shown.map((v, i) => `<span class="podium__chip" style="--c:${colors[(i + 3) % colors.length]}"><b>${esc(v.move)}</b> ${v.count}</span>`).join('')
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
        el.innerHTML = `<div class="hist-empty">${esc(t('podium.noMoves', null, 'Aucun coup joué'))}</div>`;
        return;
    }
    const cells = firstColor === 'b' ? [null, ...moves] : [...moves];
    const lastIndex = cells.length - 1;
    const cell = (m, i) => {
        if (!m) return `<span class="hist-move hist-move--none">${i === 0 ? '…' : ''}</span>`;
        const vote = m.v === 'r' ? `<span class="hist-vote hist-vote--random" title="${esc(t('podium.random', null, 'Tirage au sort'))}">🎲</span>`
            : typeof m.v === 'number' ? `<span class="hist-vote">${m.v}%</span>` : '';
        return `<span class="hist-move${i === lastIndex ? ' is-last' : ''}"><span class="hist-san">${esc(m.san)}</span>${vote}</span>`;
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

function nameColor(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 75% 72%)`;
}

export const VoteTicker = {
    el() {
        return document.getElementById('vote-ticker-track');
    },
    add(username, move) {
        const track = this.el();
        if (!track) return;
        const item = document.createElement('span');
        item.className = 'vote-ticker__item';
        item.innerHTML = `<span class="vote-ticker__user" style="color:${nameColor(username)}">${esc(username)}</span> <span class="vote-ticker__move">${esc(move)}</span>`;
        track.prepend(item);
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
