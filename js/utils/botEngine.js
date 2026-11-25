/**
 * Bots de test : niveaux de jeu et dialogue UCI avec Stockfish (vendor/stockfish, version « lite single »).
 *
 * Partagé entre la page (Worker) et le serveur 24/24 (processus Node) : chacun fournit `send(ligne)`
 * pour parler au moteur et appelle `engine.onLine(ligne)` pour chaque ligne qu'il renvoie.
 *
 * Niveaux : 300 à 2400+.
 * - 1320 à 2100 : force bridée par Stockfish lui-même (UCI_LimitStrength + UCI_Elo) ; 1320 est son plancher.
 * - 2400+ : pleine force (temps de réflexion court).
 * - 300 à 900 : Stockfish ne descend pas sous 1320. Il donne ses N meilleurs coups (MultiPV) et le bot
 *   en tire un au hasard parmi ceux qui ne perdent pas plus de X centipions sur le meilleur :
 *   plus le niveau est bas, plus la liste est longue et l'écart toléré grand (erreurs plausibles,
 *   pas de coups absurdes tirés parmi tous les coups légaux).
 *
 * Script classique (window.BotEngine) et module CommonJS (serveur).
 */
(function (root) {
    const LEVELS = [300, 600, 900, 1320, 1500, 1800, 2100, 2400];
    const DEFAULT_LEVEL = 1500;
    const MIN_ENGINE_ELO = 1320;
    /** Sous le plancher : N meilleurs coups, perte maximale tolérée (centipions) par rapport au meilleur */
    const WIDE = {
        900: { k: 8, maxLoss: 400 },
        600: { k: 12, maxLoss: 800 },
        300: { k: 20, maxLoss: 2000 }
    };
    const MATE = 100000;
    const TIMEOUT_MS = 6000;

    /** Niveau valide le plus proche */
    function snapLevel(elo) {
        const n = Number(elo);
        if (!Number.isFinite(n)) return DEFAULT_LEVEL;
        return LEVELS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    }
    const levelLabel = (elo) => (snapLevel(elo) >= 2400 ? '2400+' : String(snapLevel(elo)));
    /** Libellé d'un choix de niveau : « 1500 », « 2400+ » */
    const levelOption = (elo) => levelLabel(elo);

    /**
     * Moteur UCI : une recherche à la fois (file d'attente), chaque recherche à son propre niveau.
     * @param {(line: string) => void} send
     */
    function createEngine(send) {
        let queue = Promise.resolve();
        let waiter = null;
        let stale = 0;          // recherches abandonnées (délai) dont le « bestmove » arrive encore
        let started = false;
        let lines = null;       // MultiPV de la recherche en cours : rang → { uci, score }

        function onLine(raw) {
            const line = String(raw).trim();
            if (line.startsWith('info ') && lines && !stale) {
                const rank = /\bmultipv (\d+)/.exec(line);
                const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
                const pv = /\bpv (\S+)/.exec(line);
                if (score && pv) {
                    const n = Number(score[2]);
                    // Score du point de vue du camp au trait ; un mat plus proche vaut plus
                    const value = score[1] === 'cp' ? n : (n > 0 ? MATE - n : -MATE - n);
                    lines.set(rank ? Number(rank[1]) : 1, { uci: pv[1], score: value });
                }
                return;
            }
            const m = /^bestmove\s+(\S+)/.exec(line);
            if (!m) return;
            if (stale > 0) { stale--; return; }
            if (waiter) waiter(m[1] === '(none)' ? null : m[1]);
        }

        /**
         * Une recherche : { best, lines } (meilleur coup UCI, et les k meilleurs coups notés si k > 1).
         * Niveau sous le plancher avec k > 1 : pleine force, pour que la liste soit fiable.
         */
        function run(fen, level, k = 1) {
            const go = () => new Promise((resolve) => {
                if (!started) {
                    started = true;
                    send('uci');
                    send('setoption name Threads value 1');
                }
                if (level >= 2400 || k > 1) {
                    send('setoption name UCI_LimitStrength value false');
                    send('setoption name Skill Level value 20');
                } else {
                    send('setoption name UCI_LimitStrength value true');
                    send('setoption name UCI_Elo value ' + Math.max(MIN_ENGINE_ELO, level));
                }
                send('setoption name MultiPV value ' + k);
                lines = new Map();
                send('position fen ' + fen);
                send('go movetime ' + (level >= 2400 ? 600 : 300));
                const done = (best) => {
                    const ranked = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
                    lines = null;
                    resolve({ best, lines: ranked });
                };
                const timer = setTimeout(() => {
                    waiter = null;
                    stale++;
                    send('stop');
                    done(null);
                }, TIMEOUT_MS);
                waiter = (uci) => { clearTimeout(timer); waiter = null; done(uci); };
            });
            const p = queue.then(go, go);
            queue = p.catch(() => null);
            return p;
        }

        /** Meilleur coup (UCI, ex. « e2e4 ») au niveau donné, null si rien */
        async function search(fen, elo) {
            return (await run(fen, snapLevel(elo))).best;
        }

        /**
         * Coup d'un bot. Sous le plancher de Stockfish : au hasard parmi ses meilleurs coups
         * (ceux qui ne perdent pas trop sur le meilleur) ; sinon Stockfish bridé à ce niveau.
         * @param {string[]} legalUci coups légaux en UCI (« e2e4 », « e7e8q »)
         */
        async function botMove(fen, elo, legalUci) {
            const level = snapLevel(elo);
            const legal = legalUci || [];
            const ok = (uci) => uci && (!legal.length || legal.includes(uci));
            const wide = WIDE[level];
            if (wide) {
                const res = await run(fen, level, wide.k);
                const cands = res.lines.filter(l => ok(l.uci));
                if (cands.length) {
                    const top = cands[0].score;
                    const pool = cands.filter(l => top - l.score <= wide.maxLoss);
                    return pool[Math.floor(Math.random() * pool.length)].uci;
                }
                if (ok(res.best)) return res.best;
            } else {
                const uci = await search(fen, level);
                if (ok(uci)) return uci;
            }
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

    /** Page : un seul Stockfish (Worker) pour toute la page, lance au premier besoin ; null si impossible */
    let shared = null;
    function browserEngine() {
        if (shared) return shared;
        if (typeof Worker !== 'function') return null;
        let worker;
        try {
            worker = new Worker('/vendor/stockfish/stockfish-19-lite-single.js');
        } catch (e) {
            console.warn('Stockfish indisponible :', e);
            return null;
        }
        const engine = createEngine((cmd) => worker.postMessage(cmd));
        worker.onmessage = (e) => String(e.data ?? '').split('\n').forEach(l => engine.onLine(l));
        worker.onerror = (e) => { console.warn('Stockfish :', e.message || e); };
        shared = engine;
        return engine;
    }

    const api = { LEVELS, DEFAULT_LEVEL, snapLevel, levelLabel, levelOption, createEngine, legalUci, uciToSan, browserEngine };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BotEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
