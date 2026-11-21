/**
 * Jeux de couleurs du tirage (roue, bande, podium des votes).
 * La couleur n°1 va au coup en tête, la n°2 au deuxième, etc.
 * Choisi par le streamer, transmis aux spectateurs.
 */
export const PALETTES = {
    violet: ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16', '#a855f7'],
    twitch: ['#9146ff', '#bf94ff', '#5c16c5', '#a970ff', '#772ce8', '#d1b3ff', '#451093', '#c9a4ff', '#6b21d8', '#e0ccff', '#3b0c7a', '#b07cff'],
    neon:   ['#ff2bd6', '#00d9ff', '#9dff00', '#ffe600', '#ff6b00', '#7c4dff', '#00ffa3', '#ff3d5a', '#00b3ff', '#d4ff00', '#ff00a8', '#3dffe0'],
    fire:   ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#dc2626', '#ea580c', '#d97706', '#b91c1c', '#fb923c', '#facc15', '#c2410c', '#991b1b'],
    ocean:  ['#0ea5e9', '#14b8a6', '#6366f1', '#06b6d4', '#3b82f6', '#2dd4bf', '#0284c7', '#22d3ee', '#4f46e5', '#0d9488', '#38bdf8', '#1d4ed8'],
    pastel: ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#2dd4bf', '#a3e635', '#c084fc', '#38bdf8', '#fb7185', '#facc15'],
    // Okabe-Ito : se distingue aussi avec un daltonisme
    access: ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#9ca3af', '#b45309', '#1e40af', '#047857', '#be185d']
};

export const PALETTE_IDS = Object.keys(PALETTES);
const DEFAULT = 'violet';

export function isPalette(id) {
    return Object.prototype.hasOwnProperty.call(PALETTES, id);
}

export function getPaletteId() {
    try {
        const id = localStorage.getItem('votePalette');
        return isPalette(id) ? id : DEFAULT;
    } catch {
        return DEFAULT;
    }
}

export function paletteColors(id = getPaletteId()) {
    return PALETTES[isPalette(id) ? id : DEFAULT];
}

export function setPaletteId(id) {
    if (!isPalette(id)) return;
    try { localStorage.setItem('votePalette', id); } catch {}
    document.dispatchEvent(new CustomEvent('votePaletteChanged', { detail: { id } }));
}
