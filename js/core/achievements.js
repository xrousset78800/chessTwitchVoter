/**
 * Succès : registre partagé avec le serveur (js/core/achievements.json).
 *  - Les succès à compteur (Rush, votes, premier coup) sont débloqués par le serveur (economy.js).
 *  - Les autres (premiers pas, coups remarquables) sont constatés ici puis envoyés à
 *    POST /api/achievements/unlock. Sans connexion Twitch, ils sont gardés dans le navigateur
 *    (localStorage « achLocal ») et rattachés au compte à la connexion suivante.
 *  - Toast à chaque nouveau succès (comparaison des comptes successifs, js/core/economy.js).
 *
 *   window.achievements.defs      → registre ({ tiers, categories, list })
 *   window.achievements.unlocked() → { id: timestamp } (compte, ou navigateur sans connexion)
 */
import twitchAuth from './twitchAuth.js';

const LOCAL = 'achLocal';
const LANGS = 'achLangs';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tr = (key, params) => window.i18n?.t?.(key, params) ?? key;

const readJson = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch { return fb; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };

const achievements = {
    defs: null,
    ready: null,
    byId: new Map(),
    known: null,        // ids déjà vus pour le compte courant (null : pas encore chargé)
    knownLogin: null,
    quiet: new Set(),   // déjà annoncés (débloqués hors connexion)
    sending: false,

    unlocked() {
        const acc = window.economy?.account;
        return acc ? { ...readJson(LOCAL, {}), ...acc.achievements } : readJson(LOCAL, {});
    },

    has(id) {
        return !!this.unlocked()[id];
    },

    /** Succès constaté par le navigateur */
    unlock(...ids) {
        if (!this.defs) return void this.ready?.then(() => this.unlock(...ids));
        const have = this.unlocked();
        const fresh = ids.filter(id => this.byId.has(id) && !have[id]);
        if (!fresh.length) return;
        if (twitchAuth.isLoggedIn && window.economy?.account) return this.send(fresh);
        // Hors connexion : gardé dans le navigateur, annoncé tout de suite
        const local = readJson(LOCAL, {});
        for (const id of fresh) { local[id] = Date.now(); this.quiet.add(id); this.toast(id); }
        writeJson(LOCAL, local);
        window.dispatchEvent(new CustomEvent('achievementsChanged'));
    },

    async send(ids) {
        try {
            const r = await fetch('/api/achievements/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...twitchAuth.authHeaders() },
                body: JSON.stringify({ ids })
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            window.economy?._set(data.account);   // le toast vient de la comparaison des comptes
            return data.unlocked;
        } catch (e) {
            console.warn('🏆 Succès non envoyés:', e.message);
        }
    },

    /** Progression gardée hors connexion : envoyée une fois le compte chargé */
    async flushLocal() {
        const local = readJson(LOCAL, {});
        const ids = Object.keys(local);
        if (!ids.length || this.sending) return;
        this.sending = true;
        ids.forEach(id => this.quiet.add(id));
        const done = await this.send(ids);
        this.sending = false;
        if (done) writeJson(LOCAL, {});
    },

    toast(id) {
        const def = this.byId.get(id);
        if (!def || !window.AppToast) return;
        const name = tr(`achievements.list.${id}.name`);
        const tier = tr(`achievements.tier.${def.tier}`);
        window.AppToast.show(
            `<b>${esc(tr('achievements.unlockedToast'))}</b> ${esc(name)} <span class="ach-toast__tier ach-tier--${def.tier}">${esc(tier)}</span>`,
            'success', 7000
        )?.classList.add('ach-toast');
    },

    /** Nouveau compte reçu : annonce les succès apparus depuis le précédent */
    onAccount(acc) {
        if (!acc) { this.known = null; this.knownLogin = null; return; }
        const ids = Object.keys(acc.achievements || {});
        if (this.known && this.knownLogin === acc.login) {
            for (const id of ids) if (!this.known.has(id) && !this.quiet.has(id)) this.toast(id);
        }
        this.known = new Set(ids);
        this.knownLogin = acc.login;
        // Arrivée sur le compte : premiers pas et progression locale
        this.unlock('bienvenue');
        this.flushLocal();
        window.dispatchEvent(new CustomEvent('achievementsChanged'));
    },
};

achievements.ready = fetch('/js/core/achievements.json')
    .then(r => r.json())
    .then(defs => {
        achievements.defs = defs;
        achievements.byId = new Map(defs.list.map(d => [d.id, d]));
        return defs;
    })
    .catch(e => console.warn('🏆 Registre des succès indisponible:', e.message));

window.achievements = achievements;
window.addEventListener('economyChanged', (e) => achievements.onAccount(e.detail));

// ---------- Premiers pas ----------

window.addEventListener('cg:page', (e) => {
    const page = e.detail?.page;
    if (page === 'records') achievements.unlock('dans-les-livres');
    else if (page === 'watch') achievements.unlock('curieux');
});

window.addEventListener('cg:gameStart', (e) => {
    const mode = e.detail?.mode;
    if (mode === 'rush') achievements.unlock('premier-run');
    else if (mode === 'mono') achievements.unlock('premiere-inscription');
    else if (mode === 'multi') achievements.unlock('main-tendue');
    else if (mode === 'vsBot') achievements.unlock('face-a-la-machine', 'bac-a-sable');
    else if (mode !== 'problems') achievements.unlock('bac-a-sable');
});

window.addEventListener('cg:linkCopied', () => achievements.unlock('lien-partage'));
window.addEventListener('pieceSetChanged', () => achievements.unlock('relooking'));
window.addEventListener('boardThemeChanged', () => achievements.unlock('relooking'));

function noteLang(lang) {
    if (!lang) return;
    const seen = new Set(readJson(LANGS, []));
    seen.add(lang);
    writeJson(LANGS, [...seen]);
    if (seen.size >= 3) achievements.unlock('polyglotte');
}
window.addEventListener('languageChanged', (e) => noteLang(e.detail?.lang));
noteLang(window.i18n?.currentLang);

// ---------- Coups remarquables ----------

const SQUARES = [...'abcdefgh'].flatMap(f => [1, 2, 3, 4, 5, 6, 7, 8].map(r => f + r));

/** Le camp au trait est-il en échec quand on retire la pièce de la case sq ? */
function checkWithout(fen, sq) {
    const c = new window.Chess(fen);
    c.remove(sq);
    return c.in_check();
}

function remarkable(move, chess) {
    const got = [];
    const f = move.flags || '';
    if (f.includes('k')) got.push('petit-roque');
    if (f.includes('q')) got.push('grand-roque');
    if (f.includes('e')) got.push('en-passant');
    if (move.promotion) {
        got.push('promotion');
        if (move.promotion === 'n') got.push('sous-promotion');
        if (move.promotion === 'b' || move.promotion === 'r') got.push('vraiment');
    }
    const board = chess.board().flat().filter(Boolean);
    if (board.filter(p => p.type === 'q' && p.color === move.color).length >= 2) got.push('deux-dames');

    if (chess.in_check()) {
        const fen = chess.fen();
        // Échec à la découverte : la pièce jouée n'est pas (seule) à donner l'échec
        if (!/[kq]/.test(f) && checkWithout(fen, move.to)) got.push('echec-a-la-decouverte');
        // Échec double : aucune pièce retirée seule ne lève l'échec
        const squares = [];
        SQUARES.forEach(sq => { const p = chess.get(sq); if (p && p.color === move.color && p.type !== 'k') squares.push(sq); });
        if (squares.every(sq => checkWithout(fen, sq))) got.push('echec-double');
    }

    if (chess.in_checkmate()) {
        // Numéro du coup du camp qui mate (dernier champ de la FEN, déjà avancé après un coup noir)
        const full = parseInt(chess.fen().split(' ')[5], 10) || 99;
        const moveNo = move.color === 'w' ? full : full - 1;
        const kingSq = SQUARES.find(sq => { const p = chess.get(sq); return p && p.type === 'k' && p.color !== move.color; });
        const backRank = move.color === 'w' ? '8' : '1';
        if (kingSq?.[1] === backRank && (move.piece === 'r' || move.piece === 'q') && move.to[1] === backRank) got.push('mat-du-couloir');
        if (moveNo <= 4) got.push('mat-du-berger');
        if (moveNo < 10) got.push('mat-du-lion');
        if (move.piece === 'p' && !move.promotion) got.push('mat-de-pion');
        if (move.piece === 'k') got.push('mat-de-roi');
    }
    return got;
}

window.addEventListener('cg:move', (e) => {
    const { move, chess } = e.detail || {};
    if (!move || !chess || !window.Chess) return;
    try {
        const got = remarkable(move, chess);
        if (got.length) achievements.unlock(...got);
    } catch (err) {
        console.warn('🏆 Analyse du coup :', err.message);
    }
});

export default achievements;
