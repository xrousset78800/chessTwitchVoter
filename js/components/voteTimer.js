/**
 * Minuteur en barre, dans le bloc de vote (partie du streamer, spectateur, 24/24).
 * La barre se remplit à mesure que le temps passe : pleine quand le vote se termine.
 */

/**
 * Remplit la barre de `box` jusqu'à la fraction `p` (0 → 1) en `step` secondes.
 * Quand la barre recule (nouveau tour), elle repart sans animation.
 */
export function fillVoteTimer(box, p, step = 0.25) {
    const fill = box?.querySelector('.vote-timer__fill');
    if (!fill) return;
    const v = Math.max(0, Math.min(1, Number(p) || 0));
    const prev = Number(fill.dataset.p || 0);
    fill.style.transitionDuration = v < prev ? '0s' : `${step}s`;
    fill.style.setProperty('--p', v);
    fill.dataset.p = String(v);
}
