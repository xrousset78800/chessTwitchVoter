/**
 * PHANTOM TWITCHESS - Résolution des coups tapés par le chat
 *
 * Le chat écrit "kh1", "Kh1", "KH1", "e2e4", "e2-e4", "o-o", "0-0", "e8=q"...
 * On compare le texte aux coups légaux de la position (insensible à la casse)
 * et on renvoie le coup canonique { san, uci }, ou null s'il est illégal.
 */

function stripSan(s) {
    return s.replace(/[+#]/g, '').replace(/=/g, '');
}

/**
 * @param {object} chess  instance chess.js (position courante)
 * @param {string} raw    texte du vote
 * @returns {{san: string, uci: string} | null}
 */
export function matchLegalMove(chess, raw) {
    if (!chess || raw == null) return null;

    let text = String(raw).trim().replace(/\s+/g, '');
    if (!text) return null;

    // Roque : o-o, 0-0, OO, 0-0-0...
    if (/^(o|0)-?(o|0)-?(o|0)$/i.test(text))      text = 'O-O-O';
    else if (/^(o|0)-?(o|0)$/i.test(text))        text = 'O-O';

    const key    = stripSan(text).toLowerCase();
    const uciKey = key.replace('-', '');

    let legal;
    try {
        legal = chess.moves({ verbose: true });
    } catch {
        return null;
    }

    const candidates = [];
    for (const m of legal) {
        const uci = m.from + m.to + (m.promotion || '');
        const sanKey = stripSan(m.san).toLowerCase();
        if (uciKey === uci || key === sanKey) {
            candidates.push({ san: m.san, uci });
        }
    }

    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    // Ambiguïté de casse (ex: "bxc3" pion vs "Bxc3" fou) : on préfère
    // le coup dont la première lettre a la même casse que le texte tapé.
    const exact = candidates.find(c => stripSan(c.san) === stripSan(text));
    if (exact) return exact;
    const sameCase = candidates.find(c => (c.san[0] === c.san[0].toUpperCase()) === (text[0] === text[0].toUpperCase()));
    return sameCase || candidates[0];
}

export default matchLegalMove;
