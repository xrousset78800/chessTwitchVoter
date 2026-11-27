/**
 * Station 24/24 : une partie permanente jouée par les viewers, pilotée par le serveur.
 *
 * Cycle : partie → récap → vote du mode → votes des options → inscription → partie…
 * - Deux équipes (« teams ») : les inscrits sont répartis entre Blancs et Noirs, chaque équipe vote ses coups.
 * - Puzzle rush (« rush ») : tous les inscrits forment une équipe ; puzzles de plus en plus durs, 3 erreurs et c'est fini
 *   (même modèle que js/core/rushManager.js : départ 600, +60 par puzzle résolu).
 * - Contre Stockfish (« bot ») : tous les inscrits dans un camp tiré au sort, contre Stockfish au niveau voté (300 à 2400+).
 *
 * Tous les votes (coups, mode, options, inscription) passent par les mêmes fonctions, quelle que soit
 * leur source : la page web aujourd'hui, le chat Twitch de la chaîne 24/24 demain.
 * Le cycle se met en pause quand personne ne regarde.
 */
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const twitchApi = require('./twitchApi');
const Notation = require('./js/utils/notation.js');
const Stockfish = require('./stockfish');
// Langue de notation du chat Twitch du 24/24 (« Cf3 » en français) ; la page envoie celle du spectateur
const H24_LANG = process.env.H24_LANG || 'fr';

const ROOM = 'h24';
const CAM_ROOM = 'h24-cam';
// Caméra de la régie relayée par le serveur : garde-fous (le serveur ne décode jamais la vidéo)
const CAM = {
    maxChunk: 400 * 1024,          // un morceau (image clé 720p ≈ 30-80 Ko)
    rate: 600 * 1024,              // débit moyen accepté (octets/s ≈ 4,8 Mb/s)
    burst: 1.5 * 1024 * 1024,      // réserve pour les à-coups
    maxGop: 3 * 1024 * 1024,       // images gardées depuis la dernière clé (pour les nouveaux venus)
    codec: /^(avc1\.[0-9A-Fa-f]{6}|vp8)$/
};
const LOGIN_RE = /^[a-z0-9_]{2,25}$/;
const ALL_VOTED_MS = 3000;        // toute l'équipe a voté : fin du tour anticipée
// Tirage au sort : temps laissé à la roue, selon la vitesse votée (animation + coup tiré montré ~1,5 s)
const SPIN_REVEAL_MS = { fast: 4500, normal: 7500, slow: 11500 };
const BALLOT_REVEAL_MS = 4000;    // résultat d'un vote (mode, option) montré avant la suite
const RANDOM_REVEAL_MS = 1800;    // personne n'a voté : coup au hasard montré avant d'être joué
const REPLY_MS = 900;             // rush : réponse de l'adversaire
const PUZZLE_PAUSE_MS = 3000;     // rush : solution montrée avant le suivant
const SECRET_REVEAL_MS = 2500;    // vote secret : les votes dévoilés avant que le coup soit joué
const CHOSEN_MS = 2200;           // coup choisi (flèche, part des votes, viewer tiré) montré avant d'être joué

const DUR = {
    settle: 2500,     // après chaque coup : le temps de le voir avant que le vote suivant s'ouvre
    recap: 15000,
    voteMode: 20000,
    voteOption: 30000,
    signup: 30000
};

const MODES = ['teams', 'rush', 'bot'];
// Premier vote : les trois entrées (partie classique, problèmes, prédiction)
const ENTRIES = ['classic', 'rush', 'predict'];
// Mode Prédiction : le chat suit une vraie partie de tournoi, devine le coup suivant et le vainqueur
const PREDICT = {
    minBase: 600,          // cadence d'au moins 10 min (temps de base, en secondes)
    cands: 5,              // parties proposées au vote (les plus fortes)
    pollMs: 5000,          // position relue toutes les 5 s (30 s si personne ne regarde)
    idlePollMs: 30000,
    lostMs: 120000,        // partie introuvable pendant 2 min : on arrête
    flagMs: 90000,         // pendule du camp au trait à zéro depuis 1 min 30 sans résultat saisi : perte au temps
    staleMs: 90 * 60000    // aucun coup depuis 1 h 30 (diffusion figée, résultat jamais saisi) : on arrête
};
/** Points d'un bon pronostic du vainqueur : plus il est tôt, plus il rapporte */
const WINNER_PTS = (ply) => ply < 30 ? 10 : ply < 60 ? 6 : ply < 90 ? 3 : 1;
// Contre Stockfish : niveaux proposés au vote, dans l'ordre (1320 par défaut)
const VS_LEVELS = [300, 600, 900, 1320, 1500, 1800, 2100, 2400];
const VS_DEFAULT = 1320;
const VS_MIN_MS = 1500;           // Stockfish joue au plus tôt après ce délai (coup lisible)
// Options votées après le mode, une à une, choix dans l'ordre logique ; def = valeur si personne ne vote
const OPT = {
    elo: { id: 'elo', choices: VS_LEVELS, def: VS_DEFAULT },
    turn: { id: 'turn', choices: [20, 30, 45], def: 30 },
    decision: { id: 'decision', choices: ['majority', 'draw'], def: 'majority' },
    spin: { id: 'spin', choices: ['slow', 'normal', 'fast'], def: 'normal' },
    votes: { id: 'votes', choices: [1, 2, 3, 4, 5], def: 1 },
    anonymity: { id: 'anonymity', choices: ['none', 'secret'], def: 'none' }
};
const BALLOTS = {
    teams: [OPT.turn, OPT.decision, OPT.spin, OPT.votes, OPT.anonymity],
    bot: [OPT.elo, OPT.turn, OPT.decision, OPT.spin, OPT.votes, OPT.anonymity],
    rush: [OPT.turn, OPT.spin, OPT.votes, OPT.anonymity]
};
// Partie classique : contre les bots (Stockfish) ou viewers entre eux (deux équipes)
const OPPONENT = { id: 'opponent', choices: ['bot', 'teams'], def: 'teams' };
const BOT_NAMES = ['bot_fou', 'bot_tour', 'bot_pion', 'bot_dame', 'bot_roque', 'bot_gambit', 'bot_zugzwang',
    'bot_cavalier', 'bot_echec', 'bot_fianchetto', 'bot_sicilienne', 'bot_pat', 'bot_mat', 'bot_prise', 'bot_clouage', 'bot_fourchette'];
// Niveaux des bots ajoutés en nombre (sim.js h24-bots, + / - de la régie) : un mélange, du plus courant au plus rare
const BOT_MIX = [1320, 1500, 900, 1800, 600, 2100, 1500, 1320, 300, 2400, 900, 1800, 1500, 600, 2100, 1320];
// Puzzle rush : mêmes réglages que rushManager (partie du streamer)
const RUSH = { startRating: 600, ratingStep: 60, ratingSpread: 120, maxStrikes: 3 };

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
/** chess.js 1.x lève une exception sur un coup illégal : null à la place */
const tryMove = (chess, m) => { try { return chess.move(m); } catch { return null; } };

module.exports = function station({ io, verifyTwitchToken, dataDir, log = console.log, durations = {}, liveGames = null, fetchRoom = null, fetchGame = null, economy = null }) {
    Object.assign(DUR, durations);

    // ------------------------------------------------------------------ puzzles (CSV Lichess)
    let puzzleLines = null;
    function puzzleSource() {
        if (puzzleLines) return puzzleLines;
        try {
            const dir = path.join(__dirname, 'js', 'puzzles');
            const { bands } = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
            puzzleLines = bands.flatMap(b => fs.readFileSync(path.join(dir, b.file), 'utf8')
                .split('\n').slice(1).filter(l => l.trim()).map(line => {
                    const c = line.split(',', 4);
                    return { id: c[0], rating: parseInt(c[3], 10) || 0, line };
                }));
        } catch (e) {
            log('🧩 24/24 : puzzles introuvables', e.message);
            puzzleLines = [];
        }
        return puzzleLines;
    }
    /** Comme rushManager._pickNearRating : autour du rating visé, tolérance doublée tant qu'il y a moins
     *  de 5 candidats ; au-delà du CSV, un des 50 plus durs restants. Jamais deux fois le même. */
    function rushPuzzle(target, used) {
        const all = puzzleSource();
        for (let tries = 0; tries < 20; tries++) {
            let chosen = null;
            let spread = RUSH.ratingSpread;
            for (let i = 0; i < 6 && !chosen; i++, spread *= 2) {
                const cands = all.filter(p => Math.abs(p.rating - target) <= spread && !used.has(p.id));
                if (cands.length >= 5) chosen = pick(cands);
            }
            if (!chosen) {
                const rest = all.filter(p => !used.has(p.id)).sort((a, b) => b.rating - a.rating).slice(0, 50);
                if (!rest.length) return null;
                chosen = pick(rest);
            }
            used.add(chosen.id);
            const c = chosen.line.split(',');
            const moves = String(c[2] || '').trim().split(/\s+/);
            if (moves.length < 2) continue;
            try { new Chess(c[1]); } catch { continue; }
            return { id: c[0], fen: c[1], moves, rating: chosen.rating, themes: String(c[7] || '').split(' ').slice(0, 3) };
        }
        return null;
    }

    // ------------------------------------------------------------------ état
    // Au démarrage (donc après chaque déploiement), le cycle commence par l'étape 1 : le vote du mode
    const s = {
        phase: 'voteMode',
        endsAt: Date.now() + DUR.voteMode,
        paused: false,
        mode: 'teams',
        options: { turn: 30, decision: 'majority', spin: 'normal', votes: 1, anonymity: 'none', elo: VS_DEFAULT },
        vsSide: 'w',           // contre Stockfish : camp des viewers (tiré au sort à chaque partie)
        teams: { w: [], b: [] },
        ballot: { id: 'mode', choices: ['classic', 'rush'], def: 'classic', votes: new Map() },   // { id, choices, votes: Map(login → choix) }
        ballotQueue: [],
        game: null,
        recap: null,
        lastResult: null,
        cycle: 1,
        optOut: new Set()      // ont cliqué « Quitter » : pas réinscrits d'office jusqu'aux prochaines inscriptions
    };
    const sockets = new Map();   // socket.id → login (null : spectateur anonyme)

    // Régie : le PC du streamer, avec le vrai échiquier (Phantom) et la chaîne Twitch de la vue réelle.
    // Logins autorisés : H24_REGIE (séparés par des virgules) ; en local, « testeur » aussi.
    const REGIE = new Set(String(process.env.H24_REGIE || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean));
    if (process.env.STATION_DEV === '1') REGIE.add('testeur');
    const regieFile = dataDir ? path.join(dataDir, 'h24-regie.json') : null;
    const regie = { socket: null, phantom: 'off', paused: false, channel: '' };
    try { if (regieFile) regie.channel = String(JSON.parse(fs.readFileSync(regieFile, 'utf8')).channel || ''); } catch {}
    const drawMs = () => SPIN_REVEAL_MS[s.options.spin] || SPIN_REVEAL_MS.normal;
    // ------------------------------------------------------------------ statistiques (parties et votes d'options, gardés sur disque)
    const statsFile = dataDir ? path.join(dataDir, 'h24-stats.json') : null;
    const statsDb = { games: [], ballots: [] };
    try {
        if (statsFile) {
            const raw = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
            if (Array.isArray(raw.games)) statsDb.games = raw.games;
            if (Array.isArray(raw.ballots)) statsDb.ballots = raw.ballots;
        }
    } catch {}
    const STATS_KEEP = 5000;
    let statsTimer = null;
    function saveStats() {
        if (!statsFile || statsTimer) return;
        statsTimer = setTimeout(() => {
            statsTimer = null;
            const tmp = statsFile + '.tmp';
            fs.writeFile(tmp, JSON.stringify(statsDb), (err) => {
                if (err) return log('📊 24/24 : stats non enregistrées', err.message);
                fs.rename(tmp, statsFile, () => {});
            });
        }, 1500);
    }
    function recordGame(g, result) {
        const teams = s.mode !== 'rush';
        statsDb.games.push({
            at: Date.now(),
            mode: s.mode,
            opts: { ...s.options },
            result,
            plies: teams ? g.history.length : 0,
            ms: Date.now() - g.startedAt,
            moves: teams ? g.history.slice(0, 600) : undefined,
            hv: teams ? g.hv.slice(0, 600) : undefined,
            rush: teams ? undefined : { solved: g.score.solved, maxRating: g.score.maxRating, strikes: g.score.strikes, puzzles: g.puzzleIndex || 0 },
            tally: g.tally,
            teams: { w: [...s.teams.w], b: [...s.teams.b] },
            votes: { w: Object.fromEntries(g.voteCount.w), b: Object.fromEntries(g.voteCount.b) },
            hits: teams ? Object.fromEntries(g.hits) : undefined,
            key: teams ? g.key || undefined : undefined,
            vs: s.mode === 'bot' ? { elo: s.options.elo, side: s.vsSide } : undefined,
            bots: botCount()
        });
        if (statsDb.games.length > STATS_KEEP) statsDb.games.splice(0, statsDb.games.length - STATS_KEEP);
        saveStats();
    }
    function recordBallot(b) {
        statsDb.ballots.push({ at: Date.now(), id: b.id, mode: b.id === 'mode' ? null : s.mode, winner: b.winner, how: b.how, n: b.votes.size, bots: botCount() });
        if (statsDb.ballots.length > STATS_KEEP) statsDb.ballots.splice(0, statsDb.ballots.length - STATS_KEEP);
        saveStats();
    }

    /** Stats globales : bots = inclure les parties jouées avec des bots de test ; tz = décalage horaire du viewer (min) ; days = période */
    function stats({ bots = true, tz = 0, days = 0 } = {}) {
        const now = Date.now();
        const keep = (x) => (bots || !x.bots) && (!days || x.at >= now - days * 86400000);
        const games = statsDb.games.filter(keep);
        const ballots = statsDb.ballots.filter(keep);
        const human = (l) => !!l && !/^(bot_|sim_)/.test(l);
        const top = (map, n = 10) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, n: v }));
        const inc = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);

        const teamGames = games.filter(x => x.mode === 'teams');
        const rushGames = games.filter(x => x.mode === 'rush');
        const players = new Set(), voters = new Map(), winners = new Map(), played = new Map(), hits = new Map();
        const vsLevels = {};
        let bestBeaten = null;
        const firstMoves = new Map(), openings = new Map(), moves = new Map(), reasons = {};
        const hours = Array(24).fill(0);
        const dayMs = 86400000;
        const today = Math.floor((now - tz * 60000) / dayMs);
        const perDay = Array(14).fill(0);
        let votes = 0, playMs = 0, peak = 0, random = 0, wheel = 0, ties = 0, consSum = 0, consN = 0;
        const res = { w: 0, b: 0, draw: 0 };
        let longest = null, fastestMate = null, plies = 0;
        const decision = { majority: 0, draw: 0 };
        for (const x of games) {
            playMs += x.ms || 0;
            peak = Math.max(peak, x.tally?.peak || 0);
            const local = x.at - tz * 60000;
            hours[new Date(local).getUTCHours()]++;
            const d = today - Math.floor(local / dayMs);
            if (d >= 0 && d < 14) perDay[13 - d]++;
            const inGame = new Set();
            for (const side of ['w', 'b']) {
                for (const [l, n] of Object.entries(x.votes?.[side] || {})) {
                    votes += n;
                    if (human(l)) { inc(voters, l, n); inGame.add(l); }
                }
                for (const l of x.teams?.[side] || []) if (human(l)) inGame.add(l);
            }
            for (const l of inGame) { players.add(l); inc(played, l); }
            for (const [l, n] of Object.entries(x.hits || {})) if (human(l)) inc(hits, l, n);
            if (x.mode === 'bot' && x.vs) {
                const r = x.result || {};
                const lv = vsLevels[x.vs.elo] ||= { elo: x.vs.elo, games: 0, win: 0, draw: 0, loss: 0 };
                lv.games++;
                if (r.kind !== 'mate') lv.draw++;
                else if (r.winner === x.vs.side) { lv.win++; if (!bestBeaten || x.vs.elo > bestBeaten.elo) bestBeaten = { elo: x.vs.elo, at: x.at, plies: x.plies }; }
                else lv.loss++;
            }
            if (x.mode !== 'teams') continue;
            plies += x.plies || 0;
            random += x.tally?.random || 0;
            wheel += x.tally?.wheel || 0;
            ties += x.tally?.ties || 0;
            decision[x.opts?.decision === 'draw' ? 'draw' : 'majority']++;
            for (const v of x.hv || []) if (typeof v === 'number') { consSum += v; consN++; }
            const r = x.result || {};
            if (r.kind === 'mate') {
                res[r.winner === 'b' ? 'b' : 'w']++;
                for (const l of x.teams?.[r.winner] || []) if (human(l)) inc(winners, l);
                if (!fastestMate || x.plies < fastestMate.plies) fastestMate = { plies: x.plies, at: x.at, winner: r.winner };
            } else {
                res.draw++;
                reasons[r.reason || 'draw'] = (reasons[r.reason || 'draw'] || 0) + 1;
            }
            if (!longest || x.plies > longest.plies) longest = { plies: x.plies, at: x.at, result: r };
            const mv = x.moves || [];
            if (mv[0]) inc(firstMoves, mv[0]);
            if (mv[1]) inc(openings, `${mv[0]} ${mv[1]}`);
            for (const m of mv) inc(moves, m);
        }
        let bestRush = null, rushSolved = 0;
        for (const x of rushGames) {
            const r = x.rush || x.result || {};
            rushSolved += r.solved || 0;
            if (!bestRush || (r.solved || 0) > bestRush.solved || ((r.solved || 0) === bestRush.solved && (r.maxRating || 0) > bestRush.maxRating))
                bestRush = { solved: r.solved || 0, maxRating: r.maxRating || 0, at: x.at };
        }
        const ballotStats = {};
        for (const b of ballots) {
            const o = ballotStats[b.id] ||= { total: 0, none: 0, counts: {} };
            o.total++;
            if (b.how === 'default') o.none++;
            o.counts[b.winner] = (o.counts[b.winner] || 0) + 1;
        }
        return {
            since: statsDb.games[0]?.at || null,
            overview: { games: games.length, teams: teamGames.length, rush: rushGames.length, plies, votes, players: players.size, playMs, peak },
            results: { ...res, reasons, avgPlies: teamGames.length ? Math.round(plies / teamGames.length) : 0,
                avgMs: teamGames.length ? Math.round(teamGames.reduce((a, x) => a + (x.ms || 0), 0) / teamGames.length) : 0, longest, fastestMate },
            decisions: { ...decision, turns: plies, random, wheel, ties, consensus: consN ? Math.round(consSum / consN) : null },
            openings: { first: top(firstMoves, 8), pairs: top(openings, 8), moves: top(moves, 10) },
            rush: { games: rushGames.length, best: bestRush, avgSolved: rushGames.length ? Math.round(rushSolved * 10 / rushGames.length) / 10 : 0,
                bestRating: Math.max(0, ...rushGames.map(x => (x.rush || x.result || {}).maxRating || 0)) },
            ballots: ballotStats,
            players: { voters: top(voters), winners: top(winners), played: top(played), hits: top(hits) },
            vsBot: { games: games.filter(x => x.mode === 'bot').length, levels: Object.values(vsLevels).sort((a, b) => a.elo - b.elo), bestBeaten },
            activity: { hours, days: perDay },
            recent: games.slice(-12).reverse().map(x => ({ at: x.at, mode: x.mode, result: x.result, plies: x.plies, ms: x.ms,
                players: (x.teams?.w?.length || 0) + (x.teams?.b?.length || 0), bots: x.bots || 0, decision: x.opts?.decision, vs: x.vs }))
        };
    }
    // Chat Twitch de chaque compte connecté à la page (sa propre chaîne), lu en anonyme : join, coups et votes (1, 2, 3…)
    const chat = { client: null, connected: false, joined: new Set(), queue: [], lastWanted: new Map(), seen: new Map(), recent: [], received: 0, events: [] };
    const CHAT_LINGER_MS = 2 * 60 * 1000;   // chaîne gardée 2 min après le départ (rechargement de page)
    const chatEvent = (e) => { chat.events.push(`${new Date().toISOString()} ${e}`); if (chat.events.length > 15) chat.events.shift(); };
    const CHAT_KEEP_MS = 20 * 60 * 1000;   // réinscrit d'office au cycle suivant s'il a joué récemment
    // Caméra de la régie : un seul émetteur à la fois, rien n'est enregistré
    const cam = { socket: null, cfg: null, gop: [], gopBytes: 0, seq: 0, tokens: CAM.burst, at: 0 };
    function stopCam(id) {
        if (!cam.socket || (id && cam.socket !== id)) return;
        cam.socket = null;
        cam.cfg = null;
        cam.gop = [];
        cam.gopBytes = 0;
        io.to(CAM_ROOM).emit('h24:cam:off');
        emit();
    }
    /** Pourquoi la station attend : personne ne regarde, la régie a mis en pause, le Phantom bouge ou décroche */
    // Prédiction : la partie suit la diffusion, le Phantom ne fait que la recopier ; il ne retient pas la station
    const holdReason = () => viewers() === 0 ? 'idle'
        : regie.paused ? 'regie'
        : (regie.phantom === 'busy' || regie.phantom === 'error') && !(s.phase === 'play' && s.game?.predict) ? 'phantom' : null;

    const allPlayers = () => [...s.teams.w, ...s.teams.b];
    /** Une équipe joue son camp, et aussi l'autre tant qu'il n'a aucun joueur */
    // Camp sans joueur : l'autre équipe le joue aussi (sauf contre Stockfish : c'est le sien)
    const canPlay = (team, side) => !!team && (team === side || (s.mode !== 'bot' && !s.teams[side].length));
    const teamOf = (login) => s.teams.w.includes(login) ? 'w' : s.teams.b.includes(login) ? 'b' : null;
    const viewers = () => sockets.size;

    // ------------------------------------------------------------------ diffusion
    let emitTimer = null;
    // Photos Twitch arrivées (lot Helix) : le bandeau des votes se complète
    twitchApi.onAvatars(() => emit());
    function emit() {
        if (emitTimer) return;
        emitTimer = setTimeout(() => {
            emitTimer = null;
            io.to(ROOM).emit('h24:state', publicState());
        }, 120);
    }
    function publicState() {
        const g = s.game;
        const hidden = !!g && s.options.anonymity === 'secret' && !!g.turnEndsAt;
        const tally = (map) => {
            const counts = {};
            for (const v of map.values()) for (const x of [].concat(v)) counts[x] = (counts[x] || 0) + 1;
            return Object.entries(counts).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
        };
        return {
            now: Date.now(),
            cycle: s.cycle,
            phase: s.phase,
            endsAt: s.endsAt,
            paused: s.paused,
            pauseReason: s.pauseReason || null,
            regie: { live: !!regie.socket, phantom: regie.phantom, paused: regie.paused, channel: regie.channel, cam: !!cam.socket },
            mode: s.mode,
            options: s.options,
            teams: s.teams,
            viewers: viewers(),
            ballot: s.ballot && { id: s.ballot.id, choices: s.ballot.choices, games: s.ballot.games || null, tally: tally(s.ballot.votes), total: s.ballot.votes.size, winner: s.ballot.winner, how: s.ballot.how,
                recent: (s.ballot.recent || []).slice(-20).map(r => tickerItem(r, { c: r.c })), recentN: s.ballot.recentN || 0 },
            bots: botCount(),
            botList: botList(),
            vs: s.mode === 'bot' ? { side: s.vsSide, elo: s.options.elo, thinking: !!g?.engine && !g?.result } : null,
            next: s.ballotQueue.map(b => b.id),
            // Réglages du mode en cours de vote : la jauge des étapes faites / restantes
            plan: s.phase === 'voteOptions' && BALLOTS[s.mode] ? BALLOTS[s.mode].map(b => b.id) : null,
            // Prédiction : parties proposées au prochain vote du mode
            predictCands: pred.cands.length,
            recap: s.recap,
            game: g && {
                fen: g.chess.fen(),
                turn: g.chess.turn(),
                history: g.history,
                hv: g.hv || [],
                startFen: g.startFen,
                lastMove: g.lastMove,
                turnEndsAt: g.turnEndsAt,
                settle: !!g.settle,
                // Vote secret : rien de visible avant la fin du tour, seulement le nombre de votes
                // (prédiction : les devinettes restent cachées jusqu'au coup joué)
                votes: hidden || g.predict ? [] : tally(g.votes).map(({ k, n }) => ({ move: k, count: n })),
                predict: g.predict ? predictPublic(g) : null,
                // Tableau des votants (comme sur la page Tournois) : pseudo, photo et coup, votes visibles seulement
                ballots: hidden || g.predict ? null : [...g.votes].slice(-80).flatMap(([u, l]) => l.map(m => tickerItem({ u, v: g.voteVia?.get(u) || null }, { m }))),
                secret: hidden ? [...g.votes.values()].reduce((a, v) => a + v.length, 0) : false,
                masked: hidden ? tally(g.votes).map(({ n }) => n) : null,
                voters: g.votes.size,
                // Bandeau des votes : pseudo et coup (coup caché en vote secret) ; recentN compte les votes du tour
                recent: g.recent.slice(-20).map(r => tickerItem(r, { m: hidden ? null : r.m })),
                recentN: g.recentN || 0,
                // photo du votant mis en avant : relue à chaque envoi (elle arrive parfois après le tirage)
                draw: withPic(g.draw),
                chosen: withPic(g.chosen) || null,
                random: g.random,
                result: g.result,
                // rush
                puzzle: g.puzzle && { index: g.puzzleIndex, rating: g.puzzle.rating, themes: g.puzzle.themes, side: g.side, status: g.puzzleStatus },
                score: g.score && { ...g.score, maxStrikes: RUSH.maxStrikes }
            }
        };
    }
    function emitMe(socketId) {
        const login = sockets.get(socketId);
        const sock = io.sockets.sockets.get(socketId);
        if (!sock) return;
        sock.emit('h24:me', {
            login,
            regie: !!login && REGIE.has(login),
            team: login ? teamOf(login) : null,
            votes: login && s.game ? s.game.votes.get(login) || [] : [],
            maxVotes: s.options.votes || 1,
            chat: !!login && chat.connected && chat.joined.has(login),   // son chat Twitch est lu
            ballot: login && s.ballot ? s.ballot.votes.get(login) ?? null : null,
            // Prédiction : mon pronostic du vainqueur et mes points
            winner: login && s.game?.winners ? s.game.winners.get(login)?.w || null : null,
            pts: login && s.game?.scores ? s.game.scores.get(login)?.pts || 0 : 0,
            hits: login && s.game?.scores ? s.game.scores.get(login)?.hits || 0 : 0,
            tries: login && s.game?.scores ? s.game.scores.get(login)?.tries || 0 : 0,
            coins: login && s.game?.scores ? s.game.scores.get(login)?.coins || 0 : 0
        });
    }
    function emitMeAll(login) {
        for (const [id, l] of sockets) if (!login || l === login) emitMe(id);
    }

    // ------------------------------------------------------------------ phases
    function setPhase(phase, ms) {
        s.phase = phase;
        s.endsAt = ms == null ? null : Date.now() + ms;
        emit();
    }

    function startModeVote(ready = false) {
        // Pas encore de partie à suivre (serveur tout juste relancé, partie vedette Lichess finie…) : le récap
        // patiente le temps de les relire (12 s au plus) pour que « Prédiction » soit là dès l'ouverture du vote
        if (!ready && liveGames && !pred.cands.length && s.phase === 'recap' && Date.now() - (pred.heldAt || 0) > 60000) {
            pred.heldAt = Date.now();
            s.endsAt = Date.now() + 12000;
            emit();
            const cycle = s.cycle;
            refreshCands().then(() => {
                if (s.phase === 'recap' && s.cycle === cycle && !s.paused && pred.cands.length) startModeVote(true);
            });
            return;
        }
        s.recap = null;
        // Prédiction proposée seulement s'il y a des parties longues en direct
        s.ballot = { id: 'mode', choices: ENTRIES.filter(m => m !== 'predict' || pred.cands.length), def: 'classic', votes: new Map() };
        s.ballotQueue = [];
        refreshCands();
        setPhase('voteMode', DUR.voteMode);
        emitMeAll();
    }

    /** Ferme le vote en cours ; forced = choix imposé par la régie (clic sur une option) */
    function closeBallot(forced) {
        const b = s.ballot;
        const counts = {};
        for (const v of b.votes.values()) counts[v] = (counts[v] || 0) + 1;
        const best = Math.max(0, ...Object.values(counts));
        // Personne n'a voté : valeur par défaut ; égalité : tirage parmi les ex æquo
        const tied = b.choices.filter(c => counts[c] === best);
        const winner = forced !== undefined ? forced : best === 0 ? (b.def ?? b.choices[0]) : pick(tied);
        // Résultat affiché quelques secondes, comme pour un coup, avant le vote suivant
        b.winner = winner;
        b.how = forced !== undefined ? 'regie' : best === 0 ? 'default' : tied.length > 1 ? 'tie' : 'votes';
        try { recordBallot(b); } catch {}
        s.endsAt = null;
        emit();
        later(BALLOT_REVEAL_MS, () => {
            const game = b.id === 'mode' && winner === 'predict' ? gameBallot() : null;
            if (b.id === 'mode' && (winner === 'classic' || (winner === 'predict' && !game))) {
                // Partie classique (ou plus de partie en direct à suivre) : contre les bots ou viewers entre eux
                s.mode = 'classic';
                s.ballotQueue = [{ ...OPPONENT }];
            } else if (b.id === 'mode' && winner === 'predict') {
                s.mode = 'predict';
                s.ballotQueue = [game];
            } else if (b.id === 'mode') {
                s.mode = winner;
                s.ballotQueue = BALLOTS[winner].map(x => ({ ...x }));
            } else if (b.id === 'opponent') {
                s.options.opponent = winner;
                s.mode = winner;
                s.ballotQueue = BALLOTS[winner].map(x => ({ ...x }));
            } else if (b.id === 'game') {
                s.predictPick = b.games?.[winner] || null;
            } else {
                s.options[b.id] = winner;
            }
            s.ballot = null;
            nextBallot();
        });
    }

    function nextBallot() {
        const b = s.ballotQueue.shift();
        if (!b && s.mode === 'predict') return startPredict();
        if (!b && s.mode === 'classic') s.mode = s.options.opponent || 'teams';
        if (!b) {
            s.teams = { w: [], b: [] };
            s.optOut.clear();
            if (s.mode === 'bot') s.vsSide = pick(['w', 'b']);
            setPhase('signup', DUR.signup);
            autoJoin();
            emitMeAll();
            return;
        }
        s.ballot = { id: b.id, choices: b.choices, def: b.def, games: b.games, votes: new Map() };
        setPhase('voteOptions', DUR.voteOption);
        emitMeAll();
    }

    function startGame() {
        if (s.mode === 'classic') s.mode = s.options.opponent || 'teams';
        if (s.mode === 'predict') return startPredict();
        s.cycle++;
        s.ballot = null;
        s.recap = null;
        if (s.mode === 'bot' && !['w', 'b'].includes(s.vsSide)) s.vsSide = 'w';
        if (s.mode === 'rush') {
            s.game = newGameState(new Chess());
            s.game.score = { solved: 0, strikes: 0, maxRating: 0 };
            s.game.used = new Set();
            s.game.puzzleIndex = 0;
            s.phase = 'play';
            nextPuzzle();
        } else {
            s.game = newGameState(new Chess());
            s.phase = 'play';
            startTurn();
        }
        emitMeAll();
    }

    function newGameState(chess) {
        return { chess, startFen: chess.fen(), history: [], hv: [], lastMove: null, votes: new Map(), recent: [],
            turnEndsAt: null, draw: null, random: false, result: null, startedAt: Date.now(),
            voteCount: { w: new Map(), b: new Map() },
            hits: new Map(),      // login → nombre de ses coups joués (MVP)
            key: null,            // coup du match : le plus disputé { san, ply, pct, total, side }
            tally: { random: 0, wheel: 0, ties: 0, peak: viewers() } };   // pour les stats
    }

    function startTurn() {
        const g = s.game;
        if (s.mode === 'bot' && g.chess.turn() !== s.vsSide) return engineTurn();
        g.engine = false;
        g.settle = false;
        g.votes = new Map();
        g.recent = [];
        g.recentN = 0;
        g.draw = null;
        g.chosen = null;
        // Même durée pour les deux camps (une équipe vide est jouée par l'autre)
        g.turnEndsAt = Date.now() + (DUR.turn || s.options.turn * 1000);
        s.endsAt = g.turnEndsAt;
        if (g.tally) g.tally.peak = Math.max(g.tally.peak, viewers());
        emit();
        emitMeAll();
    }

    /**
     * Après un coup : une courte pause (coup surligné, « vote dans 3 s ») avant d'ouvrir le vote suivant.
     * Le décompte passe par tick() : il s'arrête avec la pause (régie, Phantom qui bouge les pièces).
     * Le tour de Stockfish n'attend pas : il prend déjà son temps.
     */
    function startTurnSoon() {
        const g = s.game;
        if (s.mode === 'bot' && g.chess.turn() !== s.vsSide) return startTurn();
        g.engine = false;
        g.votes = new Map();
        g.recent = [];
        g.recentN = 0;
        g.draw = null;
        g.chosen = null;
        g.turnEndsAt = null;
        g.settle = true;
        s.endsAt = Date.now() + DUR.settle;
        emit();
        emitMeAll();
    }

    /** Contre Stockfish : le moteur joue son coup (au niveau voté), pas avant VS_MIN_MS, jamais pendant une pause */
    function engineTurn() {
        const g = s.game;
        g.engine = true;
        g.settle = false;
        g.votes = new Map();
        g.recent = [];
        g.recentN = 0;
        g.draw = null;
        g.chosen = null;
        g.turnEndsAt = null;
        s.endsAt = null;
        emit();
        emitMeAll();
        const fen = g.chess.fen();
        const t0 = Date.now();
        const fallback = () => pick(g.chess.moves());
        Stockfish.botMove(fen, s.options.elo).catch(() => null).then((san) => {
            const play = () => {
                if (s.game !== g || g.result || g.chess.fen() !== fen) return;
                if (s.paused) return later(1000, play);
                playMove(san || fallback());
            };
            if (s.game !== g) return;
            later(Math.max(0, VS_MIN_MS - (Date.now() - t0)), play);
        });
    }

    /** Coup retenu : part des votes et un viewer tiré parmi ceux qui l'ont voté (mis en avant sur l'échiquier) */
    function chosenInfo(move) {
        let total = 0, n = 0;
        const fans = [];
        for (const [login, list] of s.game.votes) for (const m of list) { total++; if (m === move) { n++; fans.push(login); } }
        const voter = fans.length ? pick(fans) : null;
        // Provenance de son vote (chat d'une chaîne ou site) et sa photo Twitch, pour l'étiquette de la flèche
        const via = voter ? [...(s.game.recent || [])].reverse().find(r => r.u === voter && r.m === move)?.v || null : null;
        return { move, n, total, pct: total ? Math.round(n * 100 / total) : 0, voter,
            via: via === 'bot' ? null : via, bot: via === 'bot' };
    }

    /** Coup choisi à la fin du tour : majorité (ex æquo tirés au sort), tirage pondéré, ou hasard sans vote */
    function resolveTurn() {
        const g = s.game;
        g.turnEndsAt = null;
        const counts = {};
        for (const list of g.votes.values()) for (const m of list) counts[m] = (counts[m] || 0) + 1;
        const entries = Object.entries(counts);
        let move;
        g.random = false;
        if (!entries.length) {
            g.random = true;
            if (s.mode === 'rush') return failPuzzle('timeout');
            g.tally.random++;
            // Personne n'a voté : tirage à la roue (ou à la bande) entre tous les coups légaux, à chances égales
            const legal = g.chess.moves();
            move = pick(legal);
            g.draw = { winner: move, votes: legal.map(m => ({ m, n: 1 })), random: true, endsAt: Date.now() + drawMs(), stop: 0.15 + Math.random() * 0.7 };
            s.endsAt = g.draw.endsAt;
            emit();
            return later(drawMs(), () => playMove(move));
        } else if (s.options.decision !== 'majority' && s.mode !== 'rush' && entries.length > 1) {
            const total = entries.reduce((a, [, n]) => a + n, 0);
            let r = Math.random() * total;
            move = entries.find(([, n]) => (r -= n) < 0)?.[0] || entries[0][0];
            g.tally.wheel++;
            g.draw = { winner: move, votes: entries.map(([m, n]) => ({ m, n })), endsAt: Date.now() + drawMs(), stop: 0.15 + Math.random() * 0.7, ...(({ voter, pct, via, bot }) => ({ voter, pct, via, bot }))(chosenInfo(move)) };
            s.endsAt = g.draw.endsAt;
            emit();
            return later(drawMs(), () => playMove(move));
        } else {
            const best = Math.max(...entries.map(([, n]) => n));
            const tied = entries.filter(([, n]) => n === best);
            move = pick(tied.map(([m]) => m));
            // Ex æquo : tirage au sort visible entre eux, à chances égales
            if (tied.length > 1) {
                g.tally.ties++;
                g.draw = { winner: move, votes: tied.map(([m, n]) => ({ m, n })), tie: true, endsAt: Date.now() + drawMs(), stop: 0.15 + Math.random() * 0.7, ...(({ voter, pct, via, bot }) => ({ voter, pct, via, bot }))(chosenInfo(move)) };
                s.endsAt = g.draw.endsAt;
                emit();
                return later(drawMs(), () => playMove(move));
            }
        }
        // Coup retenu mis en avant (flèche, %, viewer) un instant avant d'être joué ;
        // en vote secret, c'est aussi le moment où les votes se dévoilent
        g.chosen = chosenInfo(move);
        s.endsAt = null;
        emit();
        later(s.options.anonymity === 'secret' ? Math.max(SECRET_REVEAL_MS, CHOSEN_MS) : CHOSEN_MS, () => playMove(move));
    }

    function playMove(san) {
        const g = s.game;
        if (!g || g.result) return;
        if (s.mode === 'rush') return checkPuzzleMove(san);
        const m = tryMove(g.chess, san);
        if (!m) return startTurn();
        // Pour l'historique : part des votes du coup joué, ou « r » (hasard, personne n'a voté)
        let total = 0, mine = 0;
        const options = new Set();
        for (const list of g.votes.values()) for (const x of list) { total++; options.add(x); if (x === m.san) mine++; }
        g.hv.push(g.engine ? null : g.random || !total ? 'r' : Math.round(mine * 100 / total));
        if (!g.engine && !g.random && total) {
            // MVP : chaque votant du coup joué marque un point
            for (const [login, list] of g.votes) if (list.includes(m.san)) g.hits.set(login, (g.hits.get(login) || 0) + 1);
            // Coup du match : le plus disputé (part la plus faible, au moins deux coups en lice)
            const pct = Math.round(mine * 100 / total);
            if (options.size > 1 && (!g.key || pct <= g.key.pct)) g.key = { san: m.san, ply: g.history.length, pct, total, side: m.color };
        }
        g.engine = false;
        g.history.push(m.san);
        g.lastMove = { from: m.from, to: m.to };
        g.draw = null;
        g.chosen = null;
        // Seules les fins prévues par les règles : mat, pat, répétition, 50 coups, matériel insuffisant
        if (g.chess.isGameOver()) return endGame();
        startTurnSoon();
    }

    // ------------------------------------------------------------------ puzzle rush
    function nextPuzzle() {
        const g = s.game;
        if (g.score.strikes >= RUSH.maxStrikes) return endGame();
        const p = rushPuzzle(RUSH.startRating + g.score.solved * RUSH.ratingStep, g.used);
        if (!p) return endGame();
        g.puzzleIndex++;
        g.puzzle = p;
        g.step = 0;
        g.chess = new Chess(p.fen);
        g.startFen = p.fen;
        g.history = [];
        g.lastMove = null;
        g.votes = new Map();
        g.wrong = null;
        g.puzzleStatus = 'playing';
        // Premier coup : celui de l'adversaire, puis l'équipe cherche la suite
        later(REPLY_MS, () => {
            applyUci(p.moves[0]);
            g.step = 1;
            g.side = g.chess.turn();
            startTurnSoon();
        });
        g.side = g.chess.turn() === 'w' ? 'b' : 'w';
        g.turnEndsAt = null;
        s.endsAt = null;
        emit();
    }
    function applyUci(uci) {
        const g = s.game;
        const m = tryMove(g.chess, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        if (m) { g.history.push(m.san); g.lastMove = { from: m.from, to: m.to }; }
        return m;
    }
    function checkPuzzleMove(san) {
        const g = s.game;
        const expected = g.puzzle.moves[g.step];
        const test = new Chess(g.chess.fen());
        const m = tryMove(test, san);
        if (!m) return startTurn();
        const ok = m.from + m.to + (m.promotion || '') === expected || (test.isCheckmate());
        if (!ok) return failPuzzle('wrong', san);
        g.chess.move(san);
        g.history.push(m.san);
        g.lastMove = { from: m.from, to: m.to };
        g.step++;
        if (g.step >= g.puzzle.moves.length || g.chess.isCheckmate()) return solvePuzzle();
        g.turnEndsAt = null;
        s.endsAt = null;
        emit();
        later(REPLY_MS, () => {
            applyUci(g.puzzle.moves[g.step]);
            g.step++;
            if (g.step >= g.puzzle.moves.length) return solvePuzzle();
            startTurnSoon();
        });
    }
    function solvePuzzle() {
        const g = s.game;
        g.score.solved++;
        g.score.maxRating = Math.max(g.score.maxRating, g.puzzle.rating || 0);
        g.puzzleStatus = 'solved';
        g.turnEndsAt = null;
        s.endsAt = Date.now() + PUZZLE_PAUSE_MS;
        emit();
        later(PUZZLE_PAUSE_MS, nextPuzzle);
    }
    function failPuzzle(reason, san = null) {
        const g = s.game;
        // Mauvais coup ou aucun vote dans le temps : une erreur (3 et le rush s'arrête)
        g.score.strikes++;
        g.puzzleStatus = reason === 'timeout' ? 'timeout' : 'failed';
        g.wrong = san;
        g.turnEndsAt = null;
        // La bonne réponse s'affiche sur l'échiquier
        const sol = g.puzzle.moves[g.step];
        if (sol) applyUci(sol);
        s.endsAt = Date.now() + PUZZLE_PAUSE_MS;
        emit();
        later(PUZZLE_PAUSE_MS, nextPuzzle);
    }

    // ------------------------------------------------------------------ fin de partie
    function endGame() {
        const g = s.game;
        if (g?.predict) return endPredict({ kind: 'stopped' });
        const c = g.chess;
        let result;
        if (s.mode === 'rush') {
            result = { kind: 'rush', solved: g.score.solved, maxRating: g.score.maxRating };
        } else if (c.isCheckmate()) {
            result = { kind: 'mate', winner: c.turn() === 'w' ? 'b' : 'w' };
        } else {
            // 50 coups de chaque camp sans prise ni coup de pion : 100 demi-coups (5e champ du FEN)
            const fifty = Number(c.fen().split(' ')[4]) >= 100;
            const reason = c.isStalemate() ? 'stalemate' : c.isInsufficientMaterial() ? 'material'
                : c.isThreefoldRepetition() ? 'repetition' : fifty ? 'fifty' : 'draw';
            result = { kind: 'draw', reason };
        }
        g.result = result;
        g.turnEndsAt = null;
        const top = (side) => [...g.voteCount[side].entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([login, n]) => ({ login, n }));
        // MVP : le plus de coups retenus, puis le moins de votes pour y arriver
        const votesOf = (l) => (g.voteCount.w.get(l) || 0) + (g.voteCount.b.get(l) || 0);
        const mvpEntry = [...g.hits.entries()].sort((a, b) => b[1] - a[1] || votesOf(a[0]) - votesOf(b[0]))[0];
        const mvp = mvpEntry ? { login: mvpEntry[0], n: mvpEntry[1], votes: votesOf(mvpEntry[0]), side: teamOf(mvpEntry[0]) } : null;
        s.recap = {
            mode: s.mode,
            result,
            plies: g.history.length,
            durationMs: Date.now() - g.startedAt,
            players: { w: s.teams.w.length, b: s.teams.b.length },
            top: { w: top('w'), b: top('b') },
            mvp,
            key: g.key,
            vs: s.mode === 'bot' ? { elo: s.options.elo, side: s.vsSide } : null
        };
        s.lastResult = result;
        try { recordGame(g, result); } catch (e) { log('📊 24/24 : partie non comptée', e.message); }
        // Parties à suivre relues pendant le récap : « Prédiction » est là dès l'ouverture du vote du mode
        refreshCands();
        setPhase('recap', DUR.recap);
    }

    // ------------------------------------------------------------------ prédiction (vraie partie de tournoi)
    const pred = { cands: [], timer: null };
    /** Parties candidates : en direct, cadence d'au moins 10 min, les plus fortes (somme des Elo) */
    function refreshCands() {
        if (!liveGames) return Promise.resolve();
        return Promise.resolve().then(liveGames).then(list => {
            // Les parties les plus jeunes d'abord (à égalité, l'ordre d'origine : les plus fortes)
            // (pas de plafond de coups : si aucune ne commence, on prend les moins avancées, le mode reste proposé)
            // Parties commencées il y a plus de 12 h : sans doute figées, écartées
            const moveNo = (x) => parseInt(String(x.fen).split(' ')[5], 10) || 1;
            const fresh = (x) => !x.startAt || Date.now() - Date.parse(x.startAt) < 12 * 3600e3 || Number.isNaN(Date.parse(x.startAt));
            pred.cands = (list || []).filter(x => parseInt(String(x.tc || '').replace(/^\d+\//, ''), 10) >= PREDICT.minBase && x.room?.slug && x.id && x.fen && fresh(x))
                .map((x, i) => ({ x, i })).sort((a, b) => moveNo(a.x) - moveNo(b.x) || a.i - b.i).map(o => o.x)
                .slice(0, PREDICT.cands);
            // Parties arrivées pendant le vote du mode (premier vote après un démarrage) : on ajoute la Prédiction
            const b = s.ballot;
            if (pred.cands.length && s.phase === 'voteMode' && b?.id === 'mode' && b.winner == null && !b.choices.includes('predict')) {
                b.choices = [...b.choices, 'predict'];
                emit();
            }
        }).catch(() => {});
    }
    refreshCands();
    // Liste tenue à jour en continu (sinon vide ou périmée au vote du mode, et « Prédiction » arrive en retard) ;
    // les sources sont en cache (30 s chess.com, 60 s Lichess TV) : relire souvent ne coûte presque rien
    setInterval(refreshCands, 30 * 1000).unref?.();
    /** Vote de la partie à suivre : g0…g4 (le chat tape 1 à 5), la plus forte par défaut */
    function gameBallot() {
        if (!pred.cands.length) return null;
        const games = {};
        pred.cands.forEach((x, i) => {
            games['g' + i] = { room: x.room.slug, roomName: x.room.name, event: x.event?.name || '', round: x.round, slug: x.slug, id: x.id,
                white: x.white, black: x.black, fen: x.fen, tc: x.tc };
        });
        return { id: 'game', choices: Object.keys(games), def: 'g0', games };
    }
    const placeTurn = (fen) => String(fen).split(' ').slice(0, 2).join(' ');
    function scoreOf(g, login) {
        let sc = g.scores.get(login);
        if (!sc) g.scores.set(login, sc = { pts: 0, hits: 0, win: 0, streak: 0, coins: 0, xp: 0 });
        return sc;
    }
    // Prédiction : XP et pions sur le compte du devin (site ou chat Twitch lu par le serveur), mêmes règles que la page Tournois.
    // Le compte est créé au besoin : un viewer qui n'a jamais ouvert le site est crédité aussi. Les bots ne gagnent rien.
    const PR = () => economy?.RULES?.predict;
    function payPredict(g, login, sc, { xp, coins, key = null }) {
        if (!economy || !PR() || /^(bot_|sim_)/.test(login) || !LOGIN_RE.test(login)) return;
        try {
            const r = economy.grant(login, 'predict', { xp, coins, capped: true, key });
            sc.xp += r?.xp || 0;
            sc.coins += r?.coins || 0;
            economy.checkAchievements?.(login);
        } catch (e) { log('🔮 24/24 : gain non crédité', login, e.message); }
    }
    /** Classement des devins : points, puis coups trouvés */
    const predictBoard = (g, n) => [...g.scores.entries()].filter(([, x]) => x.pts > 0)
        .sort((a, b) => b[1].pts - a[1].pts || b[1].hits - a[1].hits).slice(0, n)
        .map(([login, x]) => ({ login, pts: x.pts, hits: x.hits, win: x.win, w: g.winners.get(login)?.w || null, p: /^(bot_|sim_)/.test(login) ? null : twitchApi.avatar(login) }));
    function winnerCounts(g) {
        const c = { w: 0, d: 0, b: 0 };
        for (const x of g.winners.values()) c[x.w]++;
        return c;
    }
    function predictPublic(g) {
        const guesses = [...g.votes].slice(-60).map(([u, l]) => tickerItem({ u, v: g.guessVia?.get(u) || null }, { m: l[0] }));
        return { ...g.predict, clocks: g.clocks, lastHit: g.lastHit, winners: winnerCounts(g), board: predictBoard(g, 8),
            guesses, guessers: g.votes.size, players: g.scores.size, open: !g.result, moveCoins: PR()?.move.coins || 0 };
    }
    function startPredict() {
        const info = s.predictPick || gameBallot()?.games.g0;
        s.predictPick = null;
        let chess = null;
        try { chess = info && new Chess(info.fen); } catch { chess = null; }
        if (!chess) {
            // Plus de partie à suivre : partie classique entre viewers
            s.mode = 'teams';
            return nextBallot();
        }
        s.cycle++;
        s.ballot = null;
        s.ballotQueue = [];
        s.recap = null;
        s.teams = { w: [], b: [] };
        const g = s.game = newGameState(chess);
        g.predict = { room: info.room, roomName: info.roomName, event: info.event, round: info.round, slug: info.slug, id: info.id,
            white: info.white, black: info.black, tc: info.tc };
        g.winners = new Map();    // login → { w: 'w' | 'd' | 'b', ply }
        g.scores = new Map();     // login → { pts, hits, win }
        g.clocks = null;
        g.lastHit = null;
        g.seenAt = Date.now();
        s.phase = 'play';
        s.endsAt = null;
        log(`🔮 24/24 : prédiction sur ${info.white?.name} - ${info.black?.name} (${info.event})`);
        loadPredictHistory(g);
        pollPredict(g);
        emit();
        emitMeAll();
    }
    /** Coups déjà joués (la salle ne donne que la position) : l'historique complet si la position concorde */
    function loadPredictHistory(g) {
        if (!fetchGame || !g.predict.round || !g.predict.slug) return;
        Promise.resolve().then(() => fetchGame(g.predict.room, g.predict.round, g.predict.slug)).then(data => {
            if (s.game !== g || g.result || g.history.length) return;
            const c = new Chess();
            const hist = [];
            let last = null;
            for (const cbn of data?.moves || []) {
                const uci = String(cbn).split('_')[0];
                const m = tryMove(c, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
                if (!m) return;
                hist.push(m.san);
                last = { from: m.from, to: m.to };
            }
            if (!hist.length || placeTurn(c.fen()) !== placeTurn(g.chess.fen())) return;
            g.chess = c;
            g.startFen = new Chess().fen();
            g.history = hist;
            g.hv = hist.map(() => null);
            g.lastMove = last;
            emit();
        }).catch(() => {});
    }
    function pollPredict(g) {
        if (s.game !== g || g.result || !fetchRoom) return;
        const next = () => {
            if (s.game !== g || g.result) return;
            clearTimeout(pred.timer);
            pred.timer = setTimeout(() => pollPredict(g), viewers() ? PREDICT.pollMs : PREDICT.idlePollMs);
            pred.timer.unref?.();
        };
        Promise.resolve().then(() => fetchRoom(g.predict.room)).then(r => {
            if (s.game !== g || g.result) return;
            const x = r?.ok ? (r.body?.games || []).find(z => z.id === g.predict.id) : null;
            if (!x) {
                if (Date.now() - g.seenAt > PREDICT.lostMs) return endPredict({ kind: 'lost' });
                return next();
            }
            g.seenAt = Date.now();
            if (x.currentFEN) syncPredict(g, x.currentFEN);
            // Pendules (ms restantes au dernier coup) : le client décompte pour le camp au trait
            const w = Number(x.whiteClock), b = Number(x.blackClock);
            if (Number.isFinite(w) && Number.isFinite(b) && (!g.clocks || g.clocks.w !== w || g.clocks.b !== b)) {
                g.clocks = { w, b, at: Date.now(), turn: g.chess.turn() };
                emit();
            }
            const res = String(x.result || '*');
            if (res !== '*') return endPredict({ kind: 'final', winner: res === '1-0' ? 'w' : res === '0-1' ? 'b' : 'd' });
            // La diffusion ne saisit pas toujours le résultat (ou très tard) : pendule tombée = perte au temps
            const c = g.clocks, turn = g.chess.turn();
            if (c && Number.isFinite(c[turn]) && c[turn] - (Date.now() - c.at) < -PREDICT.flagMs && !g.chess.isGameOver()) {
                return endPredict({ kind: 'flag', winner: turn === 'w' ? 'b' : 'w' });
            }
            if (g.chess.isCheckmate()) return endPredict({ kind: 'final', winner: turn === 'w' ? 'b' : 'w' });
            if (g.chess.isGameOver()) return endPredict({ kind: 'final', winner: 'd' });
            const last = Date.parse(x.lastMoveAt || x.updateAt || '');
            if (Number.isFinite(last) && Date.now() - last > PREDICT.staleMs) return endPredict({ kind: 'lost' });
            next();
        }).catch(() => next());
    }
    /** Nouvelle position : le coup joué (ou les deux, si on en a manqué un), sinon on repart de la position */
    function syncPredict(g, fen) {
        const target = placeTurn(fen);
        if (target === placeTurn(g.chess.fen())) return;
        const test = new Chess(g.chess.fen());
        for (const m1 of test.moves({ verbose: true })) {
            test.move(m1);
            if (placeTurn(test.fen()) === target) return predictMoves(g, [m1.san]);
            for (const m2 of test.moves({ verbose: true })) {
                test.move(m2);
                const ok = placeTurn(test.fen()) === target;
                test.undo();
                if (ok) return predictMoves(g, [m1.san, m2.san]);
            }
            test.undo();
        }
        let chess;
        try { chess = new Chess(fen); } catch { return; }
        g.chess = chess;
        g.startFen = fen;
        g.history = [];
        g.hv = [];
        g.lastMove = null;
        g.votes = new Map();
        g.recent = [];
        g.recentN = 0;
        emit();
        emitMeAll();
        loadPredictHistory(g);
    }
    /** Coups joués dans la vraie partie : un point par devinette juste (sur le premier ; les devinettes portaient sur lui) */
    function predictMoves(g, sans) {
        sans.forEach((san, i) => {
            const m = tryMove(g.chess, san);
            if (!m) return;
            if (i === 0) {
                let total = 0, n = 0;
                const counts = {};
                const who = [];
                for (const [login, list] of g.votes) {
                    const guess = list[0];
                    if (!guess) continue;
                    total++;
                    const sc0 = scoreOf(g, login);
                    sc0.tries = (sc0.tries || 0) + 1;
                    if (who.length < 60) who.push(tickerItem({ u: login, v: g.guessVia?.get(login) || null }, { m: guess, hit: guess === m.san }));
                    counts[guess] = (counts[guess] || 0) + 1;
                    if (guess === m.san) {
                        n++;
                        const sc = scoreOf(g, login);
                        sc.pts++;
                        sc.hits++;
                        g.hits.set(login, (g.hits.get(login) || 0) + 1);
                        sc.streak = (sc.streak || 0) + 1;
                        if (PR()) {
                            const bonus = sc.streak % PR().streak.every === 0 ? PR().streak : { xp: 0, coins: 0 };
                            payPredict(g, login, sc, { xp: PR().move.xp + bonus.xp, coins: PR().move.coins + bonus.coins });
                        }
                    } else sc0.streak = 0;
                }
                g.hv.push(total ? Math.round(n * 100 / total) : null);
                who.sort((a, b) => b.hit - a.hit);
                g.lastHit = { san: m.san, n, total, ply: g.history.length, at: Date.now(), who, top: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([move, k]) => ({ move, n: k })) };
            } else g.hv.push(null);
            g.history.push(m.san);
            g.lastMove = { from: m.from, to: m.to };
        });
        g.votes = new Map();
        g.guessVia = new Map();
        g.recent = [];
        g.recentN = 0;
        if (g.tally) g.tally.peak = Math.max(g.tally.peak, viewers());
        emit();
        emitMeAll();
    }
    /** Devinette du coup suivant : une par coup, elle se change */
    function guessMove(login, text, via, lang = 'en') {
        const g = s.game;
        if (s.phase !== 'play' || !g?.predict || g.result || !LOGIN_RE.test(login || '')) return false;
        const m = Notation.match(g.chess.moves({ verbose: true }), text, Notation.PIECES[lang] ? lang : 'en');
        if (!m) return false;
        if (g.votes.get(login)?.[0] === m.san) return true;
        g.votes.set(login, [m.san]);
        (g.guessVia ||= new Map()).set(login, viaOf(login, via));
        scoreOf(g, login);
        g.recent.push({ u: login, m: m.san, v: viaOf(login, via) });
        g.recentN = (g.recentN || 0) + 1;
        if (g.recent.length > 30) g.recent.shift();
        g.voteCount.w.set(login, (g.voteCount.w.get(login) || 0) + 1);
        emit();
        emitMeAll(login);
        return true;
    }
    /** Pronostic du vainqueur : une seule fois, il ne se change pas */
    function pickWinner(login, w) {
        const g = s.game;
        if (s.phase !== 'play' || !g?.predict || g.result || !LOGIN_RE.test(login || '') || !['w', 'd', 'b'].includes(w)) return false;
        if (g.winners.has(login)) return false;
        g.winners.set(login, { w, ply: g.history.length });
        scoreOf(g, login);
        emit();
        emitMeAll(login);
        return true;
    }
    function endPredict(res) {
        const g = s.game;
        if (!g?.predict || g.result) return;
        clearTimeout(pred.timer);
        log(`🔮 24/24 : fin de la prédiction (${res.kind}${res.winner ? ' ' + res.winner : ''}, ${g.history.length} demi-coups)`);
        const winner = res.kind === 'final' || res.kind === 'flag' ? res.winner : null;
        if (winner) for (const [login, p] of g.winners) {
            if (p.w !== winner) continue;
            const sc = scoreOf(g, login);
            sc.win = WINNER_PTS(p.ply);
            sc.pts += sc.win;
            if (PR()) {
                // Plus le pronostic est tôt, plus il rapporte (x1,7 avant le coup 15 … x0,2 après le 45)
                const base = winner === 'd' ? PR().winnerDraw : PR().winner;
                const f = Math.max(PR().oddsMin, Math.min(PR().oddsMax, sc.win / 6));
                payPredict(g, login, sc, { xp: Math.max(1, Math.round(base.xp * f)), coins: Math.max(1, Math.round(base.coins * f)), key: `h24w:${g.startedAt}:${login}` });
            }
        }
        g.result = { kind: 'predict', winner, end: res.kind };
        g.turnEndsAt = null;
        const best = predictBoard(g, 10);
        s.recap = {
            mode: 'predict',
            result: g.result,
            plies: g.history.length,
            durationMs: Date.now() - g.startedAt,
            players: { w: g.scores.size, b: 0 },
            top: { w: [], b: [] },
            mvp: best[0] ? { login: best[0].login, n: best[0].pts } : null,
            predict: { ...g.predict, board: best, winners: winnerCounts(g), players: g.scores.size,
                rightWinner: winner ? [...g.winners.values()].filter(p => p.w === winner).length : 0 }
        };
        s.lastResult = g.result;
        try { recordGame(g, g.result); } catch (e) { log('📊 24/24 : partie non comptée', e.message); }
        refreshCands();
        setPhase('recap', DUR.recap);
        emitMeAll();
    }

    // ------------------------------------------------------------------ minuteur commun
    let pending = null;
    function later(ms, fn) {
        clearTimeout(pending);
        pending = setTimeout(() => { pending = null; fn(); }, ms);
    }

    function tick() {
        const now = Date.now();
        // Personne ne regarde, ou la régie attend (pause, Phantom en mouvement ou décroché) : tout s'arrête
        const reason = holdReason();
        if (reason !== (s.pauseReason || null)) { s.pauseReason = reason; emit(); }
        const idle = !!reason;
        if (idle !== s.paused) {
            s.paused = idle;
            if (idle) s.pausedAt = now;
            else if (s.pausedAt) {
                const d = now - s.pausedAt;
                if (s.endsAt) s.endsAt += d;
                if (s.game?.turnEndsAt) s.game.turnEndsAt += d;
                s.pausedAt = null;
            }
            emit();
        }
        if (!s.paused) botTick(now);
        if (s.paused || pending || !s.endsAt || now < s.endsAt) return;
        switch (s.phase) {
            case 'recap': return startModeVote();
            case 'voteMode':
            case 'voteOptions': return closeBallot();
            case 'signup': return startGame();
            case 'play':
                if (s.game?.turnEndsAt) return resolveTurn();
                if (s.game?.settle && !s.game.result) return startTurn();
        }
    }
    setInterval(tick, 250).unref?.();

    // ------------------------------------------------------------------ entrées (web aujourd'hui, chat Twitch demain)
    /** Inscription : l'équipe la moins nombreuse (rush : une seule équipe) ; possible en pleine partie */
    function join(login) {
        if (!LOGIN_RE.test(login || '') || teamOf(login) || s.mode === 'predict' || s.mode === 'classic') return false;
        const side = s.mode === 'rush' ? 'w' : s.mode === 'bot' ? s.vsSide
            : s.teams.w.length === s.teams.b.length ? pick(['w', 'b'])
            : s.teams.w.length < s.teams.b.length ? 'w' : 'b';
        s.teams[side].push(login);
        emit();
        emitMeAll(login);
        return side;
    }
    /** Chaque viewer connecté (Twitch) sur la page est inscrit d'office, sauf s'il a quitté ce cycle-ci */
    function autoJoin(login) {
        if (s.phase !== 'signup' && s.phase !== 'play') return;
        // (les bots de test aussi)
        const now = Date.now();
        const chatters = [...chat.seen].filter(([, at]) => now - at < CHAT_KEEP_MS).map(([l]) => l);
        const logins = login ? [login] : [...new Set([...sockets.values(), ...bots.list, ...chatters])];
        for (const l of logins) if (l && !s.optOut.has(l) && !teamOf(l)) join(l);
    }
    /** Régie (tests) : saute directement à une étape du cycle */
    function force(phase) {
        clearTimeout(pending);
        pending = null;
        if (s.game) { s.game.turnEndsAt = null; s.game.draw = null; s.game.settle = false; }
        switch (phase) {
            case 'play':
                if (!allPlayers().length) s.optOut.clear();
                s.phase = 'play';
                autoJoin();
                return startGame();
            case 'recap':
                if (s.phase === 'play' && s.game && !s.game.result) return endGame();
                s.ballot = null;
                s.recap = s.recap || { mode: s.mode, result: s.lastResult || { kind: 'draw', reason: 'draw' }, plies: s.game?.history.length || 0,
                    durationMs: 0, players: { w: s.teams.w.length, b: s.teams.b.length }, top: { w: [], b: [] } };
                setPhase('recap', DUR.recap);
                return emitMeAll();
            case 'voteMode': return startModeVote();
            case 'voteOptions':
                s.ballot = null;
                s.ballotQueue = s.mode === 'predict' ? [gameBallot()].filter(Boolean)
                    : (BALLOTS[s.mode] || [OPPONENT]).map(x => ({ ...x }));
                return nextBallot();
            case 'signup':
                s.ballot = null;
                s.ballotQueue = [];
                return nextBallot();
        }
    }
    function leave(login) {
        for (const side of ['w', 'b']) s.teams[side] = s.teams[side].filter(l => l !== login);
        s.game?.votes.delete(login);
        emit();
        emitMeAll(login);
    }
    /** Vote d'un coup (SAN, UCI ou « e4 »), seulement pour l'équipe dont c'est le tour.
     *  Un vote par tour : il se change. Plusieurs (option « votes ») : chacun compte, le même coup peut être repris. */
    /** Provenance d'un vote pour le bandeau : '#chaîne' (chat Twitch), 'bot' (bots de test) ou null (site) */
    function viaOf(login, via) { return /^(bot_|sim_)/.test(login) ? 'bot' : via || null; }
    /** Bandeau des votes : photo Twitch (si connue ; sinon demandée, l'état repart quand elle arrive) et provenance */
    function withPic(o) { return o && o.voter && !o.bot ? { ...o, pic: twitchApi.avatar(o.voter) } : o; }
    function tickerItem(r, extra) { return { u: r.u, ...extra, v: r.v || null, p: r.v === 'bot' ? null : twitchApi.avatar(r.u) }; }
    /** `lang` : notation du texte (chat : H24_LANG ; page : langue du spectateur ; bots : 'en') */
    function voteMove(login, text, via, lang = 'en') {
        const g = s.game;
        if (g?.predict) return guessMove(login, text, via, lang);
        if (s.phase !== 'play' || !g?.turnEndsAt || g.result) return false;
        const side = g.chess.turn();
        const team = teamOf(login);
        if (s.mode === 'rush' ? !team : !canPlay(team, side)) return false;
        const m = Notation.match(g.chess.moves({ verbose: true }), text, Notation.PIECES[lang] ? lang : 'en');
        if (!m) return false;
        const max = Math.max(1, Number(s.options.votes) || 1);
        const mine = g.votes.get(login) || [];
        if (max === 1) {
            if (mine[0] === m.san) return true;
            g.votes.set(login, [m.san]);
        } else {
            if (mine.length >= max) return false;
            g.votes.set(login, [...mine, m.san]);
        }
        g.recent.push({ u: login, m: m.san, v: viaOf(login, via) });
        (g.voteVia ||= new Map()).set(login, viaOf(login, via));
        g.recentN = (g.recentN || 0) + 1;
        if (g.recent.length > 30) g.recent.shift();
        const vc = g.voteCount[s.mode === 'rush' ? 'w' : side];
        vc.set(login, (vc.get(login) || 0) + 1);
        // Toute l'équipe a utilisé ses votes : le tour se termine juste après
        const voters = s.mode === 'rush' || !s.teams[side].length ? allPlayers() : s.teams[side];
        // (pas quand on est seul : on garde le temps de changer d'avis)
        if (voters.length > 1 && voters.every(l => (g.votes.get(l)?.length || 0) >= max)) {
            g.turnEndsAt = Math.min(g.turnEndsAt, Date.now() + ALL_VOTED_MS);
            s.endsAt = g.turnEndsAt;
        }
        emit();
        emitMeAll(login);
        return true;
    }
    function voteBallot(login, choice, via) {
        const b = s.ballot;
        if (!b || b.winner !== undefined || !LOGIN_RE.test(login || '')) return false;
        const c = b.choices.find(x => String(x) === String(choice));
        if (c === undefined) return false;
        b.votes.set(login, c);
        // Bandeau des votes : qui a voté quoi
        (b.recent ||= []).push({ u: login, c, v: viaOf(login, via) });
        if (b.recent.length > 30) b.recent.shift();
        b.recentN = (b.recentN || 0) + 1;
        emit();
        emitMeAll(login);
        return true;
    }

    // ------------------------------------------------------------------ bots de test
    // Faux joueurs pour suivre un cycle complet : ils s'inscrivent, votent le mode et les options,
    // et votent les coups à des moments aléatoires, répartis sur 2-3 coups (tirage au sort lisible).
    // Ils ne comptent pas comme spectateurs : sans vrai viewer, la station reste en pause.
    // Chaque bot a un niveau (elo) : ses coups sont ceux de Stockfish bridé à ce niveau.
    const bots = { list: [], elo: new Map(), plans: new Map(), cands: null };
    function botCount() { try { return bots.list.length; } catch { return 0; } }
    const botList = () => bots.list.map(l => ({ l, elo: bots.elo.get(l) || 1500 }));
    function setBots(count = 0) {
        const n = Math.max(0, Math.min(BOT_NAMES.length, Number(count) || 0));
        for (const l of bots.list.slice(n)) { leave(l); bots.elo.delete(l); }
        bots.list = bots.list.slice(0, n);
        while (bots.list.length < n) addBot(BOT_MIX[bots.list.length % BOT_MIX.length], { quiet: true });
        bots.plans.clear();
        emit();
        return { bots: botList() };
    }
    /** Un bot de plus, à ce niveau (nom libre suivant) ; null si complet */
    function addBot(elo, { quiet = false } = {}) {
        const l = BOT_NAMES.find(n => !bots.list.includes(n));
        if (!l) return null;
        bots.list.push(l);
        bots.elo.set(l, Stockfish.snapLevel(elo));
        // Ajouté en pleine partie : il rejoint tout de suite
        if (s.phase === 'play' && !teamOf(l)) join(l);
        if (!quiet) emit();
        return l;
    }
    function removeBot(login) {
        if (!bots.list.includes(login)) return false;
        bots.list = bots.list.filter(l => l !== login);
        bots.elo.delete(login);
        bots.plans.delete(login);
        leave(login);
        emit();
        return true;
    }
    /** Ce que le bot ferait maintenant (clé stable tant que la situation ne change pas) */
    function botSituation() {
        const g = s.game;
        if (s.phase === 'signup') return { key: `signup:${s.cycle}`, until: s.endsAt };
        if ((s.phase === 'voteMode' || s.phase === 'voteOptions') && s.ballot) return { key: `ballot:${s.cycle}:${s.ballot.id}`, until: s.endsAt };
        if (s.phase === 'play' && g?.predict && !g.result) return { key: `pmove:${s.cycle}:${g.history.length}`, until: Date.now() + 20000 };
        if (s.phase === 'play' && g?.turnEndsAt && !g.draw && !g.result) {
            return { key: `move:${s.cycle}:${g.puzzleIndex || 0}:${g.history.length}`, until: g.turnEndsAt };
        }
        return null;
    }
    function botAct(login, key) {
        if (key.startsWith('signup')) return join(login);
        if (key.startsWith('ballot')) {
            const b = s.ballot;
            const prefer = { mode: ['classic', 'classic', 'rush', 'predict'], opponent: ['teams', 'teams', 'bot'], decision: ['draw'] };
            const ok = (prefer[b.id] || []).filter(c => b.choices.includes(c));
            return voteBallot(login, pick(ok.length ? ok : b.choices));
        }
        const g = s.game;
        if (key.startsWith('pmove')) {
            // Prédiction : le vainqueur une fois (au hasard, un peu plus souvent les Blancs), puis le coup de Stockfish à son niveau
            if (!g.winners.has(login) && Math.random() < 0.5) pickWinner(login, pick(['w', 'w', 'd', 'b']));
            const fen = g.chess.fen();
            Stockfish.botMove(fen, bots.elo.get(login) || 1500).then((san) => {
                if (san && s.game === g && g.chess.fen() === fen && bots.list.includes(login)) guessMove(login, san);
            }).catch(() => {});
            return;
        }
        const side = g.chess.turn();
        if (s.mode !== 'rush' && !canPlay(teamOf(login), side)) return;
        // Coup de Stockfish au niveau du bot (partie comme rush) ; voté seulement si le tour n'a pas changé entre-temps.
        // Plusieurs votes (option) : 1 à N fois ce coup
        const n = 1 + rand(Math.max(1, Number(s.options.votes) || 1));
        Stockfish.botMove(g.chess.fen(), bots.elo.get(login) || 1500).then((san) => {
            if (!san || botSituation()?.key !== key || !bots.list.includes(login)) return;
            for (let i = 0; i < n; i++) voteMove(login, san);
        }).catch(() => {});
    }
    function botTick(now) {
        if (!bots.list.length) return;
        const sit = botSituation();
        if (!sit) return;
        for (const login of bots.list) {
            let plan = bots.plans.get(login);
            if (!plan || plan.key !== sit.key) {
                const left = Math.max(0, (sit.until || now) - now);
                // 1 bot sur 6 s'abstient d'un coup, pour que le tour ne se termine pas toujours en avance
                const skip = sit.key.startsWith('move') && Math.random() < 0.17;
                plan = { key: sit.key, at: now + left * (0.12 + Math.random() * 0.6), done: skip };
                bots.plans.set(login, plan);
            }
            if (!plan.done && now >= plan.at) {
                plan.done = true;
                botAct(login, sit.key);
            }
        }
    }

    // ------------------------------------------------------------------ sockets
    const devLogins = process.env.STATION_DEV === '1';
    async function identify(token) {
        if (typeof token !== 'string' || !token) return null;
        if (devLogins && token.startsWith('dev:')) {
            const l = token.slice(4).toLowerCase();
            return LOGIN_RE.test(l) ? l : null;
        }
        try { return (await verifyTwitchToken(token)).login; } catch { return null; }
    }

    /** Un onglet de la régie s'en va : s'il tenait le Phantom, la station ne l'attend plus ;
     *  plus aucun onglet de régie : la pause manuelle saute aussi (la vue réelle reste) */
    function dropRegie(id) {
        stopCam(id);
        if (regie.socket === id) {
            regie.socket = null;
            regie.phantom = 'off';
        }
        const left = [...sockets].some(([sid, l]) => sid !== id && l && REGIE.has(l));
        if (!left) regie.paused = false;
        emit();
    }

    io.on('connection', (socket) => {
        socket.on('h24:join', async (data = {}) => {
            socket.join(ROOM);
            sockets.set(socket.id, null);
            socket.emit('h24:state', publicState());
            emitMe(socket.id);
            emit();
            const login = await identify(data.token);
            if (login && sockets.has(socket.id)) {
                sockets.set(socket.id, login);
                autoJoin(login);
                chatSync();
                emitMe(socket.id);
            }
        });
        socket.on('h24:leave', () => {
            socket.leave(ROOM);
            socket.leave(CAM_ROOM);
            sockets.delete(socket.id);
            dropRegie(socket.id);
            emit();
        });
        const me = () => sockets.get(socket.id);
        socket.on('h24:signup', () => { const l = me(); if (l) { s.optOut.delete(l); join(l); } });
        socket.on('h24:quit', () => { const l = me(); if (l) { s.optOut.add(l); leave(l); } });
        socket.on('h24:force', (data = {}) => {
            const l = me();
            if (l && REGIE.has(l) && ['play', 'recap', 'voteMode', 'voteOptions', 'signup'].includes(data.phase)) force(data.phase);
        });
        socket.on('h24:vote', (data = {}) => { const l = me(); if (l) voteMove(l, String(data.move || '').slice(0, 12), null, String(data.lang || 'en')); });
        socket.on('h24:ballot', (data = {}) => { const l = me(); if (l) voteBallot(l, String(data.choice ?? '').slice(0, 20)); });
        socket.on('h24:winner', (data = {}) => { const l = me(); if (l) pickWinner(l, String(data.pick || '')); });
        // Régie : un clic sur une option la choisit tout de suite
        socket.on('h24:pick', (data = {}) => {
            const l = me(), b = s.ballot;
            if (!l || !REGIE.has(l) || !b || b.winner !== undefined || !['voteMode', 'voteOptions'].includes(s.phase)) return;
            const c = b.choices.find(x => String(x) === String(data.choice ?? ''));
            if (c === undefined) return;
            log(`🎛️ 24/24 : ${b.id} = ${c} choisi par la régie (${l})`);
            closeBallot(c);
        });
        // Bots de test : réglés depuis la régie (h24:regie { bots }) ; retrait réservé à la régie aussi
        socket.on('h24:botsOff', () => {
            if (!bots.list.length || !REGIE.has(me())) return;
            log(`🤖 24/24 : bots retirés depuis la page (${me() || 'anonyme'})`);
            setBots(0);
            emit();
        });
        // Tests locaux : un message du chat Twitch simulé
        if (process.env.STATION_DEV === '1') socket.on('h24:devChat', (data = {}) => chatMessage(String(data.login || '').toLowerCase(), String(data.text || '').slice(0, 200), String(data.channel || '').toLowerCase().slice(0, 25)));
        // Régie : état du Phantom, pause manuelle, chaîne de la vue réelle
        socket.on('h24:regie', (data = {}) => {
            const l = me();
            if (!l || !REGIE.has(l)) return;
            // Le Phantom appartient à l'onglet qui le suit : un autre onglet « hors direct » ne l'écrase pas
            if (['ok', 'busy', 'error'].includes(data.phantom)) { regie.socket = socket.id; regie.phantom = data.phantom; }
            else if (data.phantom === 'off' && regie.socket === socket.id) { regie.socket = null; regie.phantom = 'off'; }
            if (typeof data.paused === 'boolean') regie.paused = data.paused;
            if (Number.isInteger(data.bots) && data.bots !== bots.list.length) {
                log(`🤖 24/24 : ${data.bots} bot(s) depuis la régie (${l})`);
                setBots(data.bots);
            }
            if (Number.isFinite(Number(data.addBot)) && data.addBot !== null && data.addBot !== '') {
                const b = addBot(Number(data.addBot));
                if (b) log(`🤖 24/24 : ${b} (${Stockfish.levelLabel(data.addBot)}) ajouté depuis la régie (${l})`);
            }
            if (typeof data.removeBot === 'string' && removeBot(data.removeBot)) log(`🤖 24/24 : ${data.removeBot} retiré depuis la régie (${l})`);
            if (typeof data.channel === 'string') {
                const c = data.channel.trim().toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/[/?#].*$/, '');
                if (c === '' || LOGIN_RE.test(c)) {
                    if (c !== regie.channel && regieFile) {
                        try { fs.writeFileSync(regieFile, JSON.stringify({ channel: c })); } catch {}
                    }
                    regie.channel = c;
                }
            }
            emit();
        });
        // ---- caméra de la régie
        socket.on('h24:cam:start', (data = {}) => {
            const l = me();
            if (!l || !REGIE.has(l)) return;
            const w = Number(data.w), h = Number(data.h);
            if (!CAM.codec.test(String(data.codec)) || !Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 1920 || h > 1080) return;
            if (cam.socket && cam.socket !== socket.id) io.to(cam.socket).emit('h24:cam:taken');   // un autre onglet reprend la main
            cam.socket = socket.id;
            cam.cfg = { codec: String(data.codec), w, h };
            cam.gop = [];
            cam.gopBytes = 0;
            cam.tokens = CAM.burst;
            cam.at = Date.now();
            io.to(CAM_ROOM).emit('h24:cam:cfg', cam.cfg);
            emit();
        });
        socket.on('h24:cam:chunk', (meta, data, ack) => {
            const reply = typeof ack === 'function' ? ack : () => {};
            if (cam.socket !== socket.id || !Buffer.isBuffer(data) || !data.length || data.length > CAM.maxChunk || !meta || typeof meta !== 'object') return reply(false);
            const t = Number(meta.t);
            if (!Number.isFinite(t)) return reply(false);
            // Seau de jetons : au-delà du débit autorisé, le morceau est refusé (l'émetteur repart d'une image clé)
            const now = Date.now();
            cam.tokens = Math.min(CAM.burst, cam.tokens + (now - cam.at) * CAM.rate / 1000);
            cam.at = now;
            if (cam.tokens < data.length) return reply(false);
            cam.tokens -= data.length;
            const k = meta.k ? 1 : 0;
            const c = { k, t, s: ++cam.seq };
            if (k) { cam.gop = []; cam.gopBytes = 0; }
            if (cam.gop.length || k) {
                cam.gop.push([c, data]);
                cam.gopBytes += data.length;
                if (cam.gopBytes > CAM.maxGop) { cam.gop = []; cam.gopBytes = 0; }
            }
            io.to(CAM_ROOM).volatile.emit('h24:cam:chunk', c, data);   // viewer saturé : morceau sauté, il attend la clé suivante
            reply(true);
        });
        socket.on('h24:cam:stop', () => stopCam(socket.id));
        // Un viewer affiche (ou replie) la vue réelle : il reçoit le flux seulement s'il le regarde
        socket.on('h24:cam:watch', (data = {}) => {
            if (!sockets.has(socket.id)) return;
            if (!data.on) { socket.leave(CAM_ROOM); return; }
            if (socket.rooms.has(CAM_ROOM)) return;
            socket.join(CAM_ROOM);
            if (cam.cfg) {
                socket.emit('h24:cam:cfg', cam.cfg);
                for (const [c, d] of cam.gop) socket.emit('h24:cam:chunk', c, d);
            }
        });
        socket.on('disconnect', () => {
            dropRegie(socket.id);
            if (sockets.delete(socket.id)) emit();
        });
    });

    // ------------------------------------------------------------------ chat Twitch
    /** Un seul client anonyme ; il rejoint le chat de chaque compte connecté à la page et quitte ceux partis depuis 2 min */
    function chatSync() {
        if (process.env.H24_CHAT === '0') return;
        const now = Date.now();
        for (const l of sockets.values()) if (l && !l.startsWith('sim_')) chat.lastWanted.set(l, now);
        for (const [l, at] of chat.lastWanted) if (now - at > CHAT_LINGER_MS) chat.lastWanted.delete(l);
        if (!chat.client) {
            if (!chat.lastWanted.size) return;
            let tmi;
            try { tmi = require('tmi.js'); } catch { log('💬 24/24 : tmi.js absent, chat non lu'); return; }
            const client = chat.client = new tmi.Client({ connection: { reconnect: true, secure: true }, channels: [] });
            client.on('connected', () => { chat.connected = true; chat.joined.clear(); chat.queue = []; chatEvent('connecté'); chatSync(); });
            client.on('disconnected', (why) => { chat.connected = false; chat.joined.clear(); chat.queue = []; chatEvent(`déconnecté ${why || ''}`); emitMeAll(); });
            client.on('join', (ch, user, self) => {
                if (!self) return;
                const c = ch.replace(/^#/, '');
                chat.joined.add(c);
                chatEvent(`join #${c}`);
                emitMeAll(c);
            });
            client.on('part', (ch, user, self) => { if (self) { const c = ch.replace(/^#/, ''); chat.joined.delete(c); emitMeAll(c); } });
            client.on('message', (ch, tags, msg, self) => {
                chat.received++;
                if (!self) chatMessage(String(tags.username || '').toLowerCase(), msg, String(ch || '').replace(/^#/, '').toLowerCase());
            });
            client.connect().catch(e => { chatEvent(`échec ${e?.message || e}`); log('💬 24/24 : chat injoignable', e?.message || e); });
            return;
        }
        if (!chat.connected) return;
        for (const l of chat.lastWanted.keys()) if (!chat.joined.has(l) && !chat.queue.includes(l)) chat.queue.push(l);
        for (const c of chat.joined) if (!chat.lastWanted.has(c)) chat.client.part(c).catch(() => {});
    }
    // Rejoindre un chat à la fois (limite de Twitch sur les join), et resynchroniser régulièrement
    setInterval(() => {
        const c = chat.queue.shift();
        if (c && chat.connected && !chat.joined.has(c)) chat.client.join(c).catch(e => chatEvent(`join #${c} refusé ${e?.message || e}`));
    }, 700).unref?.();
    setInterval(chatSync, 30 * 1000).unref?.();
    /** Un message du chat : join / quitter, numéro d'un choix pendant un vote, coup pendant la partie */
    function chatMessage(login, text, channel) {
        let outcome;
        try { outcome = chatHandle(login, text, channel ? `#${channel}` : 'chat'); } catch (e) { outcome = `erreur : ${e?.message || e}`; }
        chat.recent.push({ at: new Date().toISOString(), login, text: String(text || '').slice(0, 40), outcome: outcome || 'ignoré' });
        if (chat.recent.length > 30) chat.recent.shift();
    }
    function chatHandle(login, text, via) {
        if (!LOGIN_RE.test(login)) return 'login invalide';
        const typed = (String(text || '').trim().split(/\s+/)[0] || '').replace(/^!/, '');
        const word = typed.toLowerCase();
        if (!word) return;
        if (['join', 'rejoindre', 'jouer', 'play'].includes(word)) {
            s.optOut.delete(login);
            chat.seen.set(login, Date.now());
            return `join → ${join(login) || teamOf(login) || 'refusé'}`;
        }
        if (['quit', 'quitter', 'leave'].includes(word)) {
            s.optOut.add(login);
            chat.seen.delete(login);
            leave(login);
            return 'quit';
        }
        // Prédiction : vainqueur (« blancs », « nulle », « noirs », 1-0…) ou devinette du coup suivant
        if (s.phase === 'play' && s.game?.predict && !s.game.result) {
            const WIN = { blancs: 'w', blanc: 'w', white: 'w', '1-0': 'w', '1': 'w', nulle: 'd', draw: 'd', '1/2': 'd', '½': 'd', '2': 'd', noirs: 'b', noir: 'b', black: 'b', '0-1': 'b', '3': 'b' };
            const wk = word.replace(/^!\s*/, '').replace(/^(1\/2|½)-(1\/2|½)$/, '1/2');
            if (WIN[wk]) return pickWinner(login, WIN[wk]) ? `vainqueur ${WIN[wk]}` : 'vainqueur déjà choisi';
            if (!Notation.looksLikeMove(typed, H24_LANG)) return;
            if (guessMove(login, typed, via, H24_LANG)) { chat.seen.set(login, Date.now()); return `devinette ${word}`; }
            return 'refusé : coup illégal';
        }
        if (s.ballot && /^\d{1,2}$/.test(word)) {
            const c = s.ballot.choices[Number(word) - 1];
            if (c === undefined) return 'numéro hors choix';
            voteBallot(login, c, via);
            return `vote ${s.ballot.id} = ${c}`;
        }
        // Un coup tapé dans le chat : inscrit d'office s'il ne l'est pas encore (sauf s'il a quitté), puis vote
        if (s.phase !== 'play' || !Notation.looksLikeMove(typed, H24_LANG)) return s.phase !== 'play' ? `ignoré (phase ${s.phase})` : undefined;
        if (!teamOf(login) && !s.optOut.has(login)) join(login);
        const team = teamOf(login);
        if (team && voteMove(login, typed, via, H24_LANG)) { chat.seen.set(login, Date.now()); return `coup ${word} compté (équipe ${team})`; }
        const g = s.game;
        const why = !team ? 'pas inscrit (a quitté)' : !g?.turnEndsAt ? 'hors tour de vote'
            : s.mode !== 'rush' && team !== g.chess.turn() ? `équipe ${team === 'w' ? 'Blancs' : 'Noirs'}, trait aux ${g.chess.turn() === 'w' ? 'Blancs' : 'Noirs'}`
            : 'coup illégal';
        log(`💬 24/24 : ${login} « ${word} » refusé (${why})`);
        return `refusé : ${why}`;
    }
    /** Diagnostic (sim-cli h24-status) : état du chat et derniers messages reçus */
    function diag(o = {}) {
        const login = String(o.login || '').toLowerCase();
        return {
            twitchApi: twitchApi.status(),
            regieChannel: regie.channel, chat: { client: !!chat.client, connected: chat.connected, joined: [...chat.joined], queue: chat.queue, received: chat.received, events: chat.events },
            phase: s.phase, mode: s.mode, turn: s.game?.chess.turn() || null, turnOpen: !!s.game?.turnEndsAt,
            teams: { w: s.teams.w.length, b: s.teams.b.length },
            paused: s.paused, pauseReason: s.pauseReason || null, viewers: viewers(), phantom: regie.phantom, bots: bots.list.length,
            predict: s.game?.predict ? { guessers: s.game.votes.size, winners: s.game.winners.size, ply: s.game.history.length, result: s.game.result || null, coinsPaid: [...s.game.scores.values()].reduce((a, x) => a + (x.coins || 0), 0) } : undefined,
            login: login ? { login, team: teamOf(login), optOut: s.optOut.has(login) } : undefined,
            recent: chat.recent
        };
    }
    // Joueurs du chat inactifs depuis 20 min : oubliés
    setInterval(() => {
        const now = Date.now();
        for (const [l, at] of chat.seen) if (now - at > CHAT_KEEP_MS) chat.seen.delete(l);
    }, 60 * 1000).unref?.();

    log('📺 Station 24/24 prête');
    return { state: s, stats, join, leave, voteMove, voteBallot, publicState, setBots, chatMessage, diag, isRegie: (login) => !!login && REGIE.has(login) };
};
