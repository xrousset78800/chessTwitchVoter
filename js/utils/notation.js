/**
 * PHANTOM TWITCHESS - Notation des coups selon la langue
 *
 * En interne tout reste en notation internationale (SAN anglaise : K Q R B N).
 * - toLocal(san, lang) : affichage dans la langue (Nf3 → Cf3 en français, Sf3 en allemand…)
 * - match(legal, text, lang) : ce que tape le chat, lu dans CETTE langue uniquement, sans repli.
 *   On traduit les coups légaux vers la langue (sens sûr, sans ambiguïté) et on compare au texte.
 *
 * Script classique (window.Notation) et module CommonJS (serveur 24/24).
 */
(function (root) {
    // Lettres des pièces, dans l'ordre Roi, Dame, Tour, Fou, Cavalier ; le pion n'a pas de lettre
    const PIECES = {
        en: ['K', 'Q', 'R', 'B', 'N'],
        fr: ['R', 'D', 'T', 'F', 'C'],
        es: ['R', 'D', 'T', 'A', 'C'],
        it: ['R', 'D', 'T', 'A', 'C'],
        pt: ['R', 'D', 'T', 'B', 'C'],
        de: ['K', 'D', 'T', 'L', 'S'],
        nl: ['K', 'D', 'T', 'L', 'P'],
        pl: ['K', 'H', 'W', 'G', 'S'],
        tr: ['Ş', 'V', 'K', 'F', 'A'],
        ru: ['Кр', 'Ф', 'Л', 'С', 'К']
    };
    const EN = 'KQRBN';

    const letters = (lang) => PIECES[lang] || PIECES.en;
    const lower = (s) => s.toLocaleLowerCase('und');

    /** Coup SAN international → notation de la langue (pièce en tête et pièce de promotion) */
    function toLocal(san, lang) {
        const s = String(san ?? '');
        if (!s || !lang || lang === 'en' || !PIECES[lang]) return s;
        if (!/^([KQRBN]x?[a-h1-8]|[a-h])/.test(s)) return s;   // pas un coup (choix d'un vote…) : inchangé
        const L = letters(lang);
        let out = s;
        const i = EN.indexOf(out[0]);
        if (i >= 0) out = L[i] + out.slice(1);
        return out.replace(/=([QRBN])/, (_, p) => '=' + L[EN.indexOf(p)]);
    }

    /** Navigateur : coup dans la langue de l'interface */
    const local = (san) => toLocal(san, root.i18n?.currentLang);

    /** Texte comparable : sans échec/mat, annotations, signe de promotion ni espaces */
    const strip = (s) => String(s).replace(/[+#!?=\s]/g, '');

    function castle(text) {
        if (/^(o|0)-?(o|0)-?(o|0)$/i.test(text)) return 'O-O-O';
        if (/^(o|0)-?(o|0)$/i.test(text)) return 'O-O';
        return text;
    }

    /**
     * Coup tapé (dans la langue `lang`) → coup légal { san, uci, from, to, promotion } ou null
     * @param {Array} legal  coups légaux verbeux de chess.js (chess.moves({ verbose: true }))
     */
    function match(legal, raw, lang = 'en') {
        if (!Array.isArray(legal) || raw == null) return null;
        const text = castle(strip(raw));
        if (!text) return null;
        const key = lower(text);
        const uciKey = key.replace(/-/g, '');
        const L = letters(lang);
        const candidates = [];
        for (const m of legal) {
            const local = strip(toLocal(m.san, lang));
            const uci = m.from + m.to + (m.promotion || '');
            const uciLocal = m.promotion ? m.from + m.to + lower(L[EN.indexOf(m.promotion.toUpperCase())]) : uci;
            if (key === lower(local) || uciKey === uci || uciKey === uciLocal) candidates.push({ m, local });
        }
        if (!candidates.length) return null;
        const pick = (c) => ({ san: c.m.san, uci: c.m.from + c.m.to + (c.m.promotion || ''), from: c.m.from, to: c.m.to, promotion: c.m.promotion });
        if (candidates.length === 1) return pick(candidates[0]);
        // Même texte, deux coups (ex. « bxc3 » pion ou « Bxc3 » fou) : la casse tapée tranche
        const exact = candidates.find(c => c.local === text);
        if (exact) return pick(exact);
        const upper = text[0] !== lower(text[0]);
        return pick(candidates.find(c => (c.local[0] !== lower(c.local[0])) === upper) || candidates[0]);
    }

    /** Le message ressemble-t-il à un coup dans cette langue ? (filtre rapide avant la vraie résolution) */
    function looksLikeMove(raw, lang = 'en') {
        const text = castle(strip(String(raw || '').trim()));
        if (!text || text.length > 9) return false;
        if (text === 'O-O' || text === 'O-O-O') return true;
        if (/^[a-h][1-8]-?[a-h][1-8][a-zа-яş]?$/i.test(text)) return true;
        const L = letters(lang).map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const re = new RegExp(`^(?:${L.join('|')})?[a-h]?[1-8]?[x:]?[a-h][1-8](?:${L.slice(1).join('|')})?$`, 'iu');
        return re.test(text);
    }

    const api = { PIECES, toLocal, local, match, looksLikeMove };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Notation = api;
})(typeof window !== 'undefined' ? window : globalThis);
