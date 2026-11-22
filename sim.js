/**
 * Simulation d'activité, pour voir le site « en pleine utilisation » puis tout retirer.
 *
 * - seed       : historique fictif (records Rush, batailles Multi, stats viewers) sur des chaînes sim_*
 * - live-start : parties en direct jouées par le serveur (Multi, Mono, Rush, partie libre),
 *                visibles dans Parcourir et regardables en spectateur ; elles alimentent les stats
 * - live-stop  : arrête les parties en direct
 * - purge      : retire tout ce qui concerne les chaînes sim_* (les vraies données ne bougent pas)
 * - snapshot / restore : copie des trois fichiers de stats, et retour à cette copie
 *
 * Accès : POST /api/sim/<action>, uniquement depuis la machine elle-même (pas via le proxy)
 * et avec la clé tirée au démarrage, écrite hors du dossier servi. Voir sim-cli.js.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Chess } = require('chess.js');

const PREFIX = 'sim_';
const KEY_FILE = path.join(os.tmpdir(), 'chess-sim-key');
const isSim = (login) => typeof login === 'string' && login.startsWith(PREFIX);

// ---------- Aléatoire ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const int = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DAY = 86400e3;

// ---------- Noms fictifs ----------
const CHANNEL_NAMES = [
    'PionPresse', 'LaTourInfernale', 'FouDuRoi', 'CavalierNoir42', 'EchecEtMatheo', 'RoqueNRoll',
    'GambitDuDimanche', 'DameEnDanger', 'ZugzwangTV', 'BlitzBaguette', 'LePatDuSoir', 'EnPassantFR',
    'MatDuBerger', 'SicilienneSauvage', 'TourDeGarde', 'Pat_et_Mat', 'LaFourchetteRoyale', 'KnightOwlChess',
    'BishopBlunders', 'RookieRush', 'PawnStormLive', 'CheckmateCafe', 'QueenTrapQueen', 'EndgameEmma',
    'TacticToast', 'BlunderBus', 'CastleCrew', 'PromotionParty', 'OpenFileOli', 'DoubleCheckDan',
    'CaroKannCarl', 'LondonLuna'
];
const SYL = ['ka', 'zu', 'mi', 'lo', 'ra', 'ti', 'no', 'vel', 'dar', 'pix', 'gro', 'ben', 'lu', 'sha', 'kor', 'fi', 'mo', 'zen', 'tak', 'ri'];
const WORDS = ['pion', 'tour', 'fou', 'roi', 'dame', 'blitz', 'gg', 'pog', 'chat', 'lynx', 'wolf', 'fox', 'kappa', 'pixel', 'neo', 'zz'];
function viewerName() {
    const base = chance(0.5)
        ? pick(SYL) + pick(SYL) + (chance(0.5) ? pick(SYL) : '')
        : pick(WORDS) + '_' + pick(WORDS);
    const name = base + (chance(0.6) ? int(1, 999) : '');
    return name.charAt(0).toUpperCase() + name.slice(1);
}
const loginOf = (name) => (PREFIX + name.toLowerCase().replace(/[^a-z0-9_]/g, '')).slice(0, 25);

// ---------- Choix des coups : glouton à deux demi-coups, avec du bruit ----------
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function material(chess, color) {
    let s = 0;
    for (const row of chess.board()) for (const sq of row) if (sq) s += (sq.color === color ? 1 : -1) * VAL[sq.type];
    return s;
}
function chooseMove(chess, skill = 0.75) {
    const me = chess.turn();
    const moves = chess.moves({ verbose: true });
    if (!chess.history().length || !chance(skill)) return pick(moves);
    let best = null, bestScore = -Infinity;
    for (const m of moves) {
        chess.move(m);
        let score;
        if (chess.isCheckmate()) score = 1000;
        else if (chess.isDraw()) score = -0.5;
        else {
            // Meilleure prise de l'adversaire en réponse
            let worst = 0;
            for (const r of chess.moves({ verbose: true })) {
                if (!r.captured) continue;
                worst = Math.max(worst, VAL[r.captured] - (chess.isAttacked?.(r.to, me) ? VAL[r.piece] : 0));
            }
            score = material(chess, me) - worst + (chess.inCheck() ? 0.3 : 0) + rnd(0, 0.8);
        }
        chess.undo();
        if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
}

module.exports = function setupSim({ app, io, games, multiRooms, stats, rush, emitSpectate, broadcastGamesList, newPublicId, dataDir, station }) {
    const key = crypto.randomBytes(24).toString('hex');
    try { fs.writeFileSync(KEY_FILE, key, { mode: 0o600 }); } catch (e) { console.warn('🧪 Clé de simulation non écrite:', e.message); }

    const { multi, viewers } = stats.stores;

    // ---------- Stats viewers d'une chaîne fictive ----------
    function ensureChannel(name) {
        const login = loginOf(name);
        const ch = viewers.data[login] ||= { login, displayName: name, avatar: null, turns: 0, puzzleTurns: 0, votes: 0, viewers: {} };
        if (!ch.pool) {
            // Viewers habituels (non publié par l'API, qui ne lit que les champs connus)
            const size = int(15, 260);
            Object.defineProperty(ch, 'pool', { value: Array.from({ length: size }, viewerName), enumerable: false, writable: true });
        }
        return ch;
    }
    function addTurn(ch, { puzzle = false, at = Date.now() } = {}) {
        const pool = ch.pool || Object.values(ch.viewers).map(v => v.name);
        const n = Math.min(pool.length, Math.max(1, Math.round(pool.length * rnd(0.04, 0.3))));
        const voters = shuffle(pool).slice(0, n);
        const pickedShare = puzzle ? rnd(0.3, 0.8) : rnd(0.25, 0.6);
        for (const name of voters) {
            const vl = name.toLowerCase();
            const s = ch.viewers[vl] ||= { name, votes: 0, picked: 0, puzzles: 0, solved: 0 };
            const picked = chance(pickedShare);
            if (puzzle) { s.puzzles++; if (picked) s.solved++; } else { s.votes++; if (picked) s.picked++; }
            s.lastAt = Math.max(s.lastAt || 0, at);
        }
        if (puzzle) ch.puzzleTurns++; else ch.turns++;
        ch.votes += voters.length;
        ch.lastAt = Math.max(ch.lastAt || 0, at);
    }

    function addRushRun(name, mode, score, at = Date.now()) {
        const login = loginOf(name);
        const records = rush.get();
        const r = records[login] ||= { login, userId: 'sim', displayName: name, avatar: null, modes: {} };
        const prev = r.modes[mode];
        const run = { score, maxRating: 600 + score * int(45, 75), durationMs: score * int(25, 70) * 1000, at };
        r.modes[mode] = {
            best:      !prev || score > prev.best.score ? run : prev.best,
            runs:      (prev?.runs || 0) + 1,
            lastScore: score,
            lastAt:    at,
            history:   [...(prev?.history || []), { score, at }].slice(-20)
        };
    }
    const rushScore = (mode) => Math.max(0, Math.round({ 0: rnd(6, 40), 30: rnd(4, 28), 60: rnd(5, 32), 120: rnd(5, 36) }[mode] * rnd(0.5, 1.1)));

    function addMultiResult(white, black, result, reason, moves, at) {
        const d = multi.data;
        d.games.push({ white, black, result, reason, moves, at });
        for (const [login, color] of [[white, 'white'], [black, 'black']]) {
            const c = d.channels[login] ||= { login, w: 0, d: 0, l: 0 };
            if (result === 'draw') c.d++; else if (result === color) c.w++; else c.l++;
            c.lastAt = Math.max(c.lastAt || 0, at);
        }
    }

    // ---------- seed : un mois d'historique ----------
    function seed({ channels = 28, days = 30, battles = 160 } = {}) {
        const backup = snapshot().snapshot;   // filet de sécurité avant d'écrire
        const names = shuffle(CHANNEL_NAMES).slice(0, Math.min(channels, CHANNEL_NAMES.length));
        const now = Date.now();
        const when = () => now - Math.pow(Math.random(), 1.6) * days * DAY;   // plus d'activité récente
        // Quelques chaînes très actives, beaucoup de petites
        const weight = Object.fromEntries(names.map(n => [n, Math.pow(Math.random(), 2) * 10 + 0.5]));
        const weighted = names.flatMap(n => Array(Math.ceil(weight[n])).fill(n));

        for (const name of names) {
            const ch = ensureChannel(name);
            const turns = Math.round(weight[name] * int(20, 90));
            for (let i = 0; i < turns; i++) addTurn(ch, { puzzle: chance(0.25), at: when() });
            if (chance(0.7)) {
                for (const mode of ['0', '30', '60', '120']) {
                    if (mode !== '0' && !chance(0.45)) continue;
                    const runs = int(1, Math.ceil(weight[name] * 2));
                    const times = Array.from({ length: runs }, when).sort((a, b) => a - b);
                    times.forEach(t => addRushRun(name, mode, rushScore(mode), t));
                }
            }
        }
        const battleTimes = Array.from({ length: battles }, when).sort((a, b) => a - b);
        for (const at of battleTimes) {
            const a = pick(weighted); let b = pick(weighted);
            while (b === a) b = pick(names);
            const r = Math.random();
            const result = r < 0.46 ? 'white' : r < 0.88 ? 'black' : 'draw';
            const reason = result === 'draw' ? pick(['stalemate', 'repetition', 'material', 'fifty']) : 'mate';
            addMultiResult(loginOf(a), loginOf(b), result, reason, int(18, 140), at);
        }
        multi.data.games.sort((x, y) => x.at - y.at);
        multi.save(); viewers.save(); rush.save();
        return { backup, channels: names.length, battles, viewers: names.reduce((n, x) => n + Object.keys(viewers.data[loginOf(x)].viewers).length, 0) };
    }

    // ---------- live : parties jouées par le serveur ----------
    const live = { running: false, timers: new Set(), ids: new Set(), opts: null };
    const later = (fn, ms) => { const t = setTimeout(() => { live.timers.delete(t); if (live.running) fn(); }, ms); live.timers.add(t); };
    const simNames = () => Object.values(viewers.data).filter(c => isSim(c.login)).map(c => c.displayName);
    const busy = () => new Set([...live.ids].flatMap(id => { const g = games[id] || multiRooms[id]; return g ? [g.host, g.guest, g.a, g.b].filter(Boolean) : []; }));
    const freeName = () => { const b = busy(); const free = simNames().filter(n => !b.has(loginOf(n))); return free.length ? pick(free) : null; };

    function endGame(id, reason = 'over') {
        const g = games[id];
        if (!g) return;
        g.status = 'ended';
        io.to('spec:' + g.publicId).emit('spectate:ended', { reason });
        delete games[id];
        live.ids.delete(id);
        broadcastGamesList();
    }

    /** Multi entre deux chaînes fictives : salon d'abord (privé, on peut le regarder), puis partie */
    function startMulti() {
        const a = freeName(); if (!a) return;
        const host = loginOf(a);
        const id = `${host}-sim${int(1000, 9999)}`;
        const settings = { timerDuration: pick([20, 30, 45]), majorityMode: chance(0.5), followersOnly: chance(0.2), subsOnly: false };
        // Salon privé : affiché dans Parcourir mais sans bouton Rejoindre (aucun vrai navigateur derrière)
        multiRooms[id] = { gameId: id, publicId: newPublicId(), a: host, b: null, isPublic: false, settings, sockets: {}, endsAt: null, timeout: null, createdAt: Date.now() };
        live.ids.add(id);
        broadcastGamesList();
        later(() => {
            const room = multiRooms[id]; if (!room) return;
            const bName = freeName(); if (!bName) { delete multiRooms[id]; live.ids.delete(id); broadcastGamesList(); return; }
            room.b = loginOf(bName);
            emitSpectate(room); broadcastGamesList();
            later(() => {
                delete multiRooms[id];
                games[id] = { gameId: id, publicId: room.publicId, isPublic: false, host: room.a, guest: room.b, settings,
                    hostSocket: null, guestSocket: null, status: 'playing', moveCount: 0, startedAt: Date.now(), lastFen: null, sim: true };
                emitSpectate(games[id]); broadcastGamesList();
                playLoop(id, { channels: [ensureChannel(a), ensureChannel(bName)], multi: true });
            }, live.opts.lobbyMs);
        }, rnd(0.3, 1) * live.opts.lobbyMs);
    }

    /** Partie d'une seule chaîne (Mono, partie libre) */
    function startSolo(mode) {
        const name = freeName(); if (!name) return;
        const id = `live-sim-${newPublicId()}`;
        games[id] = { gameId: id, publicId: newPublicId(), host: loginOf(name), guest: null, mode, status: 'playing',
            moveCount: 0, players: mode === 'mono' ? int(4, 60) : null, startedAt: Date.now(), lastFen: null, orientation: 'white', settings: null, sim: true };
        live.ids.add(id);
        broadcastGamesList(); emitSpectate(games[id]);
        playLoop(id, { channels: [ensureChannel(name)] });
    }

    /**
     * Un tour de vote vu par les spectateurs : minuteur, puis votes du chat qui arrivent
     * peu à peu (le coup finalement joué est le plus voté, en général).
     */
    function voteRound(id, winner, candidates, delay, { rush = null, noTimer = false } = {}) {
        const g = games[id]; if (!g) return;
        const total = Math.max(5, Math.ceil(live.opts.moveMs * 1.4 / 1000));
        const others = candidates.filter(m => m !== winner);
        const tally = new Map();
        g.detail = { votes: [], timer: noTimer ? null : { endsAt: Date.now() + delay, total, paused: false, left: null }, rush, wheel: g.wheel || null, draw: null };
        emitSpectate(g);
        const ticks = Math.floor(delay / 1300);
        for (let i = 1; i < ticks; i++) {
            later(() => {
                const cur = games[id]; if (!cur?.detail) return;
                for (let k = int(1, 4); k > 0; k--) {
                    const m = !others.length || chance(0.55) ? winner : pick(others);
                    tally.set(m, (tally.get(m) || 0) + 1);
                }
                cur.detail.votes = [...tally].map(([m, n]) => ({ m, n })).sort((a, b) => b.n - a.n);
                emitSpectate(cur);
            }, i * 1300);
        }
        return tally;
    }

    /** Tirage pondéré par les votes, comme la roue des joueurs */
    function weightedPick(tally) {
        const total = [...tally.values()].reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (const [m, n] of tally) { r -= n; if (r <= 0) return m; }
        return [...tally.keys()][0];
    }

    function playLoop(id, { channels, multi: isMulti = false }) {
        const chess = new Chess();
        if (games[id]) {
            games[id].history = [];
            // Comme chez les vrais joueurs : bande (souvent), roue classique, ou vote à la majorité
            games[id].wheel = pick(['band', 'band', 'classic', null]);
        }
        const DRAW_MS = 5000;
        const turn = () => {
            const g = games[id]; if (!g) return;
            const move = chooseMove(chess);
            const candidates = shuffle(chess.moves()).slice(0, int(2, 5));
            const delay = rnd(0.6, 1.4) * live.opts.moveMs;
            const tally = voteRound(id, move.san, [move.san, ...candidates], delay);
            later(() => {
                const cur = games[id]; if (!cur) return;
                if (!tally?.size) return step(move.san);
                const votes = [...tally].map(([m, n]) => ({ m, n })).sort((a, b) => b.n - a.n);
                if (!cur.wheel) return step(votes[0].m);
                // Tirage : la roue / bande tourne, puis le gagnant reste affiché 2 s
                const winner = weightedPick(tally);
                cur.detail = { votes, timer: null, rush: null, wheel: cur.wheel, draw: { votes, winner, duration: DRAW_MS, endsAt: Date.now() + DRAW_MS } };
                emitSpectate(cur);
                later(() => step(winner), DRAW_MS + 2200);
            }, delay);
        };
        const step = (san) => {
            const g = games[id]; if (!g) return;
            const ch = channels[chess.turn() === 'w' || channels.length === 1 ? 0 : 1];
            const move = chess.move(san) || chess.move(chooseMove(chess));
            addTurn(ch);
            viewers.save();
            g.lastFen = chess.fen(); g.lastMove = { from: move.from, to: move.to }; g.moveCount++;
            g.history.push(move.san);
            g.detail = null;
            if (isMulti) {
                const result = stats.recordMultiResult(g);
                if (result) g.result = result.result;
            }
            emitSpectate(g);
            if (g.moveCount % 10 === 1) broadcastGamesList();
            if (chess.isGameOver() || g.moveCount >= 220) {
                // Le résultat reste affiché un moment aux spectateurs
                later(() => endGame(id, g.result ? 'over' : 'left'), 20000);
                later(fill, 30000);
                return;
            }
            later(turn, 800);
        };
        later(turn, 1500);
    }

    /** Puzzle Rush : position qui change à chaque puzzle, record enregistré en fin de run */
    function startRush() {
        const name = freeName(); if (!name) return;
        const id = `live-sim-${newPublicId()}`;
        const mode = pick(['0', '0', '30', '60', '120']);
        const ch = ensureChannel(name);
        games[id] = { gameId: id, publicId: newPublicId(), host: loginOf(name), guest: null, mode: 'rush', status: 'playing',
            moveCount: 0, players: null, startedAt: Date.now(), lastFen: null, orientation: 'white', settings: null, sim: true };
        live.ids.add(id);
        broadcastGamesList();
        let solved = 0, errors = 0;
        const rushInfo = () => ({ score: solved, strikes: errors, maxStrikes: 3, rating: 600 + solved * 60, mode });
        const puzzle = () => {
            const g = games[id]; if (!g) return;
            const c = new Chess();
            for (let i = int(14, 50); i > 0 && !c.isGameOver(); i--) c.move(chooseMove(c, 0.6));
            if (c.isGameOver()) return later(puzzle, 500);
            g.lastFen = c.fen(); g.lastMove = null; g.orientation = c.turn() === 'w' ? 'white' : 'black';
            g.history = [];
            const delay = rnd(0.6, 1.4) * live.opts.moveMs * 1.5;
            voteRound(id, chooseMove(c).san, shuffle(c.moves()).slice(0, int(2, 4)), delay, { rush: rushInfo(), noTimer: mode === '0' });
            later(() => {
                const ok = chance(Math.max(0.35, 0.9 - solved * 0.025));
                ok ? solved++ : errors++;
                g.moveCount = solved;
                g.detail = { votes: [], timer: null, rush: rushInfo() };
                emitSpectate(g);
                addTurn(ch, { puzzle: true }); viewers.save();
                broadcastGamesList();
                if (errors >= 3) {
                    addRushRun(name, mode, solved); rush.save();
                    later(() => endGame(id), 8000);
                    later(fill, 20000);
                } else later(puzzle, 3000);
            }, rnd(0.6, 1.4) * live.opts.moveMs * 1.5);
        };
        puzzle();
    }

    /** Garde le nombre voulu de parties en cours */
    function fill() {
        if (!live.running) return;
        const count = (pred) => [...live.ids].filter(pred).length;
        const kind = (id) => (multiRooms[id] || games[id]?.mode === undefined ? 'multi' : games[id].mode);
        const want = live.opts.games;
        const plan = { multi: Math.ceil(want * 0.45), mono: Math.ceil(want * 0.2), rush: Math.ceil(want * 0.2), sandbox: 1 };
        for (const [k, n] of Object.entries(plan)) {
            for (let i = count(id => kind(id) === k); i < n; i++) {
                if (k === 'multi') startMulti(); else if (k === 'rush') startRush(); else startSolo(k);
            }
        }
    }

    function liveStart({ games: n = 8, moveMs = 8000, lobbyMs = 45000 } = {}) {
        if (!simNames().length) seed();
        live.opts = { games: Math.min(20, Math.max(1, n)), moveMs: Math.max(1000, moveMs), lobbyMs: Math.max(3000, lobbyMs) };
        if (live.running) return { running: true, ...live.opts };
        live.running = true;
        fill();
        return { running: true, ...live.opts };
    }

    function liveStop() {
        live.running = false;
        live.timers.forEach(clearTimeout); live.timers.clear();
        for (const id of [...live.ids]) {
            if (multiRooms[id]) {
                io.to('spec:' + multiRooms[id].publicId).emit('spectate:ended', { reason: 'closed' });
                delete multiRooms[id];
            }
            endGame(id, 'left');
            live.ids.delete(id);
        }
        broadcastGamesList();
        return { running: false };
    }

    // ---------- purge, snapshot, restore ----------
    function purge() {
        liveStop();
        const records = rush.get();
        const removed = { rush: 0, battles: 0, channels: 0 };
        for (const login of Object.keys(records)) if (isSim(login)) { delete records[login]; removed.rush++; }
        const before = multi.data.games.length;
        multi.data.games = multi.data.games.filter(g => !isSim(g.white) && !isSim(g.black));
        removed.battles = before - multi.data.games.length;
        for (const login of Object.keys(multi.data.channels)) if (isSim(login)) delete multi.data.channels[login];
        for (const login of Object.keys(viewers.data)) if (isSim(login)) { delete viewers.data[login]; removed.channels++; }
        multi.save(); viewers.save(); rush.save();
        return removed;
    }

    const SNAP_DIR = path.join(dataDir, '.snapshots');
    const snapData = () => ({ 'rush-records.json': rush.get(), 'multi-results.json': multi.data, 'viewer-stats.json': viewers.data });
    function snapshot() {
        const name = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.join(SNAP_DIR, name);
        fs.mkdirSync(dir, { recursive: true });
        for (const [file, data] of Object.entries(snapData())) fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
        return { snapshot: name };
    }
    const listSnapshots = () => { try { return fs.readdirSync(SNAP_DIR).sort(); } catch { return []; } };
    function restore({ name } = {}) {
        const all = listSnapshots();
        const chosen = name ? all.find(n => n === name) : all[all.length - 1];
        if (!chosen) throw Object.assign(new Error('Aucun snapshot'), { status: 404 });
        liveStop();
        const read = (f) => JSON.parse(fs.readFileSync(path.join(SNAP_DIR, chosen, f), 'utf8'));
        rush.set(read('rush-records.json'));
        const m = read('multi-results.json');
        multi.data.games = m.games || []; multi.data.channels = m.channels || {};
        const v = read('viewer-stats.json');
        for (const k of Object.keys(viewers.data)) delete viewers.data[k];
        Object.assign(viewers.data, v);
        multi.save(); viewers.save(); rush.save();
        return { restored: chosen };
    }

    function status() {
        const simCount = (obj) => Object.keys(obj).filter(isSim).length;
        return {
            live: { running: live.running, ...live.opts, current: live.ids.size },
            sim: { rush: simCount(rush.get()), multiChannels: simCount(multi.data.channels),
                battles: multi.data.games.filter(g => isSim(g.white) || isSim(g.black)).length, viewerChannels: simCount(viewers.data) },
            real: { rush: Object.keys(rush.get()).length - simCount(rush.get()), battles: multi.data.games.filter(g => !isSim(g.white) && !isSim(g.black)).length,
                viewerChannels: Object.keys(viewers.data).length - simCount(viewers.data) },
            snapshots: listSnapshots()
        };
    }

    // ---------- API locale ----------
    const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
    // Bots de la page 24/24 (count=0 pour les retirer, turn=10 : durée de tour de test proposée au vote, plies=20 : parties courtes)
    const h24Bots = (o) => station ? station.setBots(o.count, { turn: o.turn, plies: o.plies }) : { error: 'station absente' };
    const ACTIONS = { seed, 'live-start': liveStart, 'live-stop': liveStop, purge, snapshot, restore, status, 'h24-bots': h24Bots };
    app.post('/api/sim/:action', (req, res) => {
        const given = String(req.headers['x-sim-key'] || '');
        const ok = LOOPBACK.has(req.socket.remoteAddress) && !req.headers['x-forwarded-for']
            && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
        if (!ok) return res.status(404).end();
        const fn = ACTIONS[req.params.action];
        if (!fn) return res.status(400).json({ error: 'Action inconnue', actions: Object.keys(ACTIONS) });
        try {
            const out = fn(req.body || {});
            console.log(`🧪 Simulation : ${req.params.action}`, JSON.stringify(out).slice(0, 200));
            res.json(out);
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message });
        }
    });

    return { isSim, status };
};

module.exports.KEY_FILE = KEY_FILE;
