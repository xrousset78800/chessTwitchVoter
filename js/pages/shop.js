/**
 * Boutique : les pions gagnés (coups votés, Rush, Multi, bonus du jour, succès) s'échangent
 * contre des sets de pièces, des couleurs et matières d'échiquier, des couleurs de tirage.
 * Prix et objets réservés aux succès : CATALOG de economy.js (GET /api/economy/rules).
 * Achat : POST /api/economy/buy (window.economy.buy) puis l'objet est équipé tout de suite.
 *
 * Présentation : un onglet par rayon, des tuiles compactes, et une cabine d'essayage
 * (échiquier + tirage) qui combine les objets cliqués dans chaque rayon avant achat.
 */
import { PALETTES, PALETTE_IDS, FREE_PALETTES, getPaletteId, setPaletteId } from '../components/votePalettes.js';

const tr = (key, params) => window.i18n?.t?.(key, params) ?? key;
const t = (key, params) => tr(`shop.${key}`, params);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString(window.i18n?.currentLang || 'fr');
const CONFIRM_MS = 4000;
const CATS = [
    { key: 'pieces', icon: 'fa-chess-knight' },
    { key: 'boards', icon: 'fa-chess-board' },
    { key: 'mats', icon: 'fa-layer-group' },
    { key: 'palettes', icon: 'fa-palette' },
];
const FILTERS = ['all', 'buy', 'owned'];
// Position de la cabine : 1.e4 e5 2.Cf3 Cc6 3.Fc4
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R';
const SHARES = [34, 24, 16, 12, 8, 6];

let rules = null;          // { rules, catalog } du serveur
let confirming = null;     // id en attente de confirmation (deuxième clic)
let confirmTimer = null;
let busy = null;           // id en cours d'achat
const tried = { pieces: null, boards: null, mats: null, palettes: null };   // objet essayé par rayon
let tab = 'pieces';
let filter = 'all';
try {
    const s = localStorage.getItem('shopTab');
    if (CATS.some(c => c.key === s)) tab = s;
    const f = localStorage.getItem('shopFilter');
    if (FILTERS.includes(f)) filter = f;
} catch (e) { }
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };

/** Petit échiquier 4×4 (couleurs passées en style, matière par classe) */
function boardPreview(light, dark, matClass = '') {
    const style = light ? ` style="--sq-light:${light};--sq-dark:${dark}"` : '';
    const squares = Array.from({ length: 16 }, (_, i) => `<span class="${(Math.floor(i / 4) + i) % 2 ? 'sq-d' : 'sq-l'}"></span>`).join('');
    return `<div class="shop-board ${matClass}"${style}>${squares}</div>`;
}

/** Objets de chaque rayon : { own (id au magasin), free, name, preview, equipped, equip(), look } */
function catalog() {
    const pc = window.pieceCatalog;
    if (!pc) return {};
    const pal = getPaletteId();
    return {
        pieces: pc.sets.map(s => ({
            own: s.id, free: !!s.free, name: pc.label(s),
            preview: `<div class="shop-pieces">${['wK', 'wN', 'bQ', 'bP'].map(p => `<img src="${pc.url(p, s)}" alt="" loading="lazy">`).join('')}</div>`,
            equipped: pc.current().id === s.id,
            equip: () => window.setPieceSet(s.id),
            look: { set: s },
        })),
        boards: pc.boards.map(b => ({
            own: b.id, free: !!b.free, name: pc.boardLabel(b),
            preview: boardPreview(b.light, b.dark),
            equipped: pc.board().id === b.id,
            equip: () => window.setBoardTheme(b.id),
            look: { light: b.light, dark: b.dark },
        })),
        mats: pc.mats.map(m => ({
            own: m.own || m.id, free: !!m.free, name: pc.matLabel(m),
            preview: boardPreview(null, null, `mat--${m.id}`),
            equipped: pc.mat().id === m.id,
            equip: () => window.setBoardMat(m.id),
            look: { mat: m.id },
        })),
        palettes: PALETTE_IDS.map(id => ({
            own: FREE_PALETTES.includes(id) ? id : `pal-${id}`, free: FREE_PALETTES.includes(id),
            name: tr(`palette.${id}`),
            preview: `<div class="shop-palette">${PALETTES[id].slice(0, 8).map(c => `<span style="background:${c}"></span>`).join('')}</div>`,
            equipped: pal === id,
            equip: () => setPaletteId(id),
            look: { colors: PALETTES[id] },
        })),
    };
}

/** Succès qui offre cet objet (objets jamais en vente) */
function rewardOf(own) {
    const def = window.achievements?.defs?.list?.find(d => d.reward === own);
    return def ? tr(`achievements.list.${def.id}.name`) : null;
}

function itemState(item, acc) {
    const owned = item.free || !!acc?.owned?.includes(item.own) || !!window.unlockedRewards?.has?.(item.own);
    const price = rules?.catalog?.[item.own]?.price;
    if (owned) return { kind: item.equipped ? 'equipped' : 'owned' };
    if (price == null) return { kind: 'exclusive', reward: rewardOf(item.own) };
    if (!acc) return { kind: 'login', price };
    if (acc.coins < price) return { kind: 'poor', price, missing: price - acc.coins };
    return { kind: 'buy', price };
}

/** Ordre d'un rayon : gratuits, puis par prix, objets de succès à la fin */
function sortItems(items) {
    const rank = it => it.free ? -1 : (rules?.catalog?.[it.own]?.price ?? 1e9);
    return [...items].sort((a, b) => rank(a) - rank(b));
}

const isOwned = st => st.kind === 'equipped' || st.kind === 'owned';
const passes = (st) => filter === 'all' || (filter === 'owned' ? isOwned(st) : ['buy', 'poor', 'login'].includes(st.kind));

/** Objet affiché dans la cabine pour un rayon : l'essai en cours, sinon l'objet équipé */
function shown(cat, items) {
    const list = items[cat] || [];
    return list.find(i => i.own === tried[cat]) || list.find(i => i.equipped) || list[0];
}

function tile(item, acc) {
    const st = itemState(item, acc);
    const sel = shown(tab, catalogCache)?.own === item.own;
    let badge;
    switch (st.kind) {
        case 'equipped': badge = `<span class="shop-tile__badge is-on"><i class="fas fa-check"></i></span>`; break;
        case 'owned': badge = `<span class="shop-tile__meta">${esc(item.free ? t('free') : t('owned'))}</span>`; break;
        case 'exclusive': badge = `<span class="shop-tile__meta is-excl"><i class="fas fa-medal"></i> ${esc(t('exclusiveShort'))}</span>`; break;
        default: badge = `<span class="shop-tile__price${st.kind === 'poor' ? ' is-poor' : ''}">♟ ${fmtNum(st.price)}</span>`;
    }
    return `<li><button type="button" class="shop-tile is-${st.kind}${sel ? ' is-selected' : ''}" data-shop-try="${esc(item.own)}" aria-pressed="${sel}">
        <span class="shop-tile__preview">${item.preview}</span>
        <span class="shop-tile__name">${esc(item.name)}</span>
        ${badge}
    </button></li>`;
}

/** Bouton d'action de la cabine, pour l'objet sélectionné dans l'onglet */
function action(item, acc) {
    const st = itemState(item, acc);
    switch (st.kind) {
        case 'equipped':
            return `<span class="shop-tag shop-tag--on"><i class="fas fa-check"></i> ${esc(t('equipped'))}</span>`;
        case 'owned':
            return `<button class="btn btn--sm btn--primary" data-shop-equip="${esc(item.own)}">${esc(t('use'))}</button>`;
        case 'exclusive':
            return `<span class="shop-tag shop-tag--excl"><i class="fas fa-medal"></i> ${esc(st.reward ? t('exclusiveHint', { name: st.reward }) : t('exclusiveShort'))}</span>`;
        case 'login':
            return `<button class="btn btn--sm btn--primary" data-shop-login><i class="fab fa-twitch"></i> ${esc(t('loginToBuy', { n: fmtNum(st.price) }))}</button>`;
        case 'poor':
            return `<span class="shop-price is-poor">♟ ${fmtNum(st.price)}</span><span class="shop-tag">${esc(t('missing', { n: fmtNum(st.missing) }))}</span>`;
        default: {
            const conf = confirming === item.own;
            const label = busy === item.own ? `<i class="fas fa-spinner fa-spin"></i>`
                : conf ? esc(t('confirm', { n: fmtNum(st.price) })) : `${esc(t('buy'))} · ♟ ${fmtNum(st.price)}`;
            return `<button class="btn btn--sm btn--primary${conf ? ' is-confirm' : ''}" data-shop-buy="${esc(item.own)}"${busy ? ' disabled' : ''}>${label}</button>`;
        }
    }
}

let catalogCache = {};

/** Cabine d'essayage : échiquier et tirage avec les objets essayés de chaque rayon */
function fitting(items, acc) {
    const set = shown('pieces', items)?.look.set;
    const board = shown('boards', items)?.look;
    const mat = shown('mats', items)?.look.mat || 'none';
    const colors = shown('palettes', items)?.look.colors || [];
    const url = window.pieceCatalog.url;
    let squares = '';
    FEN.split('/').forEach((row, r) => {
        let f = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) {
                for (let k = 0; k < +ch; k++, f++) squares += `<span class="${(r + f) % 2 ? 'sq-d' : 'sq-l'}"></span>`;
            } else {
                const code = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
                squares += `<span class="${(r + f) % 2 ? 'sq-d' : 'sq-l'}"><img src="${url(code, set)}" alt=""></span>`;
                f++;
            }
        }
    });
    const sel = shown(tab, items);
    const trying = Object.keys(tried).some(k => tried[k] && !(items[k] || []).find(i => i.own === tried[k])?.equipped);
    return `<aside class="shop-fit">
        <div class="shop-fit__head"><span>${esc(t('fit.title'))}</span>${trying ? `<button type="button" class="shop-fit__reset" data-shop-reset><i class="fas fa-rotate-left"></i> ${esc(t('fit.reset'))}</button>` : ''}</div>
        <div class="shop-fit__board mat--${esc(mat)}" style="--sq-light:${board?.light};--sq-dark:${board?.dark}">${squares}</div>
        <div class="shop-fit__draw" title="${esc(tr('palette.title'))}">${SHARES.map((w, i) => `<span style="flex:${w};background:${colors[i] || '#555'}"></span>`).join('')}</div>
        ${sel ? `<div class="shop-fit__item">
            <div class="shop-fit__name"><small>${esc(t(`tab.${tab}`))}</small><b>${esc(sel.name)}</b></div>
            <div class="shop-fit__action">${action(sel, acc)}</div>
        </div>` : ''}
        <p class="shop-fit__hint">${esc(t('fit.hint'))}</p>
    </aside>`;
}

function wallet(acc) {
    const r = rules?.rules;
    const earn = r ? [
        t('earn.turn', { n: r.turn.coins, cap: fmtNum(r.dailyCoinCap) }),
        t('earn.daily', { n: r.daily.coins, bonus: r.daily.streakBonus, max: r.daily.coins + r.daily.streakBonus * r.daily.streakMax }),
        t('earn.rush', { n: r.rushRun.coinsPerPoint, rec: r.rushRecord.coins }),
        t('earn.multi', { win: r.multi.win.coins, draw: r.multi.draw.coins, loss: r.multi.loss.coins }),
        t('earn.ach', { b: r.achievement.B.coins, a: r.achievement.A.coins, o: r.achievement.O.coins, p: r.achievement.P.coins }),
    ] : [];
    const how = `<details class="shop-earn"><summary><i class="fas fa-circle-info"></i> ${esc(t('earnTitle'))}</summary>
        <ul>${earn.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>`;
    if (acc) {
        return `<div class="shop-wallet"><b>♟ ${fmtNum(acc.coins)}</b>
            <small>${esc(t('today', { n: fmtNum(acc.dayCoins), cap: fmtNum(acc.dailyCoinCap) }))}</small>${how}</div>`;
    }
    if (window.twitchAuth?.isLoggedIn) return `<div class="shop-wallet"><i class="fas fa-spinner fa-spin"></i>${how}</div>`;
    return `<div class="shop-wallet shop-wallet--guest"><span>${esc(t('loginHint'))}</span>
        <button class="btn btn--sm btn--twitch" data-shop-login><i class="fab fa-twitch"></i> ${esc(tr('twitch.connect'))}</button>${how}</div>`;
}

const ShopPage = {
    async init() {
        const root = document.getElementById('shop-root');
        if (!root) return;
        if (!rules) {
            try {
                const r = await fetch('/api/economy/rules');
                if (r.ok) rules = await r.json();
            } catch (e) { console.warn('🛒 Boutique indisponible :', e.message); }
        }
        await window.achievements?.ready;
        if (!rules) { root.innerHTML = `<div class="rec-empty">${esc(t('unavailable'))}</div>`; return; }
        if (!root.dataset.bound) this.bind(root);
        this.render();
    },

    bind(root) {
        root.dataset.bound = '1';
        const page = document.getElementById('page-shop');
        page.addEventListener('click', async (e) => {
            if (e.target.closest('[data-shop-login]')) return window.twitchAuth?.login();
            const tb = e.target.closest('[data-shop-tab]');
            if (tb) { tab = tb.dataset.shopTab; remember('shopTab', tab); confirming = null; return this.render(); }
            const fl = e.target.closest('[data-shop-filter]');
            if (fl) { filter = fl.dataset.shopFilter; remember('shopFilter', filter); return this.render(); }
            const tryBtn = e.target.closest('[data-shop-try]');
            if (tryBtn) {
                const id = tryBtn.dataset.shopTry;
                tried[tab] = id;
                if (confirming !== id) confirming = null;
                return this.render();
            }
            if (e.target.closest('[data-shop-reset]')) {
                for (const k of Object.keys(tried)) tried[k] = null;
                confirming = null;
                return this.render();
            }
            const eq = e.target.closest('[data-shop-equip]');
            if (eq) {
                const it = this.find(eq.dataset.shopEquip);
                it?.equip();
                if (it) tried[it.cat] = null;
                return this.render();
            }
            const b = e.target.closest('[data-shop-buy]');
            if (!b || busy) return;
            const id = b.dataset.shopBuy;
            if (confirming !== id) {
                confirming = id;
                clearTimeout(confirmTimer);
                confirmTimer = setTimeout(() => { confirming = null; this.render(); }, CONFIRM_MS);
                return this.render();
            }
            clearTimeout(confirmTimer);
            confirming = null;
            busy = id;
            this.render();
            const item = this.find(id);
            try {
                await window.economy.buy(id);
                busy = null;
                item?.equip();
                if (item) tried[item.cat] = null;
                window.AppToast?.show(esc(t('bought', { name: item?.name || id })), 'success', 4000);
            } catch (err) {
                busy = null;
                window.AppToast?.show(esc(err.status === 402 ? t('errPoor') : t('errBuy')), 'error', 4000);
                window.economy?.refresh();
            }
            this.render();
        });
        // Flèches gauche / droite entre les onglets
        page.addEventListener('keydown', (e) => {
            const cur = e.target.closest?.('[data-shop-tab]');
            if (!cur || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
            const i = CATS.findIndex(c => c.key === tab);
            tab = CATS[(i + (e.key === 'ArrowRight' ? 1 : CATS.length - 1)) % CATS.length].key;
            remember('shopTab', tab);
            this.render();
            document.querySelector(`[data-shop-tab="${tab}"]`)?.focus();
        });
    },

    find(own) {
        const items = catalog();
        for (const cat of Object.keys(items)) {
            const it = items[cat].find(i => i.own === own);
            if (it) return { ...it, cat };
        }
        return null;
    },

    render() {
        const root = document.getElementById('shop-root');
        if (!root || !rules) return;
        const acc = window.economy?.account || null;
        const items = catalogCache = catalog();
        const slot = document.getElementById('shop-wallet');
        if (slot) slot.innerHTML = wallet(acc);

        const tabs = CATS.map(c => {
            const list = items[c.key] || [];
            const owned = list.filter(i => isOwned(itemState(i, acc))).length;
            const on = c.key === tab;
            return `<button type="button" role="tab" class="shop-tab${on ? ' is-active' : ''}" data-shop-tab="${c.key}" aria-selected="${on}" tabindex="${on ? 0 : -1}">
                <i class="fas ${c.icon}" aria-hidden="true"></i><span>${esc(t(`tab.${c.key}`))}</span><small>${owned}/${list.length}</small>
            </button>`;
        }).join('');
        const visible = sortItems(items[tab] || []).filter(i => passes(itemState(i, acc)));
        const filters = FILTERS.map(f => `<button type="button" class="shop-filter${f === filter ? ' is-active' : ''}" data-shop-filter="${f}" aria-pressed="${f === filter}">${esc(t(`filter.${f}`))}</button>`).join('');

        root.innerHTML = `<div class="shop-layout">
            ${fitting(items, acc)}
            <div class="shop-main">
                <div class="shop-tabs" role="tablist">${tabs}</div>
                <div class="shop-sub">
                    <p>${esc(t(`catDesc.${tab}`))}</p>
                    <div class="shop-filters">${filters}</div>
                </div>
                ${visible.length
                    ? `<ul class="shop-grid" role="tabpanel">${visible.map(it => tile(it, acc)).join('')}</ul>`
                    : `<p class="shop-empty">${esc(t('empty'))}</p>`}
            </div>
        </div>`;
    },
};

const isActive = () => document.getElementById('page-shop')?.classList.contains('is-active');
const rerender = () => { if (isActive()) ShopPage.render(); };
for (const ev of ['economyChanged', 'languageChanged', 'pieceSetChanged', 'boardThemeChanged', 'boardMatChanged', 'twitchAuthChange']) {
    window.addEventListener(ev, rerender);
}
document.addEventListener('votePaletteChanged', rerender);

export default ShopPage;
