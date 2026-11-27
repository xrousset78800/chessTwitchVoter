/**
 * Effets du magasin sur l'échiquier : traînée du coup joué, effet de prise, animation de victoire.
 * Calque fixe posé au-dessus de la page (pas de clic), animations Web Animations, rien à nettoyer.
 *   BoardFx.move({ from, to, capture })            → cases « e2 », « e4 » de l'échiquier visible
 *   BoardFx.play({ fromRect, toRect, capture, trail, cap })  → rectangles écran (aperçu du magasin)
 *   BoardFx.victory(id?)                           → animation de victoire équipée (ou id), + fanfare du kit de sons
 */
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const item = (slot, id) => {
    const I = window.Cosmetics?.ITEMS || {};
    const x = id || window.Cosmetics?.get(slot);
    return x && I[x] ? { id: x, ...I[x] } : null;
};

let layer = null;
function getLayer() {
    if (layer?.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'board-fx';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9000;overflow:hidden;';
    document.body.appendChild(layer);
    return layer;
}

function dot(x, y, size, css = '') {
    const d = document.createElement('i');
    d.style.cssText = `position:absolute;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;${css}`;
    getLayer().appendChild(d);
    return d;
}
const anim = (el, frames, opts) => {
    const a = el.animate(frames, { fill: 'forwards', ...opts });
    a.onfinish = () => el.remove();
    return a;
};
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.width });

/** Traînée : particules semées le long du trajet, de la case de départ vers l'arrivée */
function trail(fromRect, toRect, it) {
    const a = center(fromRect), b = center(toRect), s = a.s;
    const n = Math.max(8, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (s * 0.18)));
    for (let i = 0; i <= n; i++) {
        const k = i / n, x = a.x + (b.x - a.x) * k + rnd(-s * 0.06, s * 0.06), y = a.y + (b.y - a.y) * k + rnd(-s * 0.06, s * 0.06);
        const c = pick(it.colors), delay = k * 180;
        if (it.stars) {
            const st = dot(x, y, s * 0.22, `color:${c};font-size:${s * 0.22}px;line-height:1;text-align:center;text-shadow:0 0 6px ${c};`);
            st.textContent = '✦';
            anim(st, [{ opacity: 0, transform: 'scale(.2) rotate(0deg)' }, { opacity: 1, transform: 'scale(1.1) rotate(90deg)', offset: 0.3 }, { opacity: 0, transform: 'scale(.4) rotate(180deg)' }], { duration: 750, delay, easing: 'ease-out' });
        } else if (it.id === 'trail-ink') {
            const sz = s * rnd(0.12, 0.22);
            const d = dot(x, y, sz, `border-radius:50%;background:${c};opacity:.85;`);
            anim(d, [{ opacity: 0.85, transform: 'scale(.4)' }, { opacity: 0.6, transform: 'scale(1.3)', offset: 0.4 }, { opacity: 0, transform: 'scale(1.8)' }], { duration: 900, delay, easing: 'ease-out' });
        } else {
            const sz = s * rnd(0.08, 0.15);
            const d = dot(x, y, sz, `border-radius:50%;background:${c};box-shadow:0 0 ${sz}px ${c};`);
            anim(d, [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: `translateY(${-s * rnd(0.2, 0.5)}px) scale(.3)` }], { duration: rnd(500, 800), delay, easing: 'ease-out' });
        }
    }
}

/** Prise : éclats, poussière ou onde de choc sur la case d'arrivée */
function capture(rect, it) {
    const { x, y, s } = center(rect);
    if (it.id === 'cap-shock') {
        const ring = dot(x, y, s, `border-radius:50%;border:${Math.max(2, s * 0.06)}px solid ${it.colors[0]};box-shadow:0 0 ${s * 0.3}px ${it.colors[1]};`);
        anim(ring, [{ opacity: 1, transform: 'scale(.2)' }, { opacity: 0, transform: 'scale(2.4)' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.3,1)' });
        const flash = dot(x, y, s * 0.9, `border-radius:50%;background:radial-gradient(circle, ${it.colors[2]} 0%, ${it.colors[1]} 35%, transparent 70%);`);
        anim(flash, [{ opacity: 1, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 380, easing: 'ease-out' });
    }
    const n = it.id === 'cap-dust' ? 16 : it.id === 'cap-shock' ? 10 : 12;
    for (let i = 0; i < n; i++) {
        const ang = rnd(0, Math.PI * 2), dist = s * (it.id === 'cap-dust' ? rnd(0.3, 0.7) : rnd(0.5, 1.1));
        const c = pick(it.colors);
        let d;
        if (it.id === 'cap-shards') {
            const w = s * rnd(0.06, 0.12);
            d = dot(x, y, w, `background:${c};clip-path:polygon(50% 0,100% 60%,30% 100%);box-shadow:0 0 4px ${c};`);
        } else {
            const w = s * (it.id === 'cap-dust' ? rnd(0.1, 0.2) : rnd(0.05, 0.09));
            d = dot(x, y, w, `border-radius:50%;background:${c};${it.id === 'cap-dust' ? 'filter:blur(1px);' : `box-shadow:0 0 6px ${c};`}`);
        }
        const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist + (it.id === 'cap-shards' ? s * 0.3 : 0);
        anim(d, [{ opacity: 1, transform: 'translate(0,0) rotate(0deg) scale(1)' },
        { opacity: 0, transform: `translate(${dx}px,${dy}px) rotate(${rnd(-360, 360)}deg) scale(${it.id === 'cap-dust' ? 2 : 0.6})` }],
            { duration: it.id === 'cap-dust' ? rnd(700, 1000) : rnd(450, 700), easing: 'cubic-bezier(.15,.7,.3,1)' });
    }
}

/** Échiquier visible qui contient la case (plusieurs échiquiers peuvent exister dans la page) */
function squareRect(sq, root) {
    const scope = root || document;
    for (const el of scope.querySelectorAll(`.square-${sq}`)) {
        const r = el.getBoundingClientRect();
        if (r.width > 8 && el.offsetParent !== null) return r;
    }
    return null;
}

/** Victoire : pluie de pions, couronne ou feu d'artifice */
function victory(id) {
    const L = getLayer(), W = innerWidth, H = innerHeight;
    if (id === 'win-pawns') {
        for (let i = 0; i < 46; i++) {
            const p = dot(rnd(0, W), -40, 34, `font-size:${rnd(22, 40)}px;line-height:1;color:${pick(['#ff8a3d', '#ffd35c', '#f4eee8'])};text-shadow:0 2px 6px rgba(0,0,0,.4);`);
            p.textContent = '♟';
            anim(p, [{ transform: 'translateY(0) rotate(0deg)', opacity: 1 }, { transform: `translateY(${H + 80}px) rotate(${rnd(-540, 540)}deg)`, opacity: 0.9 }],
                { duration: rnd(1600, 2600), delay: rnd(0, 900), easing: 'cubic-bezier(.4,.1,.8,.6)' });
        }
    } else if (id === 'win-crown') {
        const s = Math.min(W, H) * 0.32;
        const rays = dot(W / 2, H / 2, s * 2.4, `border-radius:50%;background:repeating-conic-gradient(rgba(255,211,92,.35) 0 8deg, transparent 8deg 20deg);mask:radial-gradient(circle, #000 30%, transparent 70%);-webkit-mask:radial-gradient(circle, #000 30%, transparent 70%);`);
        anim(rays, [{ opacity: 0, transform: 'scale(.3) rotate(0deg)' }, { opacity: 1, transform: 'scale(1) rotate(40deg)', offset: 0.3 }, { opacity: 0, transform: 'scale(1.2) rotate(120deg)' }], { duration: 2400, easing: 'ease-out' });
        const c = dot(W / 2, H / 2, s, `font-size:${s}px;line-height:1;text-align:center;color:#ffd35c;filter:drop-shadow(0 0 ${s * 0.12}px rgba(255,211,92,.8));`);
        c.innerHTML = '<span class="fas fa-crown"></span>';
        anim(c, [{ opacity: 0, transform: `translateY(${-H * 0.5}px) scale(.6)` }, { opacity: 1, transform: 'translateY(0) scale(1.1)', offset: 0.35 }, { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.75 }, { opacity: 0, transform: 'translateY(0) scale(1.3)' }],
            { duration: 2400, easing: 'cubic-bezier(.2,.8,.3,1)' });
    } else if (id === 'win-fireworks') {
        for (let b = 0; b < 6; b++) {
            const cx = rnd(W * 0.15, W * 0.85), cy = rnd(H * 0.15, H * 0.55), delay = b * 280 + rnd(0, 120);
            const col = pick([['#ff8a3d', '#ffd35c'], ['#5ec8ff', '#ffffff'], ['#ff7eb6', '#b48cff'], ['#ffd35c', '#ffffff']]);
            for (let i = 0; i < 26; i++) {
                const ang = (i / 26) * Math.PI * 2, dist = rnd(70, 140);
                const d = dot(cx, cy, 6, `border-radius:50%;background:${pick(col)};box-shadow:0 0 8px ${col[0]};`);
                anim(d, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist + 40}px) scale(.3)`, opacity: 0 }],
                    { duration: rnd(900, 1300), delay, easing: 'cubic-bezier(.1,.7,.3,1)' });
            }
        }
    }
    return L;
}

const BoardFx = {
    move({ from, to, capture: isCapture, root } = {}) {
        if (reduced() || !from || !to) return;
        const tr = item('trail'), cp = isCapture ? item('capture') : null;
        if (!tr && !cp) return;
        const a = squareRect(from, root), b = squareRect(to, root);
        if (!b) return;
        if (tr && a) trail(a, b, tr);
        if (cp) setTimeout(() => capture(b, cp), tr ? 160 : 0);
    },
    play({ fromRect, toRect, capture: isCapture, trail: trailId, cap: capId }) {
        if (reduced()) return;
        const tr = trailId ? item('trail', trailId) : null, cp = isCapture && capId ? item('capture', capId) : null;
        if (tr && fromRect) trail(fromRect, toRect, tr);
        if (cp) setTimeout(() => capture(toRect, cp), tr ? 160 : 0);
    },
    victory(id) {
        const w = id || window.Cosmetics?.get('win');
        window.SoundKit?.win(0.8);
        if (w && !reduced()) victory(w);
    },
};

window.BoardFx = BoardFx;
export default BoardFx;
