/**
 * Apparence publique des viewers (achats du magasin vus par les autres) : couleur du pseudo,
 * cadre d'avatar, badge. Lue en lot sur GET /api/economy/looks?l=a,b,c et gardée 5 min.
 *
 * Les composants n'ont qu'à marquer leur HTML :
 *   data-look-name="login" → couleur du pseudo + badge à la suite du nom
 *   data-look-pic="login"  → cadre autour de l'avatar
 * Un observateur décore tout élément marqué ajouté à la page (listes de votants, crédits, bilans…).
 */
import { ITEMS } from './cosmetics.js';

const TTL = 5 * 60e3;
const cache = new Map();        // login → { look, at }
const queue = new Set();
let timer = null;

const norm = (l) => String(l || '').toLowerCase().trim();
const valid = (l) => /^[a-z0-9_]{2,25}$/.test(l);

function fresh(login) {
    const c = cache.get(login);
    return c && Date.now() - c.at < TTL ? c : null;
}

function want(login) {
    if (!valid(login) || fresh(login) || queue.has(login)) return;
    queue.add(login);
    clearTimeout(timer);
    timer = setTimeout(flush, 150);
}

async function flush() {
    const batch = [...queue].slice(0, 100);
    batch.forEach(l => queue.delete(l));
    if (queue.size) timer = setTimeout(flush, 150);
    if (!batch.length) return;
    batch.forEach(l => cache.set(l, { look: cache.get(l)?.look || null, at: Date.now() }));   // pas de double demande
    try {
        const r = await fetch(`/api/economy/looks?l=${encodeURIComponent(batch.join(','))}`);
        if (!r.ok) return;
        const data = await r.json();
        const changed = [];
        for (const l of batch) {
            const look = data[l] || null;
            if (JSON.stringify(look) !== JSON.stringify(cache.get(l)?.look)) changed.push(l);
            cache.set(l, { look, at: Date.now() });
        }
        if (changed.length) redecorate(changed);
    } catch { }
}

function lookOf(login) {
    const me = window.economy?.account;
    if (me && me.login === login) return me.look || null;
    want(login);
    return cache.get(login)?.look || null;
}

const FRAME_CLASSES = Object.values(ITEMS).filter(x => x.slot === 'frame').map(x => x.cls);

function decorate(el) {
    const n = el.dataset.lookName;
    if (n != null) {
        const login = norm(n), look = lookOf(login);
        const color = look?.color && ITEMS[look.color]?.color;
        if (color) { el.style.color = color; el.dataset.lookColored = '1'; }
        else if (el.dataset.lookColored) { el.style.color = el.dataset.lookBase || ''; delete el.dataset.lookColored; }
        const badge = look?.badge && ITEMS[look.badge];
        let b = el.querySelector(':scope > .look-badge');
        if (badge) {
            if (!b) { b = document.createElement('i'); el.appendChild(b); }
            b.className = `fas ${badge.icon} look-badge`;
            b.style.color = badge.color;
            b.setAttribute('aria-hidden', 'true');
        } else b?.remove();
    }
    const p = el.dataset.lookPic;
    if (p != null) {
        const look = lookOf(norm(p));
        const cls = look?.frame && ITEMS[look.frame]?.cls;
        el.classList.remove('look-frame', ...FRAME_CLASSES);
        if (cls) el.classList.add('look-frame', cls);
    }
}

function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches('[data-look-name],[data-look-pic]')) {
        if (root.dataset.lookName != null && root.dataset.lookBase == null) root.dataset.lookBase = root.style.color || '';
        decorate(root);
    }
    root.querySelectorAll('[data-look-name],[data-look-pic]').forEach(el => {
        if (el.dataset.lookName != null && el.dataset.lookBase == null) el.dataset.lookBase = el.style.color || '';
        decorate(el);
    });
}

function redecorate(logins) {
    const set = logins ? new Set(logins) : null;
    document.querySelectorAll('[data-look-name],[data-look-pic]').forEach(el => {
        const l = norm(el.dataset.lookName ?? el.dataset.lookPic);
        if (!set || set.has(l)) decorate(el);
    });
}

const pending = new Set();
let raf = 0;
const obs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
    if (pending.size && !raf) raf = requestAnimationFrame(() => {
        raf = 0;
        const nodes = [...pending];
        pending.clear();
        for (const n of nodes) if (n.isConnected) scan(n);
    });
});
const start = () => { obs.observe(document.body, { childList: true, subtree: true }); scan(document.body); };
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

window.addEventListener('economyChanged', () => {
    const me = window.economy?.account?.login;
    if (me) redecorate([me]);
});

const Looks = {
    get: (login) => lookOf(norm(login)),
    forget: (login) => cache.delete(norm(login)),
    redecorate,
    /** Couleur du pseudo achetée (sinon null), pour les composants qui dessinent eux-mêmes */
    color: (login) => { const c = lookOf(norm(login))?.color; return c ? ITEMS[c]?.color || null : null; },
};
window.Looks = Looks;
export default Looks;
