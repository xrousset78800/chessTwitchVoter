/**
 * Station 24/24 : une partie permanente jouée par les viewers, pilotée par le serveur.
 *
 * Cycle : partie → récap → vote du mode → votes des options → inscription → partie…
 * - Deux équipes (« teams ») : les inscrits sont répartis entre Blancs et Noirs, chaque équipe vote ses coups.
 * - Problèmes (« problems ») : tous les inscrits forment une équipe et résolvent une série de puzzles.
 *
 * Tous les votes (coups, mode, options, inscription) passent par les mêmes fonctions, quelle que soit
 * leur source : la page web aujourd'hui, le chat Twitch de la chaîne 24/24 demain.
 * Le cycle se met en pause quand personne ne regarde.
 */
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');

const ROOM = 'h24';
const LOGIN_RE = /^[a-z0-9_]{2,25}$/;
const ALL_VOTED_MS = 3000;        // toute l'équipe a voté : fin du tour anticipée
const MAX_PLIES = 160;            // au-delà : nulle, la station repart
const DRAW_REVEAL_MS = 5000;      // tirage au sort : temps laissé à la roue
const RANDOM_REVEAL_MS = 1800;    // personne n'a voté : coup au hasard montré avant d'être joué
const REPLY_MS = 900;             // problèmes : réponse de l'adversaire
const PUZZLE_PAUSE_MS = 3000;     // problèmes : solution montrée avant le suivant

const DUR = {
    recap: 15000,
    voteMode: 20000,
    voteOption: 15000,
    signup: 30000
};

const MODES = ['teams', 'problems'];
// Options votées après le mode, une à une ; la première valeur est celle par défaut
const BALLOTS = {
    teams: [
        { id: 'turn', choices: [30, 20, 45] },
        { id: 'decision', choices: ['majority', 'draw', 'band'] }
    ],
    problems: [
        { id: 'level', choices: ['medium', 'easy', 'hard'] },
        { id: 'turn', choices: [30, 20, 45] }
    ]
};
const BOT_NAMES = ['bot_fou', 'bot_tour', 'bot_pion', 'bot_dame', 'bot_roque', 'bot_gambit', 'bot_zugzwang',
    'bot_cavalier', 'bot_echec', 'bot_fianchetto', 'bot_sicilienne', 'bot_pat', 'bot_mat', 'bot_prise', 'bot_clouage', 'bot_fourchette'];
const LEVELS = { easy: [600, 1300], medium: [1300, 1800], hard: [1800, 2600] };
const PUZZLES_PER_SERIES = 8;

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const clean = (s) => String(s || '').replace(/[+#!?]/g, '');
/** chess.js 1.x lève une exception sur un coup illégal : null à la place */
const tryMove = (chess, m) => { try { return chess.move(m); } catch { return null; } };

module.exports = function station({ io, verifyTwitchToken, dataDir, log = console.log, durations = {} }) {
    Object.assign(DUR, durations);

    // ------------------------------------------------------------------ problèmes (CSV Lichess)
    let puzzleLines = null;
    function puzzleSource() {
        if (puzzleLines) return puzzleLines;
        try {
            const raw = fs.readFileSync(path.join(__dirname, 'js', 'problemsV2.csv'), 'utf8');
            puzzleLines = raw.split('\n').slice(1).filter(l => l.trim());
        } catch (e) {
            log('🧩 24/24 : problèmes introuvables', e.message);
            puzzleLines = [];
        }
        return puzzleLines;
    }
    function randomPuzzle(level) {
        const lines = puzzleSource();
        const [min, max] = LEVELS[level] || LEVELS.medium;
        for (let i = 0; i < 400 && lines.length; i++) {
            const c = pick(lines).split(',');
            const rating = parseInt(c[3], 10);
            if (!(rating >= min && rating < max)) continue;
            const moves = String(c[2] || '').trim().split(/\s+/);
            if (moves.length < 2) continue;
            try { new Chess(c[1]); } catch { continue; }
            return { id: c[0], fen: c[1], moves, rating, themes: String(c[7] || '').split(' ').slice(0, 3) };
        }
        return null;
    }

    // ------------------------------------------------------------------ état
    const s = {
        phase: 'signup',
        endsAt: Date.now() + DUR.signup,
        paused: false,
        mode: 'teams',
        options: { turn: 30, decision: 'majority', level: 'medium' },
        teams: { w: [], b: [] },
        ballot: null,          // { id, choices, votes: Map(login → choix) }
        ballotQueue: [],
        game: null,
        recap: null,
        lastResult: null,
        cycle: 1
    };
    const sockets = new Map();   // socket.id → login (null : spectateur anonyme)

    const allPlayers = () => [...s.teams.w, ...s.teams.b];
    /** Une équipe joue son camp, et aussi l'autre tant qu'il n'a aucun joueur */
    const canPlay = (team, side) => !!team && (team === side || !s.teams[side].length);
    const teamOf = (login) => s.teams.w.includes(login) ? 'w' : s.teams.b.includes(login) ? 'b' : null;
    const viewers = () => sockets.size;

    // ------------------------------------------------------------------ diffusion
    let emitTimer = null;
    function emit() {
        if (emitTimer) return;
        emitTimer = setTimeout(() => {
            emitTimer = null;
            io.to(ROOM).emit('h24:state', publicState());
        }, 120);
    }
    function publicState() {
        const g = s.game;
        const tally = (map) => {
            const counts = {};
            for (const v of map.values()) counts[v] = (counts[v] || 0) + 1;
            return Object.entries(counts).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
        };
        return {
            now: Date.now(),
            cycle: s.cycle,
            phase: s.phase,
            endsAt: s.endsAt,
            paused: s.paused,
            mode: s.mode,
            options: s.options,
            teams: s.teams,
            viewers: viewers(),
            ballot: s.ballot && { id: s.ballot.id, choices: s.ballot.choices, tally: tally(s.ballot.votes), total: s.ballot.votes.size },
            next: s.ballotQueue.map(b => b.id),
            recap: s.recap,
            game: g && {
                fen: g.chess.fen(),
                turn: g.chess.turn(),
                history: g.history,
                startFen: g.startFen,
                lastMove: g.lastMove,
                turnEndsAt: g.turnEndsAt,
                votes: tally(g.votes).map(({ k, n }) => ({ move: k, count: n })),
                voters: g.votes.size,
                recent: g.recent.slice(-8),
                draw: g.draw,
                random: g.random,
                result: g.result,
                // problèmes
                puzzle: g.puzzle && { index: g.puzzleIndex, total: PUZZLES_PER_SERIES, rating: g.puzzle.rating, themes: g.puzzle.themes, side: g.side, status: g.puzzleStatus },
                score: g.score
            }
        };
    }
    function emitMe(socketId) {
        const login = sockets.get(socketId);
        const sock = io.sockets.sockets.get(socketId);
        if (!sock) return;
        sock.emit('h24:me', {
            login,
            team: login ? teamOf(login) : null,
            vote: login && s.game ? s.game.votes.get(login) || null : null,
            ballot: login && s.ballot ? s.ballot.votes.get(login) ?? null : null
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

    function startModeVote() {
        s.recap = null;
        s.ballot = { id: 'mode', choices: [...MODES], votes: new Map() };
        s.ballotQueue = [];
        setPhase('voteMode', DUR.voteMode);
        emitMeAll();
    }

    function closeBallot() {
        const b = s.ballot;
        const counts = {};
        for (const v of b.votes.values()) counts[v] = (counts[v] || 0) + 1;
        const best = Math.max(0, ...Object.values(counts));
        // Personne n'a voté : valeur par défaut (la première) ; égalité : tirage parmi les ex æquo
        const winner = best === 0 ? b.choices[0] : pick(b.choices.filter(c => counts[c] === best));
        if (b.id === 'mode') {
            s.mode = winner;
            s.ballotQueue = BALLOTS[winner].map(x => ({ ...x }));
        } else {
            s.options[b.id] = winner;
        }
        s.ballot = null;
        nextBallot();
    }

    function nextBallot() {
        const b = s.ballotQueue.shift();
        if (!b) {
            s.teams = { w: [], b: [] };
            setPhase('signup', DUR.signup);
            emitMeAll();
            return;
        }
        const choices = b.id === 'turn' && bots.turn ? [bots.turn, ...b.choices.filter(c => c !== bots.turn)] : b.choices;
        s.ballot = { id: b.id, choices, votes: new Map() };
        setPhase('voteOptions', DUR.voteOption);
        emitMeAll();
    }

    function startGame() {
        s.cycle++;
        s.ballot = null;
        s.recap = null;
        if (s.mode === 'problems') {
            s.game = newGameState(new Chess());
            s.game.score = { solved: 0, failed: 0 };
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
        return { chess, startFen: chess.fen(), history: [], lastMove: null, votes: new Map(), recent: [],
            turnEndsAt: null, draw: null, random: false, result: null, startedAt: Date.now(),
            voteCount: { w: new Map(), b: new Map() } };
    }

    function startTurn() {
        const g = s.game;
        g.votes = new Map();
        g.recent = [];
        g.draw = null;
        // Même durée pour les deux camps (une équipe vide est jouée par l'autre)
        g.turnEndsAt = Date.now() + (DUR.turn || s.options.turn * 1000);
        s.endsAt = g.turnEndsAt;
        emit();
        emitMeAll();
    }

    /** Coup choisi à la fin du tour : majorité (ex æquo tirés au sort), tirage pondéré, ou hasard sans vote */
    function resolveTurn() {
        const g = s.game;
        g.turnEndsAt = null;
        const counts = {};
        for (const m of g.votes.values()) counts[m] = (counts[m] || 0) + 1;
        const entries = Object.entries(counts);
        let move;
        g.random = false;
        if (!entries.length) {
            g.random = true;
            if (s.mode === 'problems') return failPuzzle('timeout');
            move = pick(g.chess.moves());
            g.draw = { winner: move, votes: [], random: true, endsAt: Date.now() + RANDOM_REVEAL_MS };
            s.endsAt = g.draw.endsAt;
            emit();
            return later(RANDOM_REVEAL_MS, () => playMove(move));
        } else if (s.options.decision !== 'majority' && s.mode === 'teams' && entries.length > 1) {
            const total = entries.reduce((a, [, n]) => a + n, 0);
            let r = Math.random() * total;
            move = entries.find(([, n]) => (r -= n) < 0)?.[0] || entries[0][0];
            g.draw = { winner: move, votes: entries.map(([m, n]) => ({ m, n })), endsAt: Date.now() + DRAW_REVEAL_MS };
            s.endsAt = g.draw.endsAt;
            emit();
            return later(DRAW_REVEAL_MS, () => playMove(move));
        } else {
            const best = Math.max(...entries.map(([, n]) => n));
            move = pick(entries.filter(([, n]) => n === best).map(([m]) => m));
        }
        playMove(move);
    }

    function playMove(san) {
        const g = s.game;
        if (!g || g.result) return;
        if (s.mode === 'problems') return checkPuzzleMove(san);
        const m = tryMove(g.chess, san);
        if (!m) return startTurn();
        g.history.push(m.san);
        g.lastMove = { from: m.from, to: m.to };
        g.draw = null;
        if (g.chess.isGameOver() || g.history.length >= (DUR.maxPlies || MAX_PLIES)) return endGame();
        startTurn();
    }

    // ------------------------------------------------------------------ problèmes
    function nextPuzzle() {
        const g = s.game;
        if (g.puzzleIndex >= PUZZLES_PER_SERIES) return endGame();
        const p = randomPuzzle(s.options.level);
        if (!p) return endGame();
        g.puzzleIndex++;
        g.puzzle = p;
        g.step = 0;
        g.chess = new Chess(p.fen);
        g.startFen = p.fen;
        g.history = [];
        g.lastMove = null;
        g.puzzleStatus = 'playing';
        // Premier coup : celui de l'adversaire, puis l'équipe cherche la suite
        later(REPLY_MS, () => {
            applyUci(p.moves[0]);
            g.step = 1;
            g.side = g.chess.turn();
            startTurn();
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
            startTurn();
        });
    }
    function solvePuzzle() {
        const g = s.game;
        g.score.solved++;
        g.puzzleStatus = 'solved';
        g.turnEndsAt = null;
        s.endsAt = Date.now() + PUZZLE_PAUSE_MS;
        emit();
        later(PUZZLE_PAUSE_MS, nextPuzzle);
    }
    function failPuzzle(reason, san = null) {
        const g = s.game;
        g.score.failed++;
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
        const c = g.chess;
        let result;
        if (s.mode === 'problems') {
            result = { kind: 'problems', solved: g.score.solved, total: g.score.solved + g.score.failed };
        } else if (c.isCheckmate()) {
            result = { kind: 'mate', winner: c.turn() === 'w' ? 'b' : 'w' };
        } else {
            const reason = c.isStalemate() ? 'stalemate' : c.isThreefoldRepetition() ? 'repetition'
                : c.isInsufficientMaterial() ? 'material' : g.history.length >= (DUR.maxPlies || MAX_PLIES) ? 'length' : 'draw';
            result = { kind: 'draw', reason };
        }
        g.result = result;
        g.turnEndsAt = null;
        const top = (side) => [...g.voteCount[side].entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([login, n]) => ({ login, n }));
        s.recap = {
            mode: s.mode,
            result,
            plies: g.history.length,
            durationMs: Date.now() - g.startedAt,
            players: { w: s.teams.w.length, b: s.teams.b.length },
            top: { w: top('w'), b: top('b') }
        };
        s.lastResult = result;
        setPhase('recap', DUR.recap);
    }

    // ------------------------------------------------------------------ minuteur commun
    let pending = null;
    function later(ms, fn) {
        clearTimeout(pending);
        pending = setTimeout(() => { pending = null; fn(); }, ms);
    }

    function tick() {
        const now = Date.now();
        // Personne ne regarde : tout s'arrête (le Phantom aussi) jusqu'au prochain viewer
        const idle = viewers() === 0;
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
            case 'play': if (s.game?.turnEndsAt) return resolveTurn();
        }
    }
    setInterval(tick, 250).unref?.();

    // ------------------------------------------------------------------ entrées (web aujourd'hui, chat Twitch demain)
    /** Inscription : l'équipe la moins nombreuse (problèmes : une seule équipe) ; possible en pleine partie */
    function join(login) {
        if (!LOGIN_RE.test(login || '') || teamOf(login)) return false;
        const side = s.mode === 'problems' ? 'w'
            : s.teams.w.length === s.teams.b.length ? pick(['w', 'b'])
            : s.teams.w.length < s.teams.b.length ? 'w' : 'b';
        s.teams[side].push(login);
        emit();
        emitMeAll(login);
        return side;
    }
    function leave(login) {
        for (const side of ['w', 'b']) s.teams[side] = s.teams[side].filter(l => l !== login);
        s.game?.votes.delete(login);
        emit();
        emitMeAll(login);
    }
    /** Vote d'un coup (SAN, UCI ou « e4 »), seulement pour l'équipe dont c'est le tour */
    function voteMove(login, text) {
        const g = s.game;
        if (s.phase !== 'play' || !g?.turnEndsAt || g.result) return false;
        const side = g.chess.turn();
        const team = teamOf(login);
        if (s.mode === 'problems' ? !team : !canPlay(team, side)) return false;
        const wanted = clean(text).toLowerCase();
        const m = g.chess.moves({ verbose: true }).find(x =>
            clean(x.san).toLowerCase() === wanted || x.from + x.to + (x.promotion || '') === wanted);
        if (!m) return false;
        if (g.votes.get(login) === m.san) return true;
        g.votes.set(login, m.san);
        g.recent.push({ u: login, m: m.san });
        if (g.recent.length > 30) g.recent.shift();
        const vc = g.voteCount[s.mode === 'problems' ? 'w' : side];
        vc.set(login, (vc.get(login) || 0) + 1);
        // Toute l'équipe a voté : le tour se termine juste après
        const voters = s.mode === 'problems' || !s.teams[side].length ? allPlayers() : s.teams[side];
        // (pas quand on est seul : on garde le temps de changer d'avis)
        if (voters.length > 1 && voters.every(l => g.votes.has(l))) {
            g.turnEndsAt = Math.min(g.turnEndsAt, Date.now() + ALL_VOTED_MS);
            s.endsAt = g.turnEndsAt;
        }
        emit();
        emitMeAll(login);
        return true;
    }
    function voteBallot(login, choice) {
        const b = s.ballot;
        if (!b || !LOGIN_RE.test(login || '')) return false;
        const c = b.choices.find(x => String(x) === String(choice));
        if (c === undefined) return false;
        b.votes.set(login, c);
        emit();
        emitMeAll(login);
        return true;
    }

    // ------------------------------------------------------------------ bots de test
    // Faux joueurs pour suivre un cycle complet : ils s'inscrivent, votent le mode et les options,
    // et votent les coups à des moments aléatoires, répartis sur 2-3 coups (tirage au sort lisible).
    // Ils ne comptent pas comme spectateurs : sans vrai viewer, la station reste en pause.
    const bots = { list: [], turn: 0, plans: new Map(), cands: null };
    function setBots(count = 0, { turn = 0 } = {}) {
        const n = Math.max(0, Math.min(BOT_NAMES.length, Number(count) || 0));
        for (const l of bots.list.slice(n)) leave(l);
        bots.list = BOT_NAMES.slice(0, n);
        bots.turn = n ? Math.max(5, Math.min(60, Number(turn) || 0)) || 0 : 0;
        bots.plans.clear();
        // Ajoutés en pleine partie : ils rejoignent tout de suite
        if (s.phase === 'play') for (const l of bots.list) if (!teamOf(l)) join(l);
        emit();
        return { bots: bots.list, turn: bots.turn || null };
    }
    /** Ce que le bot ferait maintenant (clé stable tant que la situation ne change pas) */
    function botSituation() {
        const g = s.game;
        if (s.phase === 'signup') return { key: `signup:${s.cycle}`, until: s.endsAt };
        if ((s.phase === 'voteMode' || s.phase === 'voteOptions') && s.ballot) return { key: `ballot:${s.cycle}:${s.ballot.id}`, until: s.endsAt };
        if (s.phase === 'play' && g?.turnEndsAt && !g.draw && !g.result) {
            return { key: `move:${s.cycle}:${g.puzzleIndex || 0}:${g.history.length}`, until: g.turnEndsAt };
        }
        return null;
    }
    function botCandidates(key) {
        if (bots.cands?.key === key) return bots.cands.moves;
        const g = s.game;
        const legal = g.chess.moves();
        const moves = [];
        if (s.mode === 'problems') {
            const uci = g.puzzle.moves[g.step] || '';
            const sol = g.chess.moves({ verbose: true }).find(m => m.from + m.to + (m.promotion || '') === uci);
            if (sol) moves.push(sol.san);
        }
        while (moves.length < 3 && moves.length < legal.length) {
            const m = pick(legal);
            if (!moves.includes(m)) moves.push(m);
        }
        bots.cands = { key, moves };
        return moves;
    }
    function botAct(login, key) {
        if (key.startsWith('signup')) return join(login);
        if (key.startsWith('ballot')) {
            const b = s.ballot;
            const prefer = { mode: ['teams', 'teams', 'problems'], decision: ['draw', 'band'], turn: bots.turn ? [bots.turn] : b.choices };
            return voteBallot(login, pick(prefer[b.id] || b.choices));
        }
        const g = s.game;
        const side = g.chess.turn();
        if (s.mode === 'teams' && !canPlay(teamOf(login), side)) return;
        const c = botCandidates(key);
        // Problèmes : la bonne réponse une fois sur deux ; partie : coups pondérés 3/2/1
        const r = Math.random();
        const m = s.mode === 'problems' ? (r < 0.5 ? c[0] : pick(c)) : c[r < 0.5 ? 0 : r < 0.83 ? 1 : 2] || c[0];
        voteMove(login, m);
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
                emitMe(socket.id);
            }
        });
        socket.on('h24:leave', () => {
            socket.leave(ROOM);
            sockets.delete(socket.id);
            emit();
        });
        const me = () => sockets.get(socket.id);
        socket.on('h24:signup', () => { const l = me(); if (l) join(l); });
        socket.on('h24:quit', () => { const l = me(); if (l) leave(l); });
        socket.on('h24:vote', (data = {}) => { const l = me(); if (l) voteMove(l, String(data.move || '').slice(0, 10)); });
        socket.on('h24:ballot', (data = {}) => { const l = me(); if (l) voteBallot(l, String(data.choice ?? '').slice(0, 20)); });
        socket.on('disconnect', () => {
            if (sockets.delete(socket.id)) emit();
        });
    });

    log('📺 Station 24/24 prête');
    return { state: s, join, leave, voteMove, voteBallot, publicState, setBots };
};
