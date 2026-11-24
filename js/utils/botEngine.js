/**
 * Bots de test : niveaux de jeu et dialogue UCI avec Stockfish (vendor/stockfish, version « lite single »).
 *
 * Partagé entre la page (Worker) et le serveur 24/24 (processus Node) : chacun fournit `send(ligne)`
 * pour parler au moteur et appelle `engine.onLine(ligne)` pour chaque ligne qu'il renvoie.
 *
 * Niveaux : 300 à 2400+.
 * - 1500 à 2100 : force bridée par Stockfish lui-même (UCI_LimitStrength + UCI_Elo).
 * - 2400+ : pleine force (temps de réflexion court).
 * - 300 à 1200 : Stockfish ne descend pas sous 1320 ; on le règle au plus bas et une part des coups
 *   est jouée au hasard, d'autant plus souvent que le niveau est bas.
 *
 * Script classique (window.BotEngine) et module CommonJS (serveur).
 */
(function (root) {
    const LEVELS = [300, 600, 900, 1200, 1500, 1800, 2100, 2400];
    const DEFAULT_LEVEL = 1500;
    const MIN_ENGINE_ELO = 1320;
    /** Part de coups au hasard sous le plancher de Stockfish */
    const RANDOM_SHARE = { 300: 0.6, 600: 0.42, 900: 0.26, 1200: 0.1 };
    const TIMEOUT_MS = 6000;

    /** Niveau valide le plus proche */
    function snapLevel(elo) {
        const n = Number(elo);
        if (!Number.isFinite(n)) return DEFAULT_LEVEL;
        return LEVELS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    }
    const levelLabel = (elo) => (snapLevel(elo) >= 2400 ? '2400+' : String(snapLevel(elo)));

    /**
     * Moteur UCI : une recherche à la fois (file d'attente), chaque recherche à son propre niveau.
     * @param {(line: string) => void} send
     */
    function createEngine(send) {
        let queue = Promise.resolve();
        let waiter = null;
        let stale = 0;          // recherches abandonnées (délai) dont le « bestmove » arrive encore
        let started = false;

        function onLine(line) {
            const m = /^bestmove\s+(\S+)/.exec(String(line).trim());
            if (!m) return;
            if (stale > 0) { stale--; return; }
            if (waiter) waiter(m[1] === '(none)' ? null : m[1]);
        }

        /** Meilleur coup (UCI, ex. « e2e4 ») au niveau donné, null si rien */
        function search(fen, elo) {
            const level = snapLevel(elo);
            const run = () => new Promise((resolve) => {
                if (!started) {
                    started = true;
                    send('uci');
                    send('setoption name Threads value 1');
                }
                if (level >= 2400) {
                    send('setoption name UCI_LimitStrength value false');
                    send('setoption name Skill Level value 20');
                } else {
                    send('setoption name UCI_LimitStrength value true');
                    send('setoption name UCI_Elo value ' + Math.max(MIN_ENGINE_ELO, level));
                }
                send('position fen ' + fen);
                send('go movetime ' + (level >= 2400 ? 600 : 300));
                const timer = setTimeout(() => {
                    waiter = null;
                    stale++;
                    send('stop');
                    resolve(null);
                }, TIMEOUT_MS);
                waiter = (uci) => { clearTimeout(timer); waiter = null; resolve(uci); };
            });
            const p = queue.then(run, run);
            queue = p.catch(() => null);
            return p;
        }

        /**
         * Coup d'un bot : au hasard pour une part des coups des petits niveaux, sinon Stockfish.
         * @param {string[]} legalUci coups légaux en UCI (« e2e4 », « e7e8q »)
         */
        async function botMove(fen, elo, legalUci) {
            const level = snapLevel(elo);
            const legal = legalUci || [];
            if (legal.length && Math.random() < (RANDOM_SHARE[level] || 0)) {
                return legal[Math.floor(Math.random() * legal.length)];
            }
            const uci = await search(fen, level);
            if (uci && (!legal.length || legal.includes(uci))) return uci;
            return legal.length ? legal[Math.floor(Math.random() * legal.length)] : null;
        }

        return { onLine, search, botMove };
    }

    /** Coups légaux d'une partie chess.js, en UCI */
    const legalUci = (chess) => chess.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));

    /** UCI → SAN dans la position de la partie chess.js (sans la jouer) */
    function uciToSan(chess, uci) {
        if (!uci) return null;
        const m = chess.moves({ verbose: true }).find(x => x.from + x.to + (x.promotion || '') === uci);
        return m ? m.san : null;
    }

    const api = { LEVELS, DEFAULT_LEVEL, snapLevel, levelLabel, createEngine, legalUci, uciToSan };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BotEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
