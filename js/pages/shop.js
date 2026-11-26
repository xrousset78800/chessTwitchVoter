/**
 * Boutique : les pions gagnés (coups votés, Rush, Multi, bonus du jour, succès) s'échangent
 * contre des sets de pièces, des couleurs et matières d'échiquier, des couleurs de tirage.
 * Prix et objets réservés aux succès : CATALOG de economy.js (GET /api/economy/rules).
 * Achat : POST /api/economy/buy (window.economy.buy) puis l'objet est équipé tout de suite.
 */
import { PALETTES, PALETTE_IDS, FREE_PALETTES, getPaletteId, setPaletteId } from '../components/votePalettes.js';

const tr = (key, params) => window.i18n?.t?.(key, params) ?? key;
const t = (key, params) => tr(`shop.${key}`, params);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString(window.i18n?.locale?.() || 'fr-FR');
const CONFIRM_MS = 4000;

let rules = null;          // { rules, catalog } du serveur
let confirming = null;     // id en attente de confirmation (deuxième clic)
let confirmTimer = null;
let busy = null;           // id en cours d'achat

/** Aperçu d'échiquier 4×4 (couleurs passées en style, matière par classe) */
function boardPreview(light, dark, matClass = '') {
    const style = light ? ` style="--sq-light:${light};--sq-dark:${dark}"` : '';
    const squares = Array.from({ length: 16 }, (_, i) => `<span class="${(Math.floor(i / 4) + i) % 2 ? 'sq-d' : 'sq-l'}"></span>`).join('');
    return `<div class="shop-board ${matClass}"${style}>${squares}</div>`;
}

/** Objets de chaque rayon : { id local, own (id au magasin), free, name, preview, equipped, equip() } */
function sections() {
    const pc = window.pieceCatalog;
    if (!pc) return [];
    const out = [];
    out.push({
        key: 'pieces', icon: 'fa-chess-knight',
        items: pc.sets.map(s => ({
            own: s.id, free: !!s.free, name: pc.label(s),
            preview: `<div class="shop-pieces">${['wK', 'wN', 'bQ', 'bP'].map(p => `<img src="${pc.url(p, s)}" alt="" loading="lazy">`).join('')}</div>`,
            equipped: pc.current().id === s.id,
            equip: () => window.setPieceSet(s.id),
        })),
    });
    out.push({
        key: 'boards', icon: 'fa-chess-board',
        items: pc.boards.map(b => ({
            own: b.id, free: !!b.free, name: pc.boardLabel(b),
            preview: boardPreview(b.light, b.dark),
            equipped: pc.board().id === b.id,
            equip: () => window.setBoardTheme(b.id),
        })),
    });
    out.push({
        key: 'mats', icon: 'fa-layer-group',
        items: pc.mats.map(m => ({
            own: m.own || m.id, free: !!m.free, name: pc.matLabel(m),
            preview: boardPreview(null, null, `mat--${m.id}`),
            equipped: pc.mat().id === m.id,
            equip: () => window.setBoardMat(m.id),
        })),
    });
    const pal = getPaletteId();
    out.push({
        key: 'palettes', icon: 'fa-palette',
        items: PALETTE_IDS.map(id => ({
            own: FREE_PALETTES.includes(id) ? id : `pal-${id}`, free: FREE_PALETTES.includes(id),
            name: tr(`palette.${id}`),
            preview: `<div class="shop-palette">${PALETTES[id].slice(0, 8).map(c => `<span style="background:${c}"></span>`).join('')}</div>`,
            equipped: pal === id,
            equip: () => setPaletteId(id),
        })),
    });
    return out;
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

function card(item, acc) {
    const st = itemState(item, acc);
    let foot;
    switch (st.kind) {
        case 'equipped':
            foot = `<span class="shop-tag shop-tag--on"><i class="fas fa-check"></i> ${esc(t('equipped'))}</span>`; break;
        case 'owned':
            foot = `<button class="btn btn--sm btn--ghost" data-shop-equip="${esc(item.own)}">${esc(t('use'))}</button>`
                + (item.free ? `<span class="shop-tag">${esc(t('free'))}</span>` : `<span class="shop-tag">${esc(t('owned'))}</span>`); break;
        case 'exclusive':
            foot = `<span class="shop-tag shop-tag--excl" title="${esc(st.reward ? t('exclusiveHint', { name: st.reward }) : '')}"><i class="fas fa-medal"></i> ${esc(st.reward ? t('exclusive', { name: st.reward }) : t('exclusiveShort'))}</span>`; break;
        case 'login':
            foot = `<span class="shop-price">♟ ${fmtNum(st.price)}</span>`; break;
        case 'poor':
            foot = `<span class="shop-price is-poor">♟ ${fmtNum(st.price)}</span><span class="shop-tag">${esc(t('missing', { n: fmtNum(st.missing) }))}</span>`; break;
        default: {
            const conf = confirming === item.own;
            const label = busy === item.own ? `<i class="fas fa-spinner fa-spin"></i>`
                : conf ? esc(t('confirm', { n: fmtNum(st.price) })) : `${esc(t('buy'))} · ♟ ${fmtNum(st.price)}`;
            foot = `<button class="btn btn--sm btn--primary${conf ? ' is-confirm' : ''}" data-shop-buy="${esc(item.own)}"${busy ? ' disabled' : ''}>${label}</button>`;
        }
    }
    return `<li class="shop-card is-${st.kind}">
        <div class="shop-card__preview">${item.preview}</div>
        <div class="shop-card__name">${esc(item.name)}</div>
        <div class="shop-card__foot">${foot}</div>
    </li>`;
}

/** Ordre d'un rayon : gratuits, puis par prix, objets de succès à la fin */
function sortItems(items) {
    const rank = it => it.free ? -1 : (rules?.catalog?.[it.own]?.price ?? 1e9);
    return [...items].sort((a, b) => rank(a) - rank(b));
}

function header(acc) {
    const r = rules?.rules;
    const earn = r ? [
        t('earn.turn', { n: r.turn.coins, cap: fmtNum(r.dailyCoinCap) }),
        t('earn.daily', { n: r.daily.coins, bonus: r.daily.streakBonus, max: r.daily.coins + r.daily.streakBonus * r.daily.streakMax }),
        t('earn.rush', { n: r.rushRun.coinsPerPoint, rec: r.rushRecord.coins }),
        t('earn.multi', { win: r.multi.win.coins, draw: r.multi.draw.coins, loss: r.multi.loss.coins }),
        t('earn.ach', { b: r.achievement.B.coins, a: r.achievement.A.coins, o: r.achievement.O.coins, p: r.achievement.P.coins }),
    ] : [];
    const wallet = acc
        ? `<div class="shop-wallet"><b>♟ ${fmtNum(acc.coins)}</b><span>${esc(t('balance'))}</span>
            <small>${esc(t('today', { n: fmtNum(acc.dayCoins), cap: fmtNum(acc.dailyCoinCap) }))}</small></div>`
        : window.twitchAuth?.isLoggedIn
            ? `<div class="shop-wallet"><i class="fas fa-spinner fa-spin"></i></div>`
            : `<div class="shop-wallet shop-wallet--guest"><i class="fab fa-twitch"></i><p>${esc(t('loginHint'))}</p>
                <button class="btn btn--sm btn--primary" data-shop-login>${esc(tr('twitch.connect'))}</button></div>`;
    return `<div class="shop-top">${wallet}
        <details class="shop-earn"${acc ? '' : ' open'}><summary><i class="fas fa-circle-info"></i> ${esc(t('earnTitle'))}</summary>
        <ul>${earn.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details></div>`;
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
        root.addEventListener('click', async (e) => {
            if (e.target.closest('[data-shop-login]')) return window.twitchAuth?.login();
            const eq = e.target.closest('[data-shop-equip]');
            if (eq) return this.find(eq.dataset.shopEquip)?.equip();
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
                window.AppToast?.show(esc(t('bought', { name: item?.name || id })), 'success', 4000);
            } catch (err) {
                busy = null;
                window.AppToast?.show(esc(err.status === 402 ? t('errPoor') : t('errBuy')), 'error', 4000);
                window.economy?.refresh();
            }
            this.render();
        });
    },

    find(own) {
        for (const s of sections()) for (const it of s.items) if (it.own === own) return it;
        return null;
    },

    render() {
        const root = document.getElementById('shop-root');
        if (!root || !rules) return;
        const acc = window.economy?.account || null;
        root.innerHTML = header(acc) + sections().map(s => `<section class="shop-cat">
            <h2 class="ach-cat__title"><i class="fas ${s.icon}"></i> ${esc(t(`cat.${s.key}`))}</h2>
            <p class="shop-cat__desc">${esc(t(`catDesc.${s.key}`))}</p>
            <ul class="shop-grid">${sortItems(s.items).map(it => card(it, acc)).join('')}</ul>
        </section>`).join('');
    },
};

const isActive = () => document.getElementById('page-shop')?.classList.contains('is-active');
const rerender = () => { if (isActive()) ShopPage.render(); };
for (const ev of ['economyChanged', 'languageChanged', 'pieceSetChanged', 'boardThemeChanged', 'boardMatChanged']) {
    window.addEventListener(ev, rerender);
}
document.addEventListener('votePaletteChanged', rerender);

export default ShopPage;
