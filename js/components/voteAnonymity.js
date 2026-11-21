/**
 * Anonymat du vote, choisi par le streamer (réglage d'affichage, modifiable en pleine partie) :
 * - none   : pseudos et votes affichés en direct
 * - names  : votes visibles, pseudos des viewers masqués
 * - secret : ni pseudos ni votes pendant le tour (pas de podium, de flèche ni de coups colorés) ;
 *            on découvre les votes au tirage, ou le score du coup une fois joué
 * Les spectateurs reçoivent les votes déjà masqués.
 */
export const ANON_MODES = ['none', 'names', 'secret'];
const KEY = 'voteAnonymity';
const ICONS = { none: 'fa-eye', names: 'fa-user-secret', secret: 'fa-eye-slash' };

const t = (key, fallback) => {
    const s = window.i18n?.t(key);
    return s && s !== key ? s : fallback;
};
const FALLBACK = {
    none: 'Visible', names: 'Pseudos cachés', secret: 'Vote secret',
    hintNone: 'Pseudos et votes affichés en direct.',
    hintNames: 'Les votes restent visibles, sans les pseudos des viewers.',
    hintSecret: 'Ni pseudos ni votes pendant le tour : le résultat se découvre au tirage ou quand le coup est joué.'
};

// Partie Multi : le créateur fixe l'anonymat, les deux chaînes le suivent (sans toucher à leur propre choix)
let forced = null;

export function getAnonymity() {
    if (forced) return forced;
    try {
        const m = localStorage.getItem(KEY);
        return ANON_MODES.includes(m) ? m : 'none';
    } catch {
        return 'none';
    }
}

/** Pseudos des votants masqués (pseudos cachés ou vote secret) */
export const hideVoterNames = () => getAnonymity() !== 'none';
/** Votes masqués pendant le tour */
export const secretVotes = () => getAnonymity() === 'secret';

/** null : chacun son réglage ; sinon réglage imposé par le créateur de la partie Multi */
export function forceAnonymity(mode) {
    const next = ANON_MODES.includes(mode) ? mode : null;
    if (next === forced) return;
    const before = getAnonymity();
    forced = next;
    syncBodyClass();
    renderAnonPickers();
    if (getAnonymity() !== before) {
        document.dispatchEvent(new CustomEvent('voteAnonymityChanged', { detail: { mode: getAnonymity() } }));
    }
}

export function setAnonymity(mode) {
    if (!ANON_MODES.includes(mode) || forced) return;
    try { localStorage.setItem(KEY, mode); } catch {}
    syncBodyClass();
    renderAnonPickers();
    document.dispatchEvent(new CustomEvent('voteAnonymityChanged', { detail: { mode } }));
}

function syncBodyClass() {
    const m = getAnonymity();
    document.body?.classList.toggle('vote-anon-names', m !== 'none');
    document.body?.classList.toggle('vote-secret', m === 'secret');
}

/** Sélecteurs [data-anon-picker] (réglages avant la partie et modale ⚙) */
export function renderAnonPickers() {
    const current = getAnonymity();
    const lock = forced ? ' disabled' : '';
    document.querySelectorAll('[data-anon-picker]').forEach(el => {
        el.classList.toggle('is-locked', !!forced);
        el.innerHTML = `<div class="anon-picker__options" role="radiogroup">${ANON_MODES.map(m => `
            <button type="button" class="anon-picker__option${m === current ? ' is-active' : ''}" role="radio" aria-checked="${m === current}" data-anon="${m}"${lock}>
                <i class="fas ${ICONS[m]}"></i> <span>${t(`anonymity.${m}`, FALLBACK[m])}</span>
            </button>`).join('')}</div>
            <p class="form-hint anon-picker__hint">${forced ? '<i class="fas fa-lock"></i> ' + t('anonymity.forced', 'Fixé par le créateur de la partie Multi.') + ' ' : ''}${t(`anonymity.hint${m2k(current)}`, FALLBACK[`hint${m2k(current)}`])}</p>`;
    });
}
const m2k = m => m.charAt(0).toUpperCase() + m.slice(1);

export function initAnonymity() {
    syncBodyClass();
    renderAnonPickers();
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-anon-picker] [data-anon]');
        if (btn) setAnonymity(btn.dataset.anon);
    });
    window.addEventListener('languageChanged', renderAnonPickers);
}
