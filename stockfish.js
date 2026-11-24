/**
 * Stockfish côté serveur (bots de test du 24/24, adversaire fictif du Multi).
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

module.exports = { botMove, LEVELS: BotEngine.LEVELS, snapLevel: BotEngine.snapLevel, levelLabel: BotEngine.levelLabel };
