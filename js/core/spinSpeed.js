/**
 * Vitesse du tirage au sort (roue ou bande) : quatre réglages, en secondes.
 * « none » : pas d'animation, le coup tiré s'affiche tout de suite.
 */
export const SPIN_SPEEDS = [
    { id: 'none', s: 0 },
    { id: 'fast', s: 3 },
    { id: 'normal', s: 6 },
    { id: 'slow', s: 10 }
];
export const DEFAULT_SPIN = 6;

/** Durée valide la plus proche (anciens réglages libres : 5 s → normale) */
export function snapSpin(sec) {
    const n = Number(sec);
    if (sec === '' || sec == null || !Number.isFinite(n)) return DEFAULT_SPIN;
    return SPIN_SPEEDS.reduce((a, b) => (Math.abs(b.s - n) < Math.abs(a.s - n) ? b : a)).s;
}

export const spinId = (sec) => SPIN_SPEEDS.find(x => x.s === snapSpin(sec)).id;
