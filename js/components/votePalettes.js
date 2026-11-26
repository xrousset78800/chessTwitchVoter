/**
 * Jeux de couleurs du tirage (roue, bande, podium des votes).
 * La couleur n°1 va au coup en tête, la n°2 au deuxième, etc.
 * Choisi par le streamer, transmis aux spectateurs.
 */
export const PALETTES = {
    violet: ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16', '#a855f7'],
    twitch: ['#9146ff', '#bf94ff', '#5c16c5', '#a970ff', '#772ce8', '#d1b3ff', '#451093', '#c9a4ff', '#6b21d8', '#e0ccff', '#3b0c7a', '#b07cff'],
    // Teintes sombres, discrètes à l'écran
    night:  ['#5b21b6', '#1e40af', '#0f766e', '#9a3412', '#9d174d', '#3f6212', '#3730a3', '#155e75', '#92400e', '#6b21a8', '#166534', '#9f1239'],
    fire:   ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#dc2626', '#ea580c', '#d97706', '#b91c1c', '#fb923c', '#facc15', '#c2410c', '#991b1b'],
    ocean:  ['#0ea5e9', '#14b8a6', '#6366f1', '#06b6d4', '#3b82f6', '#2dd4bf', '#0284c7', '#22d3ee', '#4f46e5', '#0d9488', '#38bdf8', '#1d4ed8'],
    // Neutres : gris colorés, pour un overlay sobre
    muted:  ['#7c8b9e', '#a3967f', '#6b8f7a', '#9a7f8f', '#8a8f6b', '#5f6f8a', '#b0a48a', '#7a9a95', '#8d7a6b', '#6b6f80', '#a08a9a', '#7f8c7a'],
    // Okabe-Ito : se distingue aussi avec un daltonisme
    access: ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#9ca3af', '#b45309', '#1e40af', '#047857', '#be185d'],
    // Boutique (objets « pal-<id> », economy.js) : choisis seulement une fois achetés
    sunset:  ['#ff6b6b', '#ff9f43', '#feca57', '#ff6fa8', '#c56cf0', '#ff7f50', '#f368e0', '#ffb142', '#e84393', '#fd9644', '#a55eea', '#ff5252'],
    woods:   ['#6a8f3a', '#a0743c', '#3f7d5a', '#c49a52', '#556b2f', '#8b5a2b', '#7fa36b', '#b5835a', '#2e5e4e', '#d2a679', '#4b6e3a', '#9c6b3f'],
    candy:   ['#ff8fab', '#a0e7e5', '#b4f8c8', '#fbe7c6', '#cdb4db', '#ffc8dd', '#bde0fe', '#ffafcc', '#caffbf', '#fdffb6', '#9bf6ff', '#ffd6a5'],
    mono:    ['#f5f5f5', '#d4d4d4', '#a3a3a3', '#737373', '#525252', '#e5e5e5', '#bdbdbd', '#8c8c8c', '#666666', '#cfcfcf', '#999999', '#404040'],
    rainbow: ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d92', '#30d158', '#64d2ff', '#ff9f0a'],
    gold:    ['#ffd700', '#f5c542', '#e6b422', '#ffdf6e', '#d4a017', '#fff0a5', '#c9a227', '#ffcc33', '#b8860b', '#f0d58c', '#daa520', '#ffe680'],
};

export const PALETTE_IDS = Object.keys(PALETTES);
export const FREE_PALETTES = ['violet', 'twitch', 'night', 'fire', 'ocean', 'muted', 'access'];
const DEFAULT = 'violet';

export function isPalette(id) {
    return Object.prototype.hasOwnProperty.call(PALETTES, id);
}

/** Palette utilisable par le streamer : gratuite, ou achetée à la boutique */
export function paletteAvailable(id) {
    return isPalette(id) && (FREE_PALETTES.includes(id) || !!window.unlockedRewards?.has?.(`pal-${id}`));
}

export function getPaletteId() {
    try {
        const id = localStorage.getItem('votePalette');
        return paletteAvailable(id) ? id : DEFAULT;
    } catch {
        return DEFAULT;
    }
}

export function paletteColors(id = getPaletteId()) {
    return PALETTES[isPalette(id) ? id : DEFAULT];
}

export function setPaletteId(id) {
    if (!paletteAvailable(id)) return;
    try { localStorage.setItem('votePalette', id); } catch {}
    document.dispatchEvent(new CustomEvent('votePaletteChanged', { detail: { id } }));
}

// Objets du compte chargés ou changés : la palette enregistrée redevient (ou cesse d'être) utilisable
window.addEventListener('economyChanged', () => {
    document.dispatchEvent(new CustomEvent('votePaletteChanged', { detail: { id: getPaletteId() } }));
});
