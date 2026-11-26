/**
 * Statistiques persistantes : résultats des batailles Multi et votes des viewers.
 *
 * - Multi : le serveur détecte lui-même la fin de partie à partir de la dernière
 *   position reçue (mat, pat, nulle), sans faire confiance aux pages des streamers.
 * - Viewers : la page du streamer envoie, à chaque coup joué, la liste des viewers
 *   qui ont voté. Un viewer compte une seule fois par coup, même s'il a voté plusieurs fois.
 *   Les stats sont rangées sous la chaîne du token Twitch : personne ne peut écrire chez un autre.
 *
 * Stockage : fichiers JSON dans DATA_DIR, écrits en différé (2 s) pour ne pas
 * réécrire le disque à chaque coup.
 */
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');

const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
const MAX_GAMES = 2000;          // historique des batailles gardé
const MAX_VIEWERS = 20000;       // viewers suivis par chaîne
const MAX_TURNS_PER_POST = 50;
const MAX_VOTERS_PER_TURN = 2000;

function jsonStore(file, fallback) {
    let data = fallback();
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8')) || fallback();
    } catch (e) {
        if (e.code !== 'ENOENT') console.warn(`📊 ${path.basename(file)} illisible, repart de zéro:`, e.message);
    }
    let timer = null;
    const flush = () => {
        clearTimeout(timer);
        timer = null;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const tmp = file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(data));
            fs.renameSync(tmp, file);
        } catch (e) {
            console.error(`📊 Impossible d'écrire ${path.basename(file)}:`, e.message);
        }
    };
    return {
        get data() { return data; },
        save() { if (!timer) timer = setTimeout(flush, 2000); },
        flush() { if (timer) flush(); }
    };
}

const cleanName = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 50) : fallback);
const cleanAvatar = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v.slice(0, 300) : null);

module.exports = function setupStats({ app, requireTwitch, dataDir, rushRecords, economy }) {
    const multi   = jsonStore(path.join(dataDir, 'multi-results.json'), () => ({ games: [], channels: {} }));
    const viewers = jsonStore(path.join(dataDir, 'viewer-stats.json'), () => ({}));

    for (const sig of ['SIGTERM', 'SIGINT']) {
        process.once(sig, () => { multi.flush(); viewers.flush(); process.exit(0); });
    }

    /** Nom et avatar connus d'une chaîne (stats viewers, puis records Rush) */
    function profile(login) {
        const v = viewers.data[login];
        const r = rushRecords()[login];
        return {
            login,
            displayName: v?.displayName || r?.displayName || login,
            avatar:      v?.avatar || r?.avatar || null
        };
    }

    // ================= MULTI =================

    /** Enregistre le résultat si la position est terminale. Retourne l'entrée, ou null. */
    function recordMultiResult(game) {
        if (!game || game.recorded || !game.lastFen || !game.host || !game.guest) return null;
        let chess;
        try { chess = new Chess(game.lastFen); } catch { return null; }
        if (!chess.isGameOver()) return null;

        const result = chess.isCheckmate() ? (chess.turn() === 'w' ? 'black' : 'white') : 'draw';
        const reason = chess.isCheckmate() ? 'mate'
            : chess.isStalemate() ? 'stalemate'
            : chess.isThreefoldRepetition() ? 'repetition'
            : chess.isInsufficientMaterial() ? 'material' : 'fifty';
        game.recorded = true;

        const entry = { white: game.host, black: game.guest, result, reason, moves: game.moveCount || 0, at: Date.now() };
        const d = multi.data;
        d.games.push(entry);
        if (d.games.length > MAX_GAMES) d.games.splice(0, d.games.length - MAX_GAMES);
        for (const [login, color] of [[game.host, 'white'], [game.guest, 'black']]) {
            const c = d.channels[login] ||= { login, w: 0, d: 0, l: 0 };
            if (result === 'draw') c.d++;
            else if (result === color) c.w++;
            else c.l++;
            c.lastAt = entry.at;
        }
        multi.save();
        economy?.onMultiResult(entry);
        console.log(`⚔ Bataille terminée : ${game.host} vs ${game.guest} → ${result} (${reason})`);
        return entry;
    }

    const points = (c) => c.w * 3 + c.d;
    const publicGame = (g) => ({ ...g, whiteProfile: profile(g.white), blackProfile: profile(g.black) });

    const multiRanking = () => Object.values(multi.data.channels)
        .map(c => ({ ...profile(c.login), w: c.w, d: c.d, l: c.l, games: c.w + c.d + c.l, points: points(c), lastAt: c.lastAt }))
        .sort((a, b) => (b.points - a.points) || (b.w - a.w) || (a.games - b.games) || (b.lastAt - a.lastAt));

    app.get('/api/multi/leaderboard', (req, res) => {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const channels = multiRanking().slice(0, limit);
        const recent = multi.data.games.slice(-20).reverse().map(publicGame);
        res.json({ channels, recent, totalGames: multi.data.games.length });
    });

    app.get('/api/multi/channel/:login', (req, res) => {
        const login = String(req.params.login).toLowerCase();
        const c = multi.data.channels[login];
        if (!c) return res.status(404).json({ error: 'Aucune bataille pour cette chaîne' });
        const opp = {};
        const mine = multi.data.games.filter(g => g.white === login || g.black === login);
        for (const g of mine) {
            const color = g.white === login ? 'white' : 'black';
            const other = color === 'white' ? g.black : g.white;
            const o = opp[other] ||= { w: 0, d: 0, l: 0, lastAt: 0 };
            if (g.result === 'draw') o.d++; else if (g.result === color) o.w++; else o.l++;
            o.lastAt = Math.max(o.lastAt, g.at);
        }
        const opponents = Object.entries(opp)
            .map(([l, o]) => ({ ...profile(l), ...o, games: o.w + o.d + o.l }))
            .sort((a, b) => (b.games - a.games) || (b.lastAt - a.lastAt));
        const ranking = multiRanking();
        res.json({
            ...profile(login), w: c.w, d: c.d, l: c.l, games: c.w + c.d + c.l, points: points(c),
            rank: ranking.findIndex(r => r.login === login) + 1, total: ranking.length,
            opponents, recent: mine.slice(-10).reverse().map(publicGame)
        });
    });

    // ================= RECHERCHE DE CHAÎNE =================

    app.get('/api/channels/search', (req, res) => {
        const q = String(req.query.q || '').toLowerCase().trim().slice(0, 25);
        if (!q) return res.json({ channels: [] });
        const rush = rushRecords();
        const logins = new Set([...Object.keys(rush), ...Object.keys(multi.data.channels), ...Object.keys(viewers.data)]);
        const found = [];
        for (const login of logins) {
            const p = profile(login);
            const name = String(p.displayName).toLowerCase();
            const score = login.startsWith(q) || name.startsWith(q) ? 0
                : login.includes(q) || name.includes(q) ? 1 : -1;
            if (score < 0) continue;
            found.push({ ...p, score, rush: !!rush[login], multi: !!multi.data.channels[login], viewers: !!viewers.data[login] });
        }
        found.sort((a, b) => (a.score - b.score) || a.login.localeCompare(b.login));
        res.json({ channels: found.slice(0, 10).map(({ score, ...c }) => c) });
    });

    // ================= VIEWERS =================

    app.post('/api/stats/votes', requireTwitch, (req, res) => {
        const body  = req.body || {};
        const turns = Array.isArray(body.turns) ? body.turns.slice(0, MAX_TURNS_PER_POST) : [];
        if (!turns.length) return res.status(400).json({ error: 'Aucun tour' });

        const login = req.twitch.login;
        const now   = Date.now();
        const ch = viewers.data[login] ||= { login, displayName: login, avatar: null, turns: 0, puzzleTurns: 0, votes: 0, viewers: {} };
        ch.displayName = cleanName(body.displayName, ch.displayName);
        ch.avatar      = cleanAvatar(body.avatar) || ch.avatar;

        let counted = 0;
        const gains = [];   // pour l'économie (XP / pions)
        for (const t of turns) {
            const puzzle = t?.kind === 'puzzle';
            const seen = new Set();
            const voters = (Array.isArray(t?.voters) ? t.voters : []).slice(0, MAX_VOTERS_PER_TURN);
            for (const v of voters) {
                const vl = String(v?.login || '').toLowerCase();
                if (!LOGIN_RE.test(vl) || seen.has(vl)) continue;   // un viewer = un vote par coup
                seen.add(vl);
                const s = ch.viewers[vl] ||= { name: vl, votes: 0, picked: 0, puzzles: 0, solved: 0 };
                s.name = cleanName(v.name, s.name).slice(0, 25);
                if (puzzle) { s.puzzles++; if (v.picked) s.solved++; }
                else        { s.votes++;   if (v.picked) s.picked++; }
                s.lastAt = now;
            }
            if (!seen.size) continue;
            if (puzzle) ch.puzzleTurns++; else ch.turns++;
            ch.votes += seen.size;
            counted++;
            gains.push({ puzzle, voters: seen.size });
        }
        ch.lastAt = now;

        // Garde-fou : on oublie les viewers les moins actifs au-delà de la limite
        const ids = Object.keys(ch.viewers);
        if (ids.length > MAX_VIEWERS) {
            ids.sort((a, b) => (ch.viewers[a].votes + ch.viewers[a].puzzles) - (ch.viewers[b].votes + ch.viewers[b].puzzles))
               .slice(0, ids.length - MAX_VIEWERS)
               .forEach(id => delete ch.viewers[id]);
        }
        viewers.save();
        const gain = economy?.onTurns(login, gains) || null;
        res.json({ ok: true, turns: counted, gain });
    });

    const channelSummary = (ch) => ({
        login: ch.login, displayName: ch.displayName || ch.login, avatar: ch.avatar || null,
        turns: ch.turns || 0, puzzleTurns: ch.puzzleTurns || 0, votes: ch.votes || 0,
        viewers: Object.keys(ch.viewers || {}).length, lastAt: ch.lastAt || 0
    });

    app.get('/api/viewers', (req, res) => {
        const channels = Object.values(viewers.data).map(channelSummary)
            .sort((a, b) => (b.votes - a.votes) || (b.lastAt - a.lastAt))
            .slice(0, 50);
        res.json({ channels });
    });

    const SORTS = {
        votes:  (a, b) => (b.votes - a.votes) || (b.picked - a.picked),
        picked: (a, b) => (b.picked - a.picked) || (b.votes - a.votes),
        solved: (a, b) => (b.solved - a.solved) || (b.puzzles - a.puzzles)
    };

    app.get('/api/viewers/:channel', (req, res) => {
        const ch = viewers.data[String(req.params.channel).toLowerCase()];
        if (!ch) return res.status(404).json({ error: 'Aucune stat pour cette chaîne' });
        const sort  = SORTS[req.query.sort] ? req.query.sort : 'votes';
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const list = Object.entries(ch.viewers)
            .map(([login, s]) => ({ login, name: s.name || login, votes: s.votes, picked: s.picked, puzzles: s.puzzles, solved: s.solved, lastAt: s.lastAt }))
            .filter(s => sort === 'solved' ? s.puzzles > 0 : s.votes > 0)
            .sort(SORTS[sort])
            .slice(0, limit);
        res.json({ channel: channelSummary(ch), sort, viewers: list });
    });

    // ================= VUE D'ENSEMBLE =================

    app.get('/api/stats/overview', (req, res) => {
        const rush = Object.values(rushRecords());
        let runs = 0, bestRating = 0;
        for (const r of rush) for (const m of Object.values(r.modes || {})) {
            runs += m.runs || 0;
            bestRating = Math.max(bestRating, m.best?.maxRating || 0);
        }
        const vch = Object.values(viewers.data);
        res.json({
            rush:    { channels: rush.length, runs, bestRating },
            multi:   { games: multi.data.games.length, channels: Object.keys(multi.data.channels).length },
            viewers: {
                channels: vch.length,
                viewers:  vch.reduce((n, c) => n + Object.keys(c.viewers || {}).length, 0),
                votes:    vch.reduce((n, c) => n + (c.votes || 0), 0)
            }
        });
    });

    return { recordMultiResult, stores: { multi, viewers } };
};
module.exports.jsonStore = jsonStore;
