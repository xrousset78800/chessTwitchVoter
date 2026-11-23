/**
 * PHANTOM TWITCHESS - Résolution des coups tapés par le chat
 *
 * Le chat écrit dans la notation de la langue affichée : « Cf3 » en français, « Sf3 » en allemand…
 * plus l'UCI (« e2e4 », « e2-e4 ») et le roque (« o-o », « 0-0 ») qui sont universels.
 * On compare le texte aux coups légaux traduits dans cette langue (casse ignorée)
 * et on renvoie le coup canonique { san, uci } en notation internationale, ou null.
 * La traduction est dans utils/notation.js (window.Notation, partagé avec le serveur 24/24).
 */

/** Affichage d'un coup (SAN international) dans la langue de l'interface : Nf3 → Cf3 en français */
export const fmtMove = (san) => (window.Notation ? window.Notation.local(san) : san);

/** Langue de lecture du chat : celle de l'interface du streamer */
export const chatLang = () => window.i18n?.currentLang || 'fr';

/**
 * @param {object} chess  instance chess.js (position courante)
 * @param {string} raw    texte du vote
 * @param {string} lang   langue de notation du texte ('en' = notation internationale)
 * @returns {{san: string, uci: string} | null}
 */
export function matchLegalMove(chess, raw, lang = chatLang()) {
    if (!chess || raw == null || !window.Notation) return null;
    let legal;
    try {
        legal = chess.moves({ verbose: true });
    } catch {
        return null;
    }
    const m = window.Notation.match(legal, raw, lang);
    return m ? { san: m.san, uci: m.uci } : null;
}

export default matchLegalMove;
