/**
 * Boutique : les pions gagnés (coups votés, Rush, Multi, bonus du jour, succès) s'échangent
 * contre des sets de pièces, des couleurs et matières d'échiquier, des couleurs de tirage,
 * des kits de sons, des effets (traînée, prise, victoire), l'habillage du stream (roue, flèche),
 * l'apparence vue par les autres (couleur du pseudo, cadre, badge) et des packs.
 * Prix, niveau requis, objets réservés aux succès, promo de la semaine : economy.js (GET /api/economy/rules).
 * Achat : POST /api/economy/buy (window.economy.buy) puis l'objet est équipé tout de suite.
 *
 * Présentation : un onglet par rayon, des tuiles compactes, et une cabine d'essayage
 * (échiquier + tirage) qui combine les objets cliqués dans chaque rayon avant achat.
 */
import { PALETTES, PALETTE_IDS, FREE_PALETTES, getPaletteId, setPaletteId } from '../components/votePalettes.js';
import Cosmetics, { ITEMS } from '../core/cosmetics.js';

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
    { key: 'themes', icon: 'fa-fill-drip' },
    { key: 'sounds', icon: 'fa-volume-high' },
    { key: 'effects', icon: 'fa-wand-magic-sparkles' },
    { key: 'stream', icon: 'fa-tower-broadcast' },
    { key: 'profile', icon: 'fa-id-badge' },
    { key: 'packs', icon: 'fa-box-open' },
];
// Rayons des cosmétiques : emplacements (slots de js/core/cosmetics.js) qu'ils regroupent
const CAT_SLOTS = { sounds: ['sound'], effects: ['trail', 'capture', 'win'], stream: ['wheel', 'arrow'], profile: ['color', 'frame', 'badge', 'fly'] };
const FILTERS = ['all', 'buy', 'owned'];
// Position de la cabine : 1.e4 e5 2.Cf3 Cc6 3.Fc4
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R';
const SHARES = [34, 24, 16, 12, 8, 6];
const DEMO = { from: 45, to: 28 };   // Cf3xe5 dans la cabine (index des cases, a8 = 0)

let rules = null;          // { rules, catalog, deal } du serveur
let confirming = null;     // id en attente de confirmation (deuxième clic)
let confirmTimer = null;
let busy = null;           // id en cours d'achat
const tried = Object.fromEntries(CATS.map(c => [c.key, null]));   // objet essayé par rayon
const triedSlot = {};      // objet essayé par emplacement de cosmétique (cabine)
let tab = 'pieces';
let filter = 'all';
try {
    const s = localStorage.getItem('shopTab');
    if (CATS.some(c => c.key === s)) tab = s;
    const f = localStorage.getItem('shopFilter');
    if (FILTERS.includes(f)) filter = f;
} catch (e) { }
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };

/** Nom d'un objet du magasin (cosmétiques, packs) ; repli sur l'id */
export function itemName(id) {
    const k = `shop.item.${id}`, s = tr(k);
    return s && s !== k ? s : id;
}

/** Petit échiquier 4×4 (couleurs passées en style, matière par classe) */
function boardPreview(light, dark, matClass = '') {
    const style = light ? ` style="--sq-light:${light};--sq-dark:${dark}"` : '';
    const squares = Array.from({ length: 16 }, (_, i) => `<span class="${(Math.floor(i / 4) + i) % 2 ? 'sq-d' : 'sq-l'}"></span>`).join('');
    return `<div class="shop-board ${matClass}"${style}>${squares}</div>`;
}

const arrowSvg = (color, glow) => `<svg class="shop-arrow" viewBox="0 0 44 20" aria-hidden="true"${glow ? ` style="filter:drop-shadow(0 0 3px ${glow})"` : ''}><path d="M3 10H30" stroke="${color}" stroke-width="5" stroke-linecap="round"/><path d="M27 2L41 10L27 18Z" fill="${color}"/></svg>`;
const wheelCss = (skin) => {
    const pal = PALETTES[getPaletteId()] || PALETTES[PALETTE_IDS[0]];
    const stops = pal.slice(0, 6).map((c, i) => `${c} ${i * 60}deg ${(i + 1) * 60}deg`).join(',');
    return `--rim:${skin.rim};--ring:${skin.ring};--lamp:rgb(${skin.lamp});--hub:${skin.hub};--glow:${skin.glow};background:conic-gradient(${stops})`;
};
const WHEEL_DEFAULT = { rim: '#2b211b', ring: 'rgba(255,138,61,.35)', lamp: '255,196,140', hub: '#ff8a3d', glow: '#ff8a3d' };

/** Aperçu d'un cosmétique dans sa tuile */
function cosmPreview(id) {
    const it = ITEMS[id] || {};
    switch (it.slot) {
        case 'sound': return `<div class="shop-cosm shop-cosm--sound"><i class="fas ${it.icon || 'fa-volume-high'}"></i><span class="shop-eq"><b></b><b></b><b></b><b></b><b></b></span></div>`;
        case 'trail': return `<div class="shop-cosm shop-cosm--trail" style="--c1:${it.colors[0]};--c2:${it.colors[1]};--c3:${it.colors[2]}"><span></span>${it.stars ? '<i>✦</i><i>✦</i>' : ''}</div>`;
        case 'capture': return `<div class="shop-cosm shop-cosm--cap">${Array.from({ length: 8 }, (_, i) => `<span style="--a:${i * 45}deg;background:${it.colors[i % 3]}"></span>`).join('')}<b style="background:${it.colors[1]}"></b></div>`;
        case 'win': return `<div class="shop-cosm shop-cosm--win"><i class="fas ${it.icon}"></i></div>`;
        case 'wheel': return `<div class="shop-cosm"><span class="shop-wheel" style="${wheelCss(it)}"><i></i></span></div>`;
        case 'arrow': return `<div class="shop-cosm">${arrowSvg(it.color, it.glow)}</div>`;
        case 'color': return `<div class="shop-cosm"><span class="shop-cosm__name" style="color:${it.color}">${esc(window.economy?.account?.login || 'viewer')}</span></div>`;
        case 'frame': return `<div class="shop-cosm"><span class="shop-avatar look-frame ${it.cls}"><i class="fas fa-user"></i></span></div>`;
        case 'badge': return `<div class="shop-cosm shop-cosm--badge"><i class="fas ${it.icon}" style="color:${it.color}"></i></div>`;
        case 'fly': return `<div class="shop-cosm"><span class="shop-flychip ${it.cls}">♟ +2</span></div>`;
        default: return '';
    }
}

function cosmItem(id) {
    const it = ITEMS[id];
    return {
        own: id, slot: it.slot, free: false, name: itemName(id), preview: cosmPreview(id),
        equipped: Cosmetics.get(it.slot) === id,
        equip: () => Cosmetics.set(it.slot, id),
        unequip: () => Cosmetics.set(it.slot, null),
    };
}
const slotIds = (slots) => Object.keys(ITEMS).filter(id => slots.includes(ITEMS[id].slot));

/** Objets de chaque rayon : { own (id au magasin), free, name, preview, equipped, equip(), look } */
function catalog() {
    const pc = window.pieceCatalog;
    if (!pc) return {};
    const pal = getPaletteId();
    const packs = Object.entries(rules?.catalog || {}).filter(([, x]) => x.kind === 'bundle').map(([id, x]) => ({
        own: id, free: false, name: itemName(id), bundle: x.items,
        preview: `<div class="shop-cosm shop-cosm--pack">${x.items.map(i => `<span>${cosmPreview(i)}</span>`).join('')}</div>`,
        equipped: false, equip: () => { },
    }));
    return {
        pieces: pc.sets.map(s => ({
            own: s.id, free: !!s.free, name: pc.label(s),
            preview: `<div class="shop-pieces">${['wK', 'wN', 'bQ', 'bP'].map(p => `<img src="${pc.url(p, s)}" alt="" loading="lazy">`).join('')}</div>`,
            equipped: pc.current().id === s.id,
            equip: () => window.setPieceSet(s.id),
            look: { set: s },
        })),
        boards: pc.boards.map(b => ({
            own: b.own || b.id, free: !!b.free, name: pc.boardLabel(b),
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
        themes: (pc.themes || []).map(x => ({
            own: x.own || x.id, free: !!x.free, name: pc.themeLabel(x),
            preview: `<div class="shop-theme bg--${x.id}"><i></i><i></i><i></i></div>`,
            equipped: pc.theme().id === x.id,
            equip: () => window.setSiteTheme(x.id),
            look: { bg: x.id },
        })),
        sounds: [{
            own: 'kit-classic', slot: 'sound', free: true, name: itemName('kit-classic'),
            preview: `<div class="shop-cosm shop-cosm--sound"><i class="fas fa-volume-low"></i><span class="shop-eq"><b></b><b></b><b></b><b></b><b></b></span></div>`,
            equipped: !Cosmetics.get('sound'), equip: () => Cosmetics.set('sound', null),
        }, ...slotIds(CAT_SLOTS.sounds).map(cosmItem)],
        effects: slotIds(CAT_SLOTS.effects).map(cosmItem),
        stream: slotIds(CAT_SLOTS.stream).map(cosmItem),
        profile: slotIds(CAT_SLOTS.profile).map(cosmItem),
        packs,
    };
}

/** Banc d'écoute (rayon Sons) : chaque son de chaque kit, possédé ou non */
const BENCH = ['move', 'capture', 'check', 'mate', 'tick', 'win', 'all'];
function bench(acc) {
    const eq = window.Cosmetics?.get('sound') || 'kit-classic';
    const kits = ['kit-classic', ...(window.SoundKit?.KITS || [])];
    const rows = kits.map(id => {
        const own = id === 'kit-classic' || !!window.unlockedRewards?.has?.(id);
        const tag = id === eq ? t('bench.equipped') : own ? t('bench.owned') : '';
        return `<tr${id === eq ? ' class="is-equipped"' : ''}><th scope="row"><b>${esc(itemName(id))}</b>${tag ? `<small>${esc(tag)}</small>` : ''}</th>${BENCH.map(k =>
            `<td><button type="button" class="shop-bench__play${k === 'all' ? ' shop-bench__play--all' : ''}" data-shop-bench="${esc(id)}" data-kind="${k}" title="${esc(itemName(id))} · ${esc(t(`bench.${k}`))}" aria-label="${esc(itemName(id))} · ${esc(t(`bench.${k}`))}"><i class="fas ${k === 'all' ? 'fa-forward' : 'fa-play'}" aria-hidden="true"></i></button></td>`).join('')}</tr>`;
    }).join('');
    return `<section class="shop-bench" id="shop-bench">
        <h3><i class="fas fa-headphones" aria-hidden="true"></i> ${esc(t('bench.title'))}</h3>
        <p>${esc(t('bench.desc'))}</p>
        <div class="shop-bench__wrap"><table class="shop-bench__table">
            <thead><tr><th></th>${BENCH.map(k => `<th scope="col">${esc(t(`bench.${k}`))}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
    </section>`;
}

/** Succès qui offre cet objet (objets jamais en vente) */
function rewardOf(own) {
    const def = window.achievements?.defs?.list?.find(d => d.reward === own);
    return def ? tr(`achievements.list.${def.id}.name`) : null;
}

const hasItem = (acc, id) => !!acc?.owned?.includes(id) || !!window.unlockedRewards?.has?.(id);
const priceOf = (id) => rules?.deal?.id === id ? rules.deal.price : rules?.catalog?.[id]?.price;

function itemState(item, acc) {
    const owned = item.free || (item.bundle ? item.bundle.every(i => hasItem(acc, i)) : hasItem(acc, item.own));
    const def = rules?.catalog?.[item.own] || {};
    const price = priceOf(item.own);
    if (owned) return { kind: item.equipped ? 'equipped' : 'owned' };
    if (price == null) return { kind: 'exclusive', reward: rewardOf(item.own), level: def.unlockLevel };
    if (def.level && (acc?.level || 1) < def.level) return { kind: 'level', price, level: def.level };
    if (!acc) return { kind: 'login', price };
    if (acc.coins < price) return { kind: 'poor', price, missing: price - acc.coins };
    return { kind: 'buy', price };
}

/** Ordre d'un rayon : gratuits, puis par emplacement et prix, objets de succès à la fin */
function sortItems(items) {
    const slots = Object.values(CAT_SLOTS).flat();
    const rank = it => it.free ? -1 : (rules?.catalog?.[it.own]?.price ?? 1e9);
    return [...items].sort((a, b) => (slots.indexOf(a.slot) - slots.indexOf(b.slot)) || rank(a) - rank(b));
}

const isOwned = st => st.kind === 'equipped' || st.kind === 'owned';
const passes = (st) => filter === 'all' || (filter === 'owned' ? isOwned(st) : ['buy', 'poor', 'login', 'level'].includes(st.kind));

/** Objet affiché dans la cabine pour un rayon : l'essai en cours, sinon l'objet équipé */
function shown(cat, items) {
    const list = items[cat] || [];
    return list.find(i => i.own === tried[cat]) || list.find(i => i.equipped) || list[0];
}
/** Cosmétique montré dans la cabine pour un emplacement : essayé, sinon équipé */
const shownSlot = (slot) => triedSlot[slot] !== undefined ? triedSlot[slot] : Cosmetics.get(slot);

const priceHtml = (st, id) => {
    const deal = rules?.deal?.id === id && rules.deal.base;
    return `${deal ? `<s>${fmtNum(deal)}</s> ` : ''}♟ ${fmtNum(st.price)}`;
};

function tile(item, acc) {
    const st = itemState(item, acc);
    const sel = shown(tab, catalogCache)?.own === item.own;
    let badge;
    switch (st.kind) {
        case 'equipped': badge = `<span class="shop-tile__badge is-on"><i class="fas fa-check"></i></span>`; break;
        case 'owned': badge = `<span class="shop-tile__meta">${esc(item.free ? t('free') : t('owned'))}</span>`; break;
        case 'exclusive': badge = `<span class="shop-tile__meta is-excl"><i class="fas fa-medal"></i> ${esc(st.level ? t('levelShort', { n: st.level }) : t('exclusiveShort'))}</span>`; break;
        case 'level': badge = `<span class="shop-tile__meta is-level"><i class="fas fa-lock"></i> ${esc(t('levelShort', { n: st.level }))}</span>`; break;
        default: badge = `<span class="shop-tile__price${st.kind === 'poor' ? ' is-poor' : ''}">${priceHtml(st, item.own)}</span>`;
    }
    const deal = rules?.deal?.id === item.own ? `<span class="shop-tile__deal">−25 %</span>` : '';
    return `<li><button type="button" class="shop-tile is-${st.kind}${sel ? ' is-selected' : ''}" data-shop-try="${esc(item.own)}" aria-pressed="${sel}">
        ${deal}<span class="shop-tile__preview">${item.preview}</span>
        <span class="shop-tile__name">${esc(item.name)}</span>
        ${badge}
    </button></li>`;
}

/** Bouton d'action de la cabine, pour l'objet sélectionné dans l'onglet */
function action(item, acc) {
    const st = itemState(item, acc);
    const listen = item.slot === 'sound' ? `<button class="btn btn--sm btn--ghost" data-shop-listen="${esc(item.own)}"><i class="fas fa-play"></i> ${esc(t('listen'))}</button>` : '';
    const demo = ['trail', 'capture', 'win'].includes(item.slot) ? `<button class="btn btn--sm btn--ghost" data-shop-demo="${esc(item.own)}"><i class="fas fa-play"></i> ${esc(t('preview'))}</button>` : '';
    const extra = listen + demo;
    switch (st.kind) {
        case 'equipped':
            return `${extra}<span class="shop-tag shop-tag--on"><i class="fas fa-check"></i> ${esc(t('equipped'))}</span>${item.unequip ? `<button class="btn btn--sm btn--ghost" data-shop-unequip="${esc(item.own)}">${esc(t('unequip'))}</button>` : ''}`;
        case 'owned':
            return item.bundle ? `<span class="shop-tag shop-tag--on"><i class="fas fa-check"></i> ${esc(t('owned'))}</span>`
                : `${extra}<button class="btn btn--sm btn--primary" data-shop-equip="${esc(item.own)}">${esc(t('use'))}</button>`;
        case 'exclusive':
            return `${extra}<span class="shop-tag shop-tag--excl"><i class="fas fa-medal"></i> ${esc(st.level ? t('levelGift', { n: st.level }) : st.reward ? t('exclusiveHint', { name: st.reward }) : t('exclusiveShort'))}</span>`;
        case 'level':
            return `${extra}<span class="shop-price">${priceHtml(st, item.own)}</span><span class="shop-tag"><i class="fas fa-lock"></i> ${esc(t('levelNeed', { n: st.level }))}</span>`;
        case 'login':
            return `${extra}<button class="btn btn--sm btn--primary" data-shop-login><i class="fab fa-twitch"></i> ${esc(t('loginToBuy', { n: fmtNum(st.price) }))}</button>`;
        case 'poor':
            return `${extra}<span class="shop-price is-poor">${priceHtml(st, item.own)}</span><span class="shop-tag">${esc(t('missing', { n: fmtNum(st.missing) }))}</span>`;
        default: {
            const conf = confirming === item.own;
            const label = busy === item.own ? `<i class="fas fa-spinner fa-spin"></i>`
                : conf ? esc(t('confirm', { n: fmtNum(st.price) })) : `${esc(t('buy'))} · ♟ ${fmtNum(st.price)}`;
            return `${extra}<button class="btn btn--sm btn--primary${conf ? ' is-confirm' : ''}" data-shop-buy="${esc(item.own)}"${busy ? ' disabled' : ''}>${label}</button>`;
        }
    }
}

let catalogCache = {};

/** Démo de la cabine : traînée et prise Cf3xe5 sur l'échiquier de la cabine */
function demoOnFitting(trailId, capId) {
    const sq = document.querySelectorAll('.shop-fit__board > span');
    if (sq.length !== 64) return;
    window.BoardFx?.play({ fromRect: sq[DEMO.from].getBoundingClientRect(), toRect: sq[DEMO.to].getBoundingClientRect(), capture: true, trail: trailId, cap: capId });
}

/** Ligne « viewer » de la cabine (rayon Profil) : cadre, couleur, badge, envol */
function viewerSample() {
    const acc = window.economy?.account;
    const name = acc?.login || 'viewer';
    const color = ITEMS[shownSlot('color')]?.color;
    const frame = ITEMS[shownSlot('frame')]?.cls;
    const badge = ITEMS[shownSlot('badge')];
    const fly = ITEMS[shownSlot('fly')]?.cls || '';
    const pic = window.twitchAuth?.user?.profile_image_url;
    return `<div class="shop-fit__viewer">
        <span class="shop-avatar${frame ? ` look-frame ${frame}` : ''}">${pic ? `<img src="${esc(pic)}" alt="" referrerpolicy="no-referrer">` : `<i class="fas fa-user"></i>`}</span>
        <b${color ? ` style="color:${color}"` : ''}>${esc(name)}${badge ? ` <i class="fas ${badge.icon} look-badge" style="color:${badge.color}"></i>` : ''}</b>
        <span class="shop-flychip ${fly}">♟ +2</span>
    </div>`;
}

/** Cabine d'essayage : échiquier et tirage avec les objets essayés de chaque rayon */
function fitting(items, acc) {
    const set = shown('pieces', items)?.look.set;
    const board = shown('boards', items)?.look;
    const mat = shown('mats', items)?.look.mat || 'none';
    const colors = shown('palettes', items)?.look.colors || [];
    const bg = shown('themes', items)?.look.bg || 'dark';
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
    // Flèche du coup tiré (Cf3xe5, en L) et roue miniature : rayon Stream
    const arrow = ITEMS[shownSlot('arrow')];
    const arrowCol = arrow?.color || 'rgb(255, 138, 61)';
    const overlay = tab === 'stream'
        ? `<svg class="shop-fit__arrow" viewBox="0 0 8 8" aria-hidden="true"${arrow ? ` style="filter:drop-shadow(0 0 3px ${arrow.glow})"` : ''}><polyline points="5.5,5.2 5.5,4.5 4.5,4.5 4.5,3.95" fill="none" stroke="${arrowCol}" stroke-width=".2" stroke-linejoin="round" opacity=".9"/><path d="M4.18 3.95L4.5 3.45L4.82 3.95Z" fill="${arrowCol}" opacity=".9"/></svg>`
        : '';
    const wheel = tab === 'stream' ? `<span class="shop-wheel shop-wheel--fit" style="${wheelCss(ITEMS[shownSlot('wheel')] || WHEEL_DEFAULT)}"><i></i></span>` : '';
    const sel = shown(tab, items);
    const trying = Object.keys(tried).some(k => tried[k] && !(items[k] || []).find(i => i.own === tried[k])?.equipped);
    return `<aside class="shop-fit bg--${esc(bg)}">
        <div class="shop-fit__head"><span>${esc(t('fit.title'))}</span>${trying ? `<button type="button" class="shop-fit__reset" data-shop-reset><i class="fas fa-rotate-left"></i> ${esc(t('fit.reset'))}</button>` : ''}</div>
        <div class="shop-fit__boardwrap"><div class="shop-fit__board mat--${esc(mat)}" style="--sq-light:${board?.light};--sq-dark:${board?.dark}">${squares}</div>${overlay}${wheel}</div>
        <div class="shop-fit__draw" title="${esc(tr('palette.title'))}">${SHARES.map((w, i) => `<span style="flex:${w};background:${colors[i] || '#555'}"></span>`).join('')}</div>
        ${tab === 'profile' ? viewerSample() : ''}
        ${sel ? `<div class="shop-fit__item">
            <div class="shop-fit__name"><small>${esc(t(`tab.${tab}`))}</small><b>${esc(sel.name)}</b>${sel.bundle ? `<small>${esc(sel.bundle.map(itemName).join(' · '))}</small>` : ''}${sel.slot && !sel.free ? `<small>${esc(t(`slot.${sel.slot}`))}</small>` : ''}</div>
            <div class="shop-fit__action">${action(sel, acc)}</div>
        </div>` : ''}
        <p class="shop-fit__hint">${esc(t(CAT_SLOTS[tab] && tab !== 'profile' && tab !== 'stream' ? 'fit.hintFx' : 'fit.hint'))}</p>
    </aside>`;
}

function wallet(acc) {
    const r = rules?.rules;
    const earn = r ? [
        t('earn.turn', { n: r.turn.coins, cap: fmtNum(r.dailyCoinCap) }),
        t('earn.daily', { n: r.daily.coins, bonus: r.daily.streakBonus, max: r.daily.coins + r.daily.streakBonus * r.daily.streakMax }),
        t('earn.rush', { n: r.rushRun.coinsPerPoint, rec: r.rushRecord.coins }),
        t('earn.multi', { win: r.multi.win.coins, draw: r.multi.draw.coins, loss: r.multi.loss.coins }),
        ...(r.predict ? [t('earn.predict', { n: r.predict.move.coins, w: r.predict.winner.coins, s: r.predict.streak.coins, every: r.predict.streak.every })] : []),
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

/** Bandeau de la vitrine de la semaine (un objet à −25 %) */
function dealBanner(items) {
    const d = rules?.deal;
    if (!d) return '';
    let cat = null, it = null;
    for (const c of CATS) { it = (items[c.key] || []).find(i => i.own === d.id); if (it) { cat = c.key; break; } }
    if (!it) return '';
    const until = new Date(d.until).toLocaleDateString(window.i18n?.currentLang || 'fr', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<button type="button" class="shop-deal" data-shop-goto="${esc(d.id)}" data-shop-cat="${cat}">
        <span class="shop-deal__icon"><i class="fas fa-tag"></i></span>
        <span class="shop-deal__text"><small>${esc(t('deal.title'))}</small><b>${esc(it.name)}</b><small>${esc(t('deal.until', { date: until }))}</small></span>
        <span class="shop-deal__price"><s>♟ ${fmtNum(d.base)}</s><b>♟ ${fmtNum(d.price)}</b></span>
    </button>`;
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
        let toBench = false;
        try {
            toBench = sessionStorage.getItem('shopBench') === '1';
            if (toBench) { sessionStorage.removeItem('shopBench'); tab = 'sounds'; filter = 'all'; remember('shopTab', tab); }
        } catch (e) { }
        this.render();
        if (toBench) requestAnimationFrame(() => document.getElementById('shop-bench')?.scrollIntoView({ block: 'center' }));
    },

    /** Essayer un objet : cabine, et démo (son, effet) pour les cosmétiques */
    tryItem(id, play = true) {
        tried[tab] = id;
        const it = ITEMS[id];
        if (it) triedSlot[it.slot] = id;
        if (id === 'kit-classic') triedSlot.sound = null;
        if (confirming !== id) confirming = null;
        this.render();
        if (play) this.demo(id);
    },

    demo(id) {
        const it = ITEMS[id];
        if (id === 'kit-classic') return window.SoundKit?.demo(id);
        if (!it) return;
        if (it.slot === 'sound') window.SoundKit?.demo(id);
        else if (it.slot === 'trail') demoOnFitting(id, shownSlot('capture'));
        else if (it.slot === 'capture') demoOnFitting(shownSlot('trail'), id);
        else if (it.slot === 'win') window.BoardFx?.victory(id);
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
            const go = e.target.closest('[data-shop-goto]');
            if (go) { tab = go.dataset.shopCat; remember('shopTab', tab); filter = 'all'; return this.tryItem(go.dataset.shopGoto, false); }
            const tryBtn = e.target.closest('[data-shop-try]');
            if (tryBtn) return this.tryItem(tryBtn.dataset.shopTry);
            const bn = e.target.closest('[data-shop-bench]');
            if (bn) {
                const kit = bn.dataset.shopBench, kind = bn.dataset.kind;
                return kind === 'all' ? window.SoundKit?.demo(kit) : window.SoundKit?.test(kit, kind);
            }
            const ls = e.target.closest('[data-shop-listen],[data-shop-demo]');
            if (ls) return this.demo(ls.dataset.shopListen || ls.dataset.shopDemo);
            if (e.target.closest('[data-shop-reset]')) {
                for (const k of Object.keys(tried)) tried[k] = null;
                for (const k of Object.keys(triedSlot)) delete triedSlot[k];
                confirming = null;
                return this.render();
            }
            const eq = e.target.closest('[data-shop-equip],[data-shop-unequip]');
            if (eq) {
                const off = !!eq.dataset.shopUnequip;
                const it = this.find(eq.dataset.shopEquip || eq.dataset.shopUnequip);
                try { await (off ? it?.unequip?.() : it?.equip()); }
                catch { window.AppToast?.show(esc(t('errEquip')), 'error', 4000); }
                if (it) { tried[it.cat] = null; if (it.slot) delete triedSlot[it.slot]; }
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
                try { await item?.equip(); } catch { }
                if (item) { tried[item.cat] = null; if (item.slot) delete triedSlot[item.slot]; }
                window.AppToast?.show(esc(t('bought', { name: item?.name || id })), 'success', 4000);
            } catch (err) {
                busy = null;
                window.AppToast?.show(esc(err.status === 402 ? t('errPoor') : err.data?.level ? t('levelNeed', { n: err.data.level }) : t('errBuy')), 'error', 4000);
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
        // Rayon ouvert d'abord : un même id peut exister dans deux rayons (thème « blue » et échiquier « blue »)
        for (const cat of [tab, ...Object.keys(items).filter(k => k !== tab)]) {
            if (!items[cat]) continue;
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
                ${dealBanner(items)}
                <div class="shop-tabs" role="tablist">${tabs}</div>
                <div class="shop-sub">
                    <p>${esc(t(`catDesc.${tab}`))}</p>
                    <div class="shop-filters">${filters}</div>
                </div>
                ${visible.length
                    ? `<ul class="shop-grid" role="tabpanel">${visible.map(it => tile(it, acc)).join('')}</ul>`
                    : `<p class="shop-empty">${esc(t('empty'))}</p>`}
                ${tab === 'sounds' ? bench(acc) : ''}
            </div>
        </div>`;
    },
};

const isActive = () => document.getElementById('page-shop')?.classList.contains('is-active');
const rerender = () => { if (isActive()) ShopPage.render(); };
for (const ev of ['economyChanged', 'languageChanged', 'pieceSetChanged', 'boardThemeChanged', 'boardMatChanged', 'twitchAuthChange', 'cosmeticsChanged']) {
    window.addEventListener(ev, rerender);
}
document.addEventListener('votePaletteChanged', rerender);
window.addEventListener('shopBench', () => { if (isActive()) ShopPage.init(); });   // lien du menu, déjà sur la boutique

export default ShopPage;
