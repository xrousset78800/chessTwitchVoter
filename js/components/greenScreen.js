/**
 * Fond vert (incrustation OBS) : remplace le fond de la page de jeu par une couleur unie
 * à découper avec un filtre « Clé de chrominance ». Réglage d'affichage, mémorisé localement.
 */
const KEY_ON = 'chromaKey';
const KEY_COLOR = 'chromaColor';
export const DEFAULT_CHROMA = '#00b140';

const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');

export const chromaOn = () => read(KEY_ON, '0') === '1';
export const chromaColor = () => { const c = read(KEY_COLOR, DEFAULT_CHROMA); return isHex(c) ? c : DEFAULT_CHROMA; };

function apply() {
    const on = chromaOn();
    const color = chromaColor();
    document.body?.classList.toggle('chroma', on);
    document.documentElement.style.setProperty('--chroma', color);
    document.querySelectorAll('[data-chroma-toggle]').forEach(t => t.classList.toggle('is-active', on));
    document.querySelectorAll('[data-chroma-color]').forEach(i => { if (i.value !== color) i.value = color; });
    document.querySelectorAll('[data-chroma-reset]').forEach(b => { b.hidden = color === DEFAULT_CHROMA; });
}

export function setChroma(on) { write(KEY_ON, on ? '1' : '0'); apply(); }
export function setChromaColor(color) { if (isHex(color)) { write(KEY_COLOR, color.toLowerCase()); apply(); } }

export function initGreenScreen() {
    apply();
    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-chroma-toggle]')) setChroma(!chromaOn());
        else if (e.target.closest('[data-chroma-reset]')) setChromaColor(DEFAULT_CHROMA);
    });
    document.addEventListener('input', (e) => {
        if (e.target.matches?.('[data-chroma-color]')) {
            setChromaColor(e.target.value);
            if (!chromaOn()) setChroma(true); // choisir une couleur active le fond
        }
    });
}
