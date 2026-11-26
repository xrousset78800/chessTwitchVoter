/**
 * Stockfish côté serveur (bots de test du 24/24, adversaire fictif du Multi, cotes des pronostics).
 * Un seul processus, lancé au premier besoin et relancé s'il s'arrête ; les recherches passent une par une.
 */
const path = require('path');
const { spawn } = require('child_process');
const { Chess } = require('chess.js');
const BotEngine = require('./js/utils/botEngine.js');

const ENGINE_FILE = path.join(__dirname, 'vendor', 'stockfish', 'stockfish-19-lite-single.js');

let proc = null;
let engine = null;

function ensure() {
    if (proc && engine) return engine;
    proc = spawn(process.execPath, [ENGINE_FILE], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const current = BotEngine.createEngine((line) => { try { proc?.stdin.write(line + '\n'); } catch {} });
    proc.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            current.onLine(buf.slice(0, i));
            buf = buf.slice(i + 1);
        }
    });
    proc.on('exit', () => { proc = null; engine = null; });
    proc.on('error', (e) => { console.log('⚠️ Stockfish :', e.message); proc = null; engine = null; });
    engine = current;
    return engine;
}

/**
 * Coup d'un bot de ce niveau dans la position (FEN), en SAN ; null si aucun coup.
 * Sans moteur (erreur) : coup légal au hasard.
 */
async function botMove(fen, elo) {
    let chess;
    try { chess = new Chess(fen); } catch { return null; }
    const legal = BotEngine.legalUci(chess);
    if (!legal.length) return null;
    let uci = null;
    try { uci = await ensure().botMove(fen, elo, legal); } catch {}
    return BotEngine.uciToSan(chess, uci || legal[Math.floor(Math.random() * legal.length)]);
}

// Évaluations déjà faites (position -> score du point de vue des Blancs), et celles en cours
const evalCache = new Map();
const evalPending = new Map();
const MAX_EVALS = 800;
const posKey = fen => String(fen || '').split(' ').slice(0, 4).join(' ');

/** Évaluation déjà connue (centipions, point de vue des Blancs ; mat = ±100000), sinon undefined */
function cachedEval(fen) { return evalCache.get(posKey(fen)); }

/** Évaluation de la position (centipions, point de vue des Blancs) ; null si impossible */
function evaluate(fen) {
    const k = posKey(fen);
    if (evalCache.has(k)) return Promise.resolve(evalCache.get(k));
    if (evalPending.has(k)) return evalPending.get(k);
    const p = (async () => {
        let chess;
        try { chess = new Chess(fen); } catch { return null; }
        let white = null;
        if (chess.isCheckmate()) white = chess.turn() === 'w' ? -100000 : 100000;
        else if (chess.isDraw() || chess.isStalemate()) white = 0;
        else {
            let s = null;
            try { s = await ensure().evaluate(fen); } catch {}
            if (s == null) return null;
            white = chess.turn() === 'w' ? s : -s;
        }
        evalCache.set(k, white);
        if (evalCache.size > MAX_EVALS) evalCache.delete(evalCache.keys().next().value);
        return white;
    })().finally(() => evalPending.delete(k));
    evalPending.set(k, p);
    return p;
}

module.exports = { botMove, evaluate, cachedEval, LEVELS: BotEngine.LEVELS, snapLevel: BotEngine.snapLevel, levelLabel: BotEngine.levelLabel };
