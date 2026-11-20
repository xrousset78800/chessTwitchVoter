/**
 * Petites bulles d'aide ⓘ à côté des options.
 *
 * Dans le HTML : data-info="clé" sur le libellé d'une option (clé sous tips.* dans lang/*.json).
 * Un bouton ⓘ est ajouté à côté du libellé ; sa bulle s'ouvre au survol, au focus
 * clavier ou au toucher, et reste dans l'écran (position fixe, recalée aux bords).
 */
const tip = (key) => window.i18n?.t(`tips.${key}`) ?? key;

let pop = null;
let current = null;

function popover() {
    if (!pop) {
        pop = document.createElement('div');
        pop.className = 'info-pop';
        pop.id = 'info-tip-pop';
        pop.setAttribute('role', 'tooltip');
        document.body.appendChild(pop);
    }
    return pop;
}

function show(btn) {
    const el = popover();
    current = btn;
    el.textContent = tip(btn.dataset.tip);
    el.classList.add('is-visible');
    btn.setAttribute('aria-describedby', el.id);
    btn.setAttribute('aria-expanded', 'true');

    // Au-dessus du bouton si la place le permet, sinon en dessous ; jamais hors de l'écran
    const r = btn.getBoundingClientRect();
    const margin = 8;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    let top = r.top - h - 8;
    const below = top < margin;
    if (below) top = r.bottom + 8;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.classList.toggle('is-below', below);
    el.style.setProperty('--arrow-x', `${Math.round(r.left + r.width / 2 - left)}px`);
}

function hide() {
    if (!current) return;
    current.removeAttribute('aria-describedby');
    current.setAttribute('aria-expanded', 'false');
    current = null;
    pop?.classList.remove('is-visible');
}

function makeButton(key) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'info-tip';
    btn.dataset.tip = key;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Info');
    btn.textContent = 'i';
    return btn;
}

/** Ajoute les boutons ⓘ (idempotent : peut être rappelé après un ajout au DOM) */
export function attachInfoTips(root = document) {
    root.querySelectorAll('[data-info]').forEach(el => {
        if (el.dataset.infoReady) return;
        el.dataset.infoReady = '1';
        const btn = makeButton(el.dataset.info);
        if (el.hasAttribute('data-i18n')) {
            // La traduction remplace le texte de l'élément : le bouton va à côté, dans un même bloc
            const wrap = document.createElement('span');
            wrap.className = 'info-label';
            el.replaceWith(wrap);
            wrap.append(el, btn);
        } else {
            el.append(' ', btn);
        }
    });
}

function refreshLabels() {
    if (current) show(current);
}

function setup() {
    attachInfoTips();
    document.addEventListener('mouseover', (e) => {
        const btn = e.target.closest?.('.info-tip');
        if (btn && btn !== current) show(btn);
    });
    document.addEventListener('mouseout', (e) => {
        const btn = e.target.closest?.('.info-tip');
        if (btn && btn === current && !btn.contains(e.relatedTarget) && document.activeElement !== btn) hide();
    });
    document.addEventListener('focusin', (e) => {
        if (e.target.classList?.contains('info-tip')) show(e.target);
    });
    document.addEventListener('focusout', (e) => {
        if (e.target === current) hide();
    });
    // Toucher / clic : ouvre ou ferme, sans activer l'option ou la tuile autour
    document.addEventListener('click', (e) => {
        const btn = e.target.closest?.('.info-tip');
        if (!btn) { hide(); return; }
        e.preventDefault();
        e.stopPropagation();
        show(btn);
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('languageChanged', refreshLabels);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
else setup();

window.attachInfoTips = attachInfoTips;
