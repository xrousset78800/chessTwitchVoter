/**
 * Pronostics sur les parties de tournoi chess.com suivies sur /tournament :
 *   - deviner le prochain coup de la partie (un prono par position, modifiable tant que le coup n'est pas joué) ;
 *   - désigner le vainqueur (1-0, ½-½, 0-1) jusqu'à la fin de la partie : gain plein jusqu'au coup
 *     RULES.predict.winnerFull, puis dégressif jusqu'à winnerMin au coup winnerFade (coup du dernier vote).
 * Tout est vérifié ici, avec les données de la salle chess.com (cache commun avec le proxy) :
 * un prono n'est accepté que sur la position en cours, et il est jugé sur le coup réellement joué.
 * Gains (XP / pions, dans le plafond quotidien) : RULES.predict de economy.js.
 */
const path = require('path');
const { Chess } = require('chess.js');

const MAX_RESULTS = 30;               // derniers pronos jugés gardés par compte
const PENDING_TTL = 2 * 86400e3;      // un prono jamais jugé (partie disparue) est oublié après 2 jours
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const PICKS = ['1-0', '1/2-1/2', '0-1'];

const boardOf = fen => String(fen || '').split(' ').slice(0, 2).join(' ');   // pièces + trait
const fullMove = fen => parseInt(String(fen || '').split(' ')[5], 10) || 1;
const normResult = r => (r === '½-½' ? '1/2-1/2' : r);

function applyUci(fen, uci) {
    try {
        const c = new Chess(fen);
        const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
        return m ? { san: m.san, fen: c.fen() } : null;
    } catch { return null; }
}

module.exports = function setupPredictions({ app, requireTwitch, dataDir, jsonStore, economy, fetchRoom, fetchGame }) {
    const store = jsonStore(path.join(dataDir, 'predictions.json'), () => ({}));
    for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => store.flush());
    const R = () => economy.RULES.predict;
    /** Part du gain « vainqueur » selon le coup auquel le vote a été donné */
    const winnerFactor = mv => {
        const { winnerFull: full = 10, winnerFade: fade = 40, winnerMin: min = 0.25 } = R();
        if (!mv || mv <= full) return 1;
        return Math.max(min, 1 - (1 - min) * (mv - full) / Math.max(1, fade - full));
    };

    const user = login => store.data[login] ||= { moves: {}, winners: {}, results: [] };
    const statsOf = login => {
        economy.grant(login, 'predict', {});           // crée le compte économie au besoin
        const a = economy.store.data[login];
        return a.stats ||= {};
    };
    const publicStats = login => {
        const st = economy.store.data[login]?.stats || {};
        return {
            moveHits: st.predictMoveHits || 0, moveTotal: st.predictMoves || 0,
            streak: st.predictStreak || 0, bestStreak: st.predictBestStreak || 0,
            winnerHits: st.predictWinnerHits || 0, winnerTotal: st.predictWinners || 0,
        };
    };

    /** Partie de la salle : { game, room } ou erreur HTTP */
    async function findGame(room, gameId) {
        const r = await fetchRoom(room);
        if (!r.ok) throw Object.assign(new Error(`chess.com HTTP ${r.status}`), { status: 502 });
        const game = (r.body.games || []).find(g => String(g.id) === String(gameId));
        if (!game) throw Object.assign(new Error('Partie introuvable'), { status: 404 });
        return { game, data: r.body };
    }

    function pushResult(login, res) {
        const u = user(login);
        u.results.push(res);
        if (u.results.length > MAX_RESULTS) u.results.splice(0, u.results.length - MAX_RESULTS);
    }

    /** Coup réellement joué depuis la position du prono (liste des coups si plusieurs coups sont passés) */
    async function playedFrom(p, game) {
        const direct = applyUci(p.fen, p.uci);
        if (direct && boardOf(direct.fen) === boardOf(game.currentFEN)) return { uci: p.uci, san: direct.san };
        const roundSlug = p.round;
        if (!roundSlug || !p.slug) return null;
        const moves = await fetchGame(p.room, roundSlug, p.slug).catch(() => null);
        if (!moves) return null;
        const c = new Chess();
        for (const cbn of moves) {
            const [coords] = String(cbn).split('_');
            if (boardOf(c.fen()) === boardOf(p.fen)) {
                const m = applyUci(c.fen(), coords);
                return m ? { uci: coords, san: m.san } : null;
            }
            try { c.move({ from: coords.slice(0, 2), to: coords.slice(2, 4), promotion: coords[4] || 'q' }); } catch { return null; }
        }
        return null;
    }

    /** Juge les pronos en attente de ce compte dans cette salle */
    async function resolve(login, room) {
        const u = user(login);
        const now = Date.now();
        let r;
        try { r = await fetchRoom(room); } catch { return; }
        if (!r.ok) return;
        const games = new Map((r.body.games || []).map(g => [String(g.id), g]));
        let changed = false;

        for (const [key, p] of Object.entries(u.moves)) {
            if (p.room !== room) {
                if (now - p.at > PENDING_TTL) { delete u.moves[key]; changed = true; }
                continue;
            }
            const game = games.get(String(p.gameId));
            if (!game) { if (now - p.at > PENDING_TTL) { delete u.moves[key]; changed = true; } continue; }
            if (boardOf(game.currentFEN) === boardOf(p.fen)) {
                // Partie finie sans nouveau coup (abandon, temps, nulle) : prono annulé
                if (game.result && game.result !== '*') { delete u.moves[key]; changed = true; }
                continue;
            }
            const played = await playedFrom(p, game);
            delete u.moves[key];
            changed = true;
            if (!played) continue;                          // coup introuvable : ni gagné ni perdu
            const hit = played.uci.slice(0, 4) === p.uci.slice(0, 4) && (played.uci[4] || 'q') === (p.uci[4] || 'q');
            const st = statsOf(login);
            st.predictMoves = (st.predictMoves || 0) + 1;
            let gain = null;
            if (hit) {
                st.predictMoveHits = (st.predictMoveHits || 0) + 1;
                st.predictStreak = (st.predictStreak || 0) + 1;
                st.predictBestStreak = Math.max(st.predictBestStreak || 0, st.predictStreak);
                const bonus = st.predictStreak % R().streak.every === 0 ? R().streak : { xp: 0, coins: 0 };
                gain = economy.grant(login, 'predict', { xp: R().move.xp + bonus.xp, coins: R().move.coins + bonus.coins, capped: true });
            } else {
                st.predictStreak = 0;
            }
            pushResult(login, { kind: 'move', key, at: now, hit, guess: p.san, played: played.san, streak: st.predictStreak, gain: gain && { xp: gain.xp, coins: gain.coins } });
        }

        for (const [key, w] of Object.entries(u.winners)) {
            if (w.room !== room) {
                if (now - w.at > 30 * 86400e3) { delete u.winners[key]; changed = true; }
                continue;
            }
            const game = games.get(String(w.gameId));
            if (!game || !game.result || game.result === '*') continue;
            const result = normResult(game.result);
            if (!PICKS.includes(result)) continue;
            delete u.winners[key];
            changed = true;
            const hit = w.pick === result;
            const st = statsOf(login);
            st.predictWinners = (st.predictWinners || 0) + 1;
            let gain = null;
            if (hit) {
                st.predictWinnerHits = (st.predictWinnerHits || 0) + 1;
                const g = result === '1/2-1/2' ? R().winnerDraw : R().winner;
                const f = winnerFactor(w.mv);
                gain = economy.grant(login, 'predict', { xp: Math.max(1, Math.round(g.xp * f)), coins: Math.max(1, Math.round(g.coins * f)), capped: true, key: `pw:${key}` });
            }
            pushResult(login, { kind: 'winner', key, at: now, hit, pick: w.pick, result, names: w.names, gain: gain && { xp: gain.xp, coins: gain.coins } });
        }
        if (changed) { store.save(); economy.checkAchievements?.(login); }
    }

    const str = (v, max = 160) => (typeof v === 'string' || typeof v === 'number') ? String(v).slice(0, max) : '';
    const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

    app.get('/api/predict/state', requireTwitch, async (req, res) => {
        try {
            const login = req.twitch.login;
            const room = str(req.query.room), gameId = str(req.query.game);
            if (room) await resolve(login, room);
            const u = user(login);
            const key = `${room}:${gameId}`;
            const since = Number(req.query.since) || 0;
            res.json({
                move: u.moves[key] ? { fen: u.moves[key].fen, uci: u.moves[key].uci, san: u.moves[key].san } : null,
                winner: u.winners[key] ? { pick: u.winners[key].pick } : null,
                votes: tally(key),
                results: u.results.filter(r => r.at > since),
                stats: publicStats(login),
                rules: R(),
                now: Date.now(),
            });
        } catch (err) { fail(res, err); }
    });

    app.post('/api/predict/move', requireTwitch, async (req, res) => {
        try {
            const login = req.twitch.login;
            const room = str(req.body?.room), gameId = str(req.body?.game), uci = str(req.body?.uci, 5);
            if (!room || !gameId || !UCI.test(uci)) return res.status(400).json({ error: 'Prono invalide' });
            const { game } = await findGame(room, gameId);
            if (game.result && game.result !== '*') return res.status(409).json({ error: 'Partie terminée', code: 'ended' });
            if (!game.currentFEN || boardOf(game.currentFEN) !== boardOf(req.body?.fen)) {
                return res.status(409).json({ error: 'La position a changé', code: 'moved' });
            }
            const m = applyUci(game.currentFEN, uci);
            if (!m) return res.status(400).json({ error: 'Coup illégal', code: 'illegal' });
            await resolve(login, room);                       // juge d'abord le prono précédent de cette partie
            const key = `${room}:${gameId}`;
            user(login).moves[key] = {
                room, gameId, round: str(req.body?.round), slug: str(req.body?.slug),
                fen: game.currentFEN, uci, san: m.san, at: Date.now(),
            };
            store.save();
            res.json({ move: { fen: game.currentFEN, uci, san: m.san } });
        } catch (err) { fail(res, err); }
    });

    app.post('/api/predict/winner', requireTwitch, async (req, res) => {
        try {
            const login = req.twitch.login;
            const room = str(req.body?.room), gameId = str(req.body?.game), pick = str(req.body?.pick, 8);
            if (!room || !gameId || !PICKS.includes(pick)) return res.status(400).json({ error: 'Prono invalide' });
            const { game } = await findGame(room, gameId);
            if (game.result && game.result !== '*') return res.status(409).json({ error: 'Partie terminée', code: 'ended' });
            const key = `${room}:${gameId}`;
            const names = [game.white?.preferredShortName, game.black?.preferredShortName].map(n => str(n, 40));
            const prev = user(login).winners[key]?.pick;
            // Changer d'avis : le gain suit le coup du dernier vote
            const mv = prev === pick ? (user(login).winners[key].mv || fullMove(game.currentFEN)) : fullMove(game.currentFEN);
            user(login).winners[key] = { room, gameId, pick, names, mv, at: Date.now() };
            store.save();
            bump(key, pick, prev);
            res.json({ winner: { pick }, votes: tally(key) });
        } catch (err) { fail(res, err); }
    });

    /** Votes « vainqueur » en attente pour une partie (liste des matchs en direct), recalculés toutes les 10 s */
    let tallyCache = { at: 0, map: new Map() };
    function tally(key) {
        if (Date.now() - tallyCache.at > 10000) {
            const map = new Map();
            for (const u of Object.values(store.data)) {
                for (const [k, w] of Object.entries(u.winners || {})) {
                    const t = map.get(k) || { '1-0': 0, '1/2-1/2': 0, '0-1': 0 };
                    if (w.pick in t) t[w.pick]++;
                    map.set(k, t);
                }
            }
            tallyCache = { at: Date.now(), map };
        }
        return tallyCache.map.get(key) || null;
    }
    const bump = (key, pick, prev) => {
        const t = tallyCache.map.get(key) || { '1-0': 0, '1/2-1/2': 0, '0-1': 0 };
        if (prev && t[prev] > 0) t[prev]--;
        t[pick]++;
        tallyCache.map.set(key, t);
    };

    return { resolve, store, tally };
};
