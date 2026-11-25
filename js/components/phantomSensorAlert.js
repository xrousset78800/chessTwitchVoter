/**
 * Fenêtre « capteurs du Phantom » : quand l'échiquier signale que ses capteurs ne
 * correspondent pas à la position attendue (ERROR_MSG « matrix do not match »),
 * le propriétaire voit la position souhaitée, les cases fautives en couleur
 * (pièce manquante / détection sur case vide) et la liste en clair.
 * La fenêtre se met à jour à chaque nouveau relevé et se ferme seule quand les
 * capteurs redeviennent conformes. Fermée à la main, elle ne revient que pour
 * une autre position attendue.
 */
const t = (key, params, fallback) => {
    const s = window.i18n?.t(key, params);
    let out = s && s !== key ? s : fallback;
    if (params) for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, v);
    return out;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let el = null;
let dismissed = null;   // position attendue pour laquelle la fenêtre a été fermée à la main
let okTimer = null;

function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'modal-overlay phantom-sensor';
    el.innerHTML = `
        <div class="modal phantom-sensor__modal" role="alertdialog" aria-labelledby="phantom-sensor-title">
            <div class="modal__header">
                <h3 class="modal__title" id="phantom-sensor-title"></h3>
                <button class="modal__close" data-ps-close aria-label="×">&times;</button>
            </div>
            <div class="modal__body">
                <p class="phantom-sensor__lead"></p>
                <div class="phantom-sensor__board"></div>
                <ul class="phantom-sensor__legend"></ul>
                <p class="phantom-sensor__hint"></p>
            </div>
            <div class="modal__footer phantom-sensor__footer">
                <button class="btn btn--sm" data-ps-snap></button>
                <button class="btn btn--sm" data-ps-recal></button>
                <button class="btn btn--sm" data-ps-close></button>
            </div>
        </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
        if (e.target === el || e.target.closest('[data-ps-close]')) close(true);
        const phantom = window.phantomChessboard;
        if (!phantom?.isConnected) return;
        if (e.target.closest('[data-ps-snap]')) phantom.snapToCenter();
        if (e.target.closest('[data-ps-recal]')) {
            // Recale la mécanique puis repose la position que l'échiquier devait avoir
            const fen = phantom.lastFenSent;
            close(false);
            phantom.recalibrate(() => fen);
        }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('is-active')) close(true); });
    return el;
}

function close(manual) {
    if (!el) return;
    if (manual) dismissed = el.dataset.expected || null;
    el.classList.remove('is-active');
    clearTimeout(okTimer);
}

/** Matrice 10×10 colonne par colonne → case (« e4 ») → caractère */
function squares(expected) {
    const map = {};
    for (let c = 1; c <= 8; c++) for (let r = 1; r <= 8; r++) {
        map['abcdefgh'[c - 1] + (9 - r)] = expected[c * 10 + r];
    }
    return map;
}

function boardHtml(expected, missing, extra) {
    const pos = squares(expected);
    const miss = new Set(missing), ext = new Set(extra);
    let html = '';
    for (let rank = 8; rank >= 1; rank--) {
        for (let f = 0; f < 8; f++) {
            const sq = 'abcdefgh'[f] + rank;
            const p = pos[sq];
            const dark = (f + rank) % 2 === 1 ? ' is-dark' : '';   // a1 sombre
            const state = miss.has(sq) ? ' is-missing' : ext.has(sq) ? ' is-extra' : '';
            const img = p && p !== '.'
                ? `<img src="./img/chesspieces/wikipedia/${p === p.toUpperCase() ? 'w' : 'b'}${p.toUpperCase()}.png" alt="${p}">`
                : '';
            const coord = (f === 0 ? `<span class="phantom-sensor__rank">${rank}</span>` : '') +
                (rank === 1 ? `<span class="phantom-sensor__file">${'abcdefgh'[f]}</span>` : '');
            html += `<div class="phantom-sensor__sq${dark}${state}" title="${sq}">${img}${coord}</div>`;
        }
    }
    return html;
}

/** @param {{expected:string, missing:string[], extra:string[], seen:number, total:number}} d */
export function showSensorAlert(d) {
    if (!d?.expected) return;
    if (dismissed && dismissed === d.expected) return;
    dismissed = null;
    clearTimeout(okTimer);
    const root = ensure();
    root.classList.remove('is-ok');
    root.dataset.expected = d.expected;
    root.querySelector('.phantom-sensor__modal').classList.remove('is-ok');
    root.querySelector('#phantom-sensor-title').textContent = t('phantom.sensor.title', null, '⚠️ Phantom : position incorrecte');
    root.querySelector('.phantom-sensor__lead').textContent = t('phantom.sensor.lead', { seen: d.seen, total: d.total },
        `L'échiquier ne détecte pas la position attendue (${d.seen}/${d.total} pièces détectées). Voici la position souhaitée :`);
    root.querySelector('.phantom-sensor__board').innerHTML = boardHtml(d.expected, d.missing, d.extra);
    const items = [];
    if (d.missing.length) items.push(`<li><span class="phantom-sensor__dot is-missing"></span>${esc(t('phantom.sensor.missing', null, 'Pièce attendue mais non détectée'))} : <b>${esc(d.missing.join(' '))}</b></li>`);
    if (d.extra.length) items.push(`<li><span class="phantom-sensor__dot is-extra"></span>${esc(t('phantom.sensor.extra', null, 'Pièce détectée sur une case qui devrait être vide'))} : <b>${esc(d.extra.join(' '))}</b></li>`);
    if (!items.length) items.push(`<li>${esc(t('phantom.sensor.unknown', null, 'Écart non localisé par les capteurs'))}</li>`);
    root.querySelector('.phantom-sensor__legend').innerHTML = items.join('');
    root.querySelector('.phantom-sensor__hint').textContent = t('phantom.sensor.hint', null,
        'Replace les pièces à la main comme sur le schéma : la fenêtre se met à jour et se ferme dès que tout est en place.');
    labelButtons(root);
    root.classList.add('is-active');
}

function labelButtons(root) {
    root.querySelector('[data-ps-snap]').textContent = t('phantom.sensor.snap', null, 'Centrer les pièces');
    root.querySelector('[data-ps-recal]').textContent = t('phantom.sensor.recal', null, 'Recalibrer');
    root.querySelector('.modal__footer [data-ps-close]').textContent = t('phantom.sensor.close', null, 'Fermer');
}

/**
 * Autre erreur signalée par l'échiquier (message non lisible comme écart de capteurs) :
 * même fenêtre, avec le message brut et les actions de recentrage, au lieu d'un simple toast.
 */
export function showPhantomError(text) {
    const key = 'err:' + String(text);
    if (dismissed && dismissed === key) return;
    dismissed = null;
    clearTimeout(okTimer);
    const root = ensure();
    root.dataset.expected = key;
    root.querySelector('.phantom-sensor__modal').classList.remove('is-ok');
    root.querySelector('#phantom-sensor-title').textContent = t('phantom.sensor.errorTitle', null, '⚠️ Phantom : erreur signalée');
    root.querySelector('.phantom-sensor__lead').textContent = String(text).slice(0, 300);
    root.querySelector('.phantom-sensor__board').innerHTML = '';
    root.querySelector('.phantom-sensor__legend').innerHTML = '';
    root.querySelector('.phantom-sensor__hint').textContent = t('phantom.sensor.errorHint', null,
        'Si les pièces sont posées à côté des cases : « Centrer les pièces », ou « Recalibrer » pour recaler la mécanique puis reposer la position.');
    labelButtons(root);
    root.classList.add('is-active');
}

/** Capteurs de nouveau conformes : confirmation brève puis fermeture */
export function sensorsOk() {
    dismissed = null;
    if (!el?.classList.contains('is-active')) return;
    el.querySelector('.phantom-sensor__modal').classList.add('is-ok');
    el.querySelector('#phantom-sensor-title').textContent = t('phantom.sensor.ok', null, '✅ Phantom : position correcte');
    el.querySelectorAll('.phantom-sensor__board .is-missing, .phantom-sensor__board .is-extra').forEach(x => x.classList.remove('is-missing', 'is-extra'));
    el.querySelector('.phantom-sensor__legend').innerHTML = '';
    clearTimeout(okTimer);
    okTimer = setTimeout(() => close(false), 2000);
}
