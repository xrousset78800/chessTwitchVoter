/**
 * Export PGN en un clic : télécharge un fichier .pgn et le copie dans le presse-papiers
 * (format lu par chess.com, Lichess… : « Importer une partie » → coller ou choisir le fichier).
 *
 * Chaque page déclare sa source : registerPgnSource('h24', () => ({ moves, startFen, white, black, result, event }))
 * Bouton : <button data-pgn-export="h24">
 */
const sources = new Map();
const t = (k, p, d) => window.i18n?.t?.(k, p) || d;

export function registerPgnSource(name, fn) {
    sources.set(name, fn);
}

const pad = n => String(n).padStart(2, '0');
const tag = (k, v) => `[${k} "${String(v ?? '?').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;

/** Résultat PGN d'après la position finale quand la page ne le donne pas */
function resultOf(chess) {
    if (chess.in_checkmate()) return chess.turn() === 'w' ? '0-1' : '1-0';
    if (chess.in_draw() || chess.in_stalemate() || chess.in_threefold_repetition() || chess.insufficient_material()) return '1/2-1/2';
    return '*';
}

/** { moves (SAN), startFen?, white?, black?, result?, event? } → texte PGN (null si aucun coup jouable) */
export function buildPgn(d) {
    const C = window.Chess;
    if (!C || !d?.moves?.length) return null;
    // Position de départ normale : pas d'en-tête FEN
    const start = d.startFen && d.startFen !== 'start' && d.startFen !== new C().fen() ? d.startFen : null;
    const chess = start ? new C(start) : new C();
    for (const san of d.moves) if (!chess.move(san, { sloppy: true })) break;
    const n = chess.history().length;
    if (!n) return null;
    const now = new Date();
    const result = ['1-0', '0-1', '1/2-1/2'].includes(d.result) ? d.result : resultOf(chess);
    const head = [
        tag('Event', d.event || 'Crowd Gambit'),
        tag('Site', location.host || 'Crowd Gambit'),
        tag('Date', `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`),
        tag('Round', '-'),
        tag('White', d.white || '?'),
        tag('Black', d.black || '?'),
        tag('Result', result),
    ];
    if (start) head.push(tag('SetUp', '1'), tag('FEN', start));
    // Coups numérotés, 1… si les Noirs commencent ; lignes de 80 caractères au plus
    const first = start ? start.split(' ') : ['', 'w', '', '', '', '1'];
    let no = parseInt(first[5], 10) || 1, white = first[1] !== 'b';
    const toks = [];
    chess.history().forEach((san, i) => {
        if (white) toks.push(`${no}.`);
        else if (i === 0) toks.push(`${no}...`);
        toks.push(san);
        if (!white) no++;
        white = !white;
    });
    toks.push(result);
    const lines = [];
    let line = '';
    for (const x of toks) {
        if (line && line.length + 1 + x.length > 80) { lines.push(line); line = x; } else line = line ? `${line} ${x}` : x;
    }
    if (line) lines.push(line);
    return `${head.join('\n')}\n\n${lines.join('\n')}\n`;
}

async function copy(text) {
    // Presse-papiers : jamais bloquant (refus ou attente d'autorisation → simple téléchargement)
    try {
        return await Promise.race([navigator.clipboard.writeText(text).then(() => true), new Promise(r => setTimeout(() => r(false), 1500))]);
    } catch { return false; }
}

function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPgn(name) {
    let data = null;
    try { data = sources.get(name)?.(); } catch { data = null; }
    const pgn = buildPgn(data);
    if (!pgn) { window.toast?.show(t('pgn.empty', null, 'Aucun coup à exporter'), 'info'); return null; }
    const d = new Date();
    download(pgn, `crowd-gambit-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.pgn`);
    const copied = await copy(pgn);
    window.toast?.show(t(copied ? 'pgn.done' : 'pgn.saved', null, copied ? 'PGN téléchargé et copié' : 'PGN téléchargé'), 'success', 3500);
    return pgn;
}

document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-pgn-export]');
    if (!b) return;
    e.preventDefault();
    exportPgn(b.dataset.pgnExport);
});
