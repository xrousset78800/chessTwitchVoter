/**
 * Cosmétiques du magasin (hors pièces / échiquiers / couleurs du tirage, voir pieceSet.js et votePalettes.js) :
 * kits de sons, traînées, effets de prise, animations de victoire, roue, flèche du coup tiré,
 * envol des pions — choisis dans ce navigateur (localStorage « cosm.<slot> »).
 * Couleur du pseudo, cadre d'avatar et badge sont vus par les autres : enregistrés sur le serveur
 * (POST /api/economy/look, window.economy.setLook) et lus via js/core/looks.js.
 *
 *   Cosmetics.ITEMS[id]      → { slot, ...réglages d'affichage }
 *   Cosmetics.get(slot)      → id équipé et possédé, sinon null
 *   Cosmetics.set(slot, id)  → équipe (null : retire) ; événement « cosmeticsChanged »
 *   Cosmetics.item(slot)     → réglages de l'objet équipé, sinon null
 */
const LOCAL_SLOTS = ['sound', 'trail', 'capture', 'win', 'wheel', 'arrow', 'fly'];
export const LOOK_SLOTS = ['color', 'frame', 'badge'];

export const ITEMS = {
    // Kits de sons (synthèse : js/utils/soundKit.js)
    'kit-wood': { slot: 'sound', icon: 'fa-tree' },
    'kit-8bit': { slot: 'sound', icon: 'fa-gamepad' },
    'kit-marble': { slot: 'sound', icon: 'fa-gem' },
    'kit-arcade': { slot: 'sound', icon: 'fa-bolt' },
    'kit-orchestra': { slot: 'sound', icon: 'fa-drum' },
    'kit-fanfare': { slot: 'sound', icon: 'fa-bullhorn' },
    // Traînées et prises (js/components/boardFx.js)
    'trail-ember': { slot: 'trail', colors: ['#ff8a3d', '#ffcf5c', '#ff4d2e'] },
    'trail-ink': { slot: 'trail', colors: ['#1c1530', '#3a2d6b', '#6b5aa8'] },
    'trail-stars': { slot: 'trail', colors: ['#ffe27a', '#ffffff', '#b8d8ff'], stars: true },
    'cap-shards': { slot: 'capture', colors: ['#d9f1ff', '#9fd2ff', '#ffffff'] },
    'cap-dust': { slot: 'capture', colors: ['#c8b79a', '#8f7e66', '#e8dcc4'] },
    'cap-shock': { slot: 'capture', colors: ['#ff8a3d', '#ffd35c', '#ffffff'] },
    'win-pawns': { slot: 'win', icon: 'fa-chess-pawn' },
    'win-crown': { slot: 'win', icon: 'fa-crown' },
    'win-fireworks': { slot: 'win', icon: 'fa-wand-magic-sparkles' },
    // Roue du tirage (js/components/wheel.js)
    'wheel-neon': { slot: 'wheel', rim: '#120a24', ring: 'rgba(91,212,255,.55)', lamp: '120,230,255', glow: '#5bd4ff', hub: '#ff7eb6', flap: '#e9fbff' },
    'wheel-wood': { slot: 'wheel', rim: '#5a3a22', ring: 'rgba(214,160,104,.5)', lamp: '255,214,150', glow: '#e0a060', hub: '#8a5a33', flap: '#f3e2c8' },
    'wheel-gold': { slot: 'wheel', rim: '#3a2a0c', ring: 'rgba(255,211,92,.6)', lamp: '255,230,150', glow: '#ffd35c', hub: '#ffd35c', flap: '#fff6d8' },
    // Flèche du coup tiré (js/utils/boardAnnotations.js)
    'arrow-flame': { slot: 'arrow', color: 'rgb(255,94,40)', glow: '#ffb000' },
    'arrow-ice': { slot: 'arrow', color: 'rgb(110,205,255)', glow: '#e4f7ff' },
    'arrow-gold': { slot: 'arrow', color: 'rgb(255,200,60)', glow: '#fff1b0' },
    // Envol des pions gagnés (js/components/coinFx.js)
    'fly-stars': { slot: 'fly', cls: 'coin-fly--stars' },
    'fly-gold': { slot: 'fly', cls: 'coin-fly--gold' },
    // Vus par les autres
    'color-sky': { slot: 'color', color: '#5ec8ff' },
    'color-violet': { slot: 'color', color: '#b48cff' },
    'color-rose': { slot: 'color', color: '#ff7eb6' },
    'color-gold': { slot: 'color', color: '#ffd35c' },
    'frame-bronze': { slot: 'frame', cls: 'look-frame--bronze' },
    'frame-silver': { slot: 'frame', cls: 'look-frame--silver' },
    'frame-gold': { slot: 'frame', cls: 'look-frame--gold' },
    'frame-mecene': { slot: 'frame', cls: 'look-frame--mecene' },
    'frame-crown': { slot: 'frame', cls: 'look-frame--crown' },
    'badge-knight': { slot: 'badge', icon: 'fa-chess-knight', color: '#c9d3e0' },
    'badge-flame': { slot: 'badge', icon: 'fa-fire', color: '#ff7a2e' },
    'badge-star': { slot: 'badge', icon: 'fa-star', color: '#ffd35c' },
    'badge-oracle': { slot: 'badge', icon: 'fa-eye', color: '#b48cff' },
    'badge-fidele': { slot: 'badge', icon: 'fa-calendar-check', color: '#5ec8ff' },
};

const owns = (id) => !!window.unlockedRewards?.has?.(id);
const read = (slot) => { try { return localStorage.getItem(`cosm.${slot}`); } catch { return null; } };

const Cosmetics = {
    ITEMS,
    LOCAL_SLOTS,
    LOOK_SLOTS,
    isLook: (slot) => LOOK_SLOTS.includes(slot),

    get(slot) {
        if (LOOK_SLOTS.includes(slot)) {
            const id = window.economy?.account?.look?.[slot];
            return id && owns(id) ? id : null;
        }
        const id = read(slot);
        return id && ITEMS[id]?.slot === slot && owns(id) ? id : null;
    },

    item(slot) {
        const id = this.get(slot);
        return id ? { id, ...ITEMS[id] } : null;
    },

    async set(slot, id) {
        if (LOOK_SLOTS.includes(slot)) {
            await window.economy?.setLook(slot, id);
        } else {
            try { id ? localStorage.setItem(`cosm.${slot}`, id) : localStorage.removeItem(`cosm.${slot}`); } catch { }
        }
        window.dispatchEvent(new CustomEvent('cosmeticsChanged', { detail: { slot, id } }));
    },
};

window.Cosmetics = Cosmetics;
export default Cosmetics;
