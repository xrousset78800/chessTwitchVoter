/**
 * Lichess TV : parties en direct (rapides et classiques) pour la Prédiction de la 24/24 quand
 * chess.com n'a plus de tournoi en cours (la nuit surtout).
 *
 * API publique, sans compte :
 *  - /api/tv/channels : la partie vedette de chaque cadence ;
 *  - /api/stream/game/{id} : flux ndjson, d'abord la fiche (joueurs, Elo), puis une ligne par position
 *    (fen, dernier coup lm en UCI, pendules wc/bc en secondes), en direct jusqu'à la fin.
 *
 * Présente la même forme que les salles chess.com (liveGames / fetchRoom / fetchGame) pour station.js :
 * salle « lichess:<id> », manche « lichess ».
 */
const UA = { 'User-Agent': 'CrowdGambit/1.0' };
const CHANNELS = [['classical', 'Classique'], ['rapid', 'Rapide']];
const KEEP_MS = 10 * 60000;     // flux sans lecteur depuis 10 min : fermé

module.exports = function lichessTv({ log = console.log } = {}) {
    const games = new Map();     // id → { info, fen, moves, wc, bc, wc0, result, lastMoveAt, touched, closed, ready }
    let chan = null;

    function prune() {
        for (const [id, e] of games) {
            if (Date.now() - e.touched > KEEP_MS) { try { e.ctrl.abort(); } catch { /* déjà fermé */ } games.delete(id); }
        }
    }
    const resultOf = (winner) => winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2-1/2';
    const over = (status) => status && !['created', 'started'].includes(status.name || status);

    /** Suit une partie : un seul flux ouvert par partie */
    function follow(id) {
        prune();
        let e = games.get(id);
        if (e) { e.touched = Date.now(); return e; }
        let done;
        e = { id, info: null, fen: null, moves: [], wc: null, bc: null, wc0: null, result: '*', lastMoveAt: null,
            touched: Date.now(), closed: false, ctrl: new AbortController(), ready: new Promise(r => { done = r; }) };
        games.set(id, e);
        // L'historique arrive d'un bloc à l'ouverture : prêt une fois la salve passée
        setTimeout(() => done(), 2500).unref?.();
        const handle = (m) => {
            if (m.players) {
                e.info = m;
                if (over(m.status)) e.result = resultOf(m.winner);
            }
            if (m.fen) {
                if (e.wc0 == null && Number.isFinite(m.wc)) e.wc0 = m.wc;
                if (m.lm) { e.moves.push(m.lm); e.lastMoveAt = Date.now(); }
                e.fen = m.fen;
                if (Number.isFinite(m.wc)) e.wc = m.wc;
                if (Number.isFinite(m.bc)) e.bc = m.bc;
            }
        };
        fetch(`https://lichess.org/api/stream/game/${encodeURIComponent(id)}`, { headers: { ...UA, Accept: 'application/x-ndjson' }, signal: e.ctrl.signal })
            .then(async r => {
                if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
                const dec = new TextDecoder();
                let buf = '';
                for await (const chunk of r.body) {
                    buf += dec.decode(chunk, { stream: true });
                    let i;
                    while ((i = buf.indexOf('\n')) >= 0) {
                        const line = buf.slice(0, i).trim();
                        buf = buf.slice(i + 1);
                        if (line) { try { handle(JSON.parse(line)); } catch { /* ligne illisible */ } }
                    }
                }
            })
            .catch(err => { if (err.name !== 'AbortError') log('♞ Lichess TV : flux coupé', id, err.message); })
            .finally(async () => {
                e.closed = true;
                done();
                // Fin sans résultat dans le flux (abandon, temps…) : la fiche exportée le donne
                if (e.result === '*' && games.get(id) === e) {
                    try {
                        const r = await fetch(`https://lichess.org/game/export/${encodeURIComponent(id)}?moves=false`, { headers: { ...UA, Accept: 'application/json' } });
                        const j = r.ok ? await r.json() : null;
                        if (j && over(j.status)) e.result = resultOf(j.winner);
                    } catch { /* tant pis : la station arrêtera la partie */ }
                }
            });
        return e;
    }

    async function channelIds() {
        if (chan && Date.now() - chan.at < 60000) return chan.list;
        const r = await fetch('https://lichess.org/api/tv/channels', { headers: { ...UA, Accept: 'application/json' } });
        if (!r.ok) throw new Error(`Lichess TV HTTP ${r.status}`);
        const j = await r.json();
        const seen = new Set();
        const list = CHANNELS.map(([k, name]) => ({ id: j[k]?.gameId, name })).filter(x => x.id && !seen.has(x.id) && seen.add(x.id));
        chan = { at: Date.now(), list };
        return list;
    }
    const player = (p) => ({ name: p?.user?.name || 'Anonyme', elo: p?.rating ?? null, title: p?.user?.title || null, fide: null });

    /** Parties proposées, sous la forme de la liste chess.com */
    async function candidates(retry = true) {
        const list = await channelIds();
        // Partie vedette terminée mais liste des chaînes encore en cache : on relit tout de suite les chaînes
        // (sinon aucune partie pendant une minute, et « Prédiction » arrive en retard au vote du mode)
        if (retry && list.some(({ id }) => games.get(id) && games.get(id).result !== '*')) {
            chan = null;
            return candidates(false);
        }
        const out = await Promise.all(list.map(async ({ id, name }) => {
            const e = follow(id);
            await e.ready;
            const i = e.info;
            if (!i || !e.fen || e.result !== '*' || i.variant?.key !== 'standard') return null;
            return {
                event: { slug: 'lichess-tv', name: 'Lichess TV', index: false },
                room: { slug: 'lichess:' + id, name: name },
                id, round: 'lichess', slug: id,
                white: player(i.players?.white), black: player(i.players?.black),
                fen: e.fen, startAt: i.createdAt ? new Date(i.createdAt).toISOString() : null,
                tc: e.wc0 ? `${e.wc0}+0` : null,
            };
        }));
        return out.filter(Boolean);
    }

    /** Salle « lichess:<id> » : la partie suivie, comme une salle chess.com */
    async function room(slug) {
        const id = String(slug).slice('lichess:'.length);
        const e = follow(id);
        await e.ready;
        if (!e.fen) return { ok: true, body: { games: [] } };
        if (e.closed && e.result === '*') return { ok: true, body: { games: [] } };   // flux perdu : la station finira par arrêter
        return { ok: true, body: { games: [{
            id, currentFEN: e.fen, result: e.result,
            whiteClock: Number.isFinite(e.wc) ? e.wc * 1000 : null, blackClock: Number.isFinite(e.bc) ? e.bc * 1000 : null,
            lastMoveAt: e.lastMoveAt ? new Date(e.lastMoveAt).toISOString() : null,
        }] } };
    }

    async function game(id) {
        const e = follow(String(id));
        await e.ready;
        return { id, currentFEN: e.fen, moves: e.moves.slice() };
    }

    const isRoom = (slug) => String(slug || '').startsWith('lichess:');
    return { candidates, room, game, isRoom };
};
