const express = require('express');
const app = express();
const http = require('http').createServer(app);


app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
// Les votes des viewers arrivent par lots (un chat nombreux dépasse vite 16 Ko)
const jsonSmall = express.json({ limit: '16kb' });
const jsonLarge = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/api/stats/votes' ? jsonLarge : jsonSmall)(req, res, next));


const io = require('socket.io')(http, {
    cors: {
        origin: "*", // En production, mettez votre domaine
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const crypto = require('crypto');
const { Chess } = require('chess.js');
const chatHistory = {};
/** Identifiant public d'une partie (Parcourir, spectateurs) : ne révèle pas le code d'un salon privé */
const newPublicId = () => crypto.randomBytes(6).toString('hex');



// Page de l'appli : chaque démarrage (donc chaque déploiement) estampille les liens CSS/JS d'une version,
// pour qu'aucun navigateur ni proxy ne garde l'ancien code après une mise en ligne
const BUILD = Date.now().toString(36);
const INDEX_HTML = require('fs').readFileSync(path.join(__dirname, 'index.html'), 'utf8')
    .replace(/((?:href|src)="\/?(?:css|js)\/[^"?]+\.(?:css|js))"/g, `$1?v=${BUILD}"`);

// Adresses propres de l'appli (/24h, /records?c=x, /multi/hote/code…) : même page, le routeur côté client prend le relais.
// Chaque langue a ses adresses (/en/rush, /de/records…) et reçoit la page déjà traduite (seo.js), avec robots.txt et sitemap.xml.
const APP_ROUTES = /^\/(24h|sandbox|game|browse|records|watch|live|tournament|rush|mono|multi|achievements|shop)(\/|$)/;
require('./seo')({ app, rootDir: __dirname, indexHtml: INDEX_HTML, appRoutes: APP_ROUTES });

// Fichiers publics seulement : jamais le code serveur, package.json ni les données (data/)
const noCache = { setHeaders: res => res.set('Cache-Control', 'no-cache') };
for (const dir of ['js', 'css', 'lang', 'img', 'vendor']) app.use('/' + dir, express.static(path.join(__dirname, dir), noCache));
app.use('/mp3', express.static(path.join(__dirname, 'mp3')));
for (const page of ['phantomLive.html', 'phantom_debug.html', 'sandbox-legacy.html']) {
    app.get('/' + page, (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, page)));
}

app.get('/proxy/chess/:gameId', async (req, res) => {
    try {
                const url = `https://www.chess.com/service/play/games/${req.params.gameId}`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) return res.status(r.status).json({ error: `chess.com HTTP ${r.status}` });
        res.json(await r.json());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Pendules d'une partie live : temps restant après chaque coup (moveTimestamps, en dixièmes de seconde)
app.get('/proxy/chess-live/:gameId', async (req, res) => {
    if (!/^\d+$/.test(req.params.gameId)) return res.status(400).json({ error: 'id invalide' });
    try {
        const r = await fetch(`https://www.chess.com/callback/live/game/${req.params.gameId}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) return res.status(r.status).json({ error: `chess.com HTTP ${r.status}` });
        const g = (await r.json()).game || {};
        res.json({ moveTimestamps: g.moveTimestamps || '', baseTime1: g.baseTime1 ?? null, isFinished: !!g.isFinished });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Étape 2 : coups en cours (TCN)
app.get('/proxy/chess-moves/', async (req, res) => {
    try {
                const url = `https://www.chess.com${req.query.url}`;
        console.log('🔍 Proxy URL:', url); // ← ajouter
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        console.log('🔍 Status chess.com:', r.status); // ← ajouter
        if (!r.ok) return res.status(r.status).json({ error: `chess.com HTTP ${r.status}` });
        res.json(await r.json());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Liste des tournois en cours depuis chess.com (search API + filtre qualité)
app.get('/proxy/chess-events-list', async (req, res) => {
    try {
                const now = new Date();
        const r = await fetch('https://www.chess.com/events/v1/api/search', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Content-Type': 'application/json',
                'Origin': 'https://www.chess.com',
                'Referer': 'https://www.chess.com/events',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ size: 100 })
        });
        if (!r.ok) return res.status(r.status).json({ error: `chess.com HTTP ${r.status}` });
        const raw = await r.json();
        const events = Array.isArray(raw) ? raw.map(i => i.event).filter(Boolean) : [];

        const filtered = events
            // Exclure les événements terminés ou débutant dans plus de 30 jours
            .filter(e => {
                const end   = e.endAt   ? new Date(e.endAt)   : null;
                const start = e.startAt ? new Date(e.startAt) : null;
                if (end   && end   < now) return false;
                if (start && start > new Date(now.getTime() + 30 * 86400e3)) return false;
                return true;
            })
            // Exclure les tournois sans aucun contenu (spam)
            .filter(e =>
                e.playerCount > 0 || e.roundCount > 0 ||
                e.imageUrl    || (e.streams?.length > 0) ||
                (e.schedules?.length > 0)
            )
            // Trier : image > streams > joueurs > date de début desc
            .sort((a, b) => {
                const score = e => (e.imageUrl ? 100 : 0) + (e.streams?.length > 0 ? 50 : 0) + Math.min(e.playerCount || 0, 40);
                const diff = score(b) - score(a);
                if (diff !== 0) return diff;
                return new Date(b.startAt) - new Date(a.startAt);
            });

        res.json(filtered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Partie daily Chess.com (callback spécifique daily)
app.get('/proxy/chess-daily/:gameId', async (req, res) => {
    try {
                const url = `https://www.chess.com/callback/daily/game/${req.params.gameId}`;
        console.log('🔍 Daily game URL:', url);
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) return res.status(r.status).json({ error: `chess.com HTTP ${r.status}` });
        res.json(await r.json());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const CHESS_COM_EVENT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'Referer': 'https://www.chess.com/',
    'Origin': 'https://www.chess.com',
    'Content-Type': 'application/json'
};

// Chaque spectateur interroge la salle toutes les 5 s : une seule requête à chess.com
// par salle et par intervalle, sinon chess.com finit par répondre 429
const chessEventCache = new Map(); // slug -> { at, promise }
const CHESS_EVENT_TTL = 4000;

function fetchChessEventRoom(slug) {
    const cached = chessEventCache.get(slug);
    if (cached && Date.now() - cached.at < CHESS_EVENT_TTL) return cached.promise;
    const promise = fetch(`https://www.chess.com/events/v1/api/room/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: CHESS_COM_EVENT_HEADERS,
        body: JSON.stringify({})
    }).then(async r => ({ status: r.status, ok: r.ok, body: r.ok ? await r.json() : await r.text() }));
    chessEventCache.set(slug, { at: Date.now(), promise });
    promise.catch(() => chessEventCache.delete(slug));
    if (chessEventCache.size > 200) chessEventCache.delete(chessEventCache.keys().next().value);
    return promise;
}

app.get('/proxy/chess-event/:slug', async (req, res) => {
    try {
        const r = await fetchChessEventRoom(req.params.slug);
        if (!r.ok) {
            console.log(`chess.com room ${req.params.slug} : HTTP ${r.status}`);
            return res.status(r.status).json({ error: `chess.com HTTP ${r.status}`, body: String(r.body).slice(0, 500) });
        }
        res.json(r.body);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Coups d'une partie de tournoi (la salle ne donne que la position actuelle).
// La réponse de chess.com contient aussi l'analyse moteur (~200 Ko) : on ne garde que les coups.
app.get('/proxy/chess-event-game/:room/:round/:game', async (req, res) => {
    try {
        const { room, round, game } = req.params;
        const url = `https://www.chess.com/events/v1/api/game/${[room, round, game].map(encodeURIComponent).join('/')}`;
        const r = await fetch(url, { method: 'POST', headers: CHESS_COM_EVENT_HEADERS, body: JSON.stringify({}) });
        if (!r.ok) return res.status(r.status).json({ error: `chess.com HTTP ${r.status}` });
        const data = await r.json();
        res.json({
            id: data.game?.id,
            currentFEN: data.game?.currentFEN,
            moves: (data.moves || []).slice().sort((a, b) => a.ply - b.ply).map(m => m.cbn)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Événement chess.com qui regroupe plusieurs salles (groupes, brackets…) :
// chaque salle a son propre slug, c'est lui qui donne accès aux parties
app.get('/proxy/chess-event-index/:slug', async (req, res) => {
    try {
        const url = `https://www.chess.com/events/v1/api/index/${encodeURIComponent(req.params.slug)}`;
        const r = await fetch(url, { method: 'POST', headers: CHESS_COM_EVENT_HEADERS, body: JSON.stringify({}) });
        if (!r.ok) return res.status(r.status).json({ error: `chess.com HTTP ${r.status}` });
        const data = await r.json();
        res.json({
            name: data.index?.name,
            rooms: (data.rooms || []).map(room => ({
                slug:         room.slug,
                name:         room.name,
                timeControl:  room.timeControl,
                startAt:      room.startAt,
                endAt:        room.endAt,
                currentRound: room.currentRound || null
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// PUZZLE RUSH — RECORDS PAR CHAÎNE
// ============================================
// Identité : token Twitch (implicit grant côté client) validé auprès de Twitch.
// Stockage : fichier JSON (data/rush-records.json), un enregistrement par chaîne.

const fs = require('fs');
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '5lgt1omtgbo8gp4bla49ktvvr7gbj3';
const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'rush-records.json');

// Un classement par temps de vote : 0 = illimité (le premier vote valide est joué), sinon secondes
const RUSH_MODES = ['0', '30', '60', '120'];
const RUSH_DEFAULT_MODE = '0';

// { [login]: { login, userId, displayName, avatar, modes: { [mode]: { best: {score, maxRating, durationMs, at}, runs, lastScore, lastAt } } } }
let rushRecords = {};

function rushMode(value) {
    const mode = String(value ?? RUSH_DEFAULT_MODE);
    return RUSH_MODES.includes(mode) ? mode : null;
}

function loadRushRecords() {
    try {
        rushRecords = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')) || {};
        // Ancien format (un seul classement) : repris dans le classement illimité
        for (const r of Object.values(rushRecords)) {
            if (r.modes || !r.best) continue;
            r.modes = { [RUSH_DEFAULT_MODE]: { best: r.best, runs: r.runs || 1, lastScore: r.lastScore, lastAt: r.lastAt } };
            delete r.best; delete r.runs; delete r.lastScore; delete r.lastAt;
        }
        console.log(`🔥 ${Object.keys(rushRecords).length} record(s) Puzzle Rush chargé(s)`);
    } catch (e) {
        if (e.code !== 'ENOENT') console.warn('🔥 Records illisibles, repart de zéro:', e.message);
        rushRecords = {};
    }
}

function saveRushRecords() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = RECORDS_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(rushRecords, null, 2));
        fs.renameSync(tmp, RECORDS_FILE);
    } catch (e) {
        console.error('🔥 Impossible de sauvegarder les records:', e.message);
    }
}

function publicRecord(r, mode) {
    const m = r.modes[mode];
    return {
        login:       r.login,
        displayName: r.displayName || r.login,
        avatar:      r.avatar || null,
        mode,
        best:        m.best,
        runs:        m.runs || 1,
        lastScore:   m.lastScore,
        lastAt:      m.lastAt,
        history:     m.history || []
    };
}

function leaderboard(limit, mode) {
    return Object.values(rushRecords)
        .filter(r => r.modes?.[mode])
        .map(r => publicRecord(r, mode))
        .sort((a, b) => (b.best.score - a.best.score)
            || (b.best.maxRating - a.best.maxRating)
            || (a.best.at - b.best.at))
        .slice(0, limit);
}

// Validation des tokens Twitch, avec cache court pour ne pas spammer Twitch
const tokenCache = new Map(); // token -> { login, userId, until }
const TOKEN_CACHE_MS = 5 * 60 * 1000;

async function verifyTwitchToken(token) {
    // Tests locaux uniquement (STATION_DEV=1, jamais en production) : « dev:<login> »
    if (process.env.STATION_DEV === '1' && /^dev:[a-z0-9_]{2,25}$/.test(token)) return { login: token.slice(4), userId: 'dev' };
    const cached = tokenCache.get(token);
    if (cached && cached.until > Date.now()) return cached;

    const r = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${token}` }
    });
    if (r.status === 401) throw Object.assign(new Error('Token Twitch invalide ou expiré'), { status: 401 });
    if (!r.ok) throw Object.assign(new Error(`Twitch HTTP ${r.status}`), { status: 502 });

    const data = await r.json();
    if (data.client_id !== TWITCH_CLIENT_ID) {
        throw Object.assign(new Error('Token émis pour une autre application'), { status: 401 });
    }

    const identity = { login: data.login.toLowerCase(), userId: data.user_id, until: Date.now() + TOKEN_CACHE_MS };
    tokenCache.set(token, identity);
    if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value);
    return identity;
}

async function requireTwitch(req, res, next) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'Connexion Twitch requise' });
    try {
        req.twitch = await verifyTwitchToken(m[1]);
        next();
    } catch (e) {
        res.status(e.status || 502).json({ error: e.message });
    }
}

// Classement
app.get('/api/rush/records', (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const mode  = rushMode(req.query.mode);
    if (!mode) return res.status(400).json({ error: 'Mode invalide' });
    const records = leaderboard(limit, mode);
    res.json({ mode, records, total: records.length });
});

// Record d'une chaîne
app.get('/api/rush/records/:login', (req, res) => {
    const mode = rushMode(req.query.mode);
    if (!mode) return res.status(400).json({ error: 'Mode invalide' });
    const r = rushRecords[String(req.params.login).toLowerCase()];
    if (!r?.modes?.[mode]) return res.status(404).json({ error: 'Aucun record pour cette chaîne' });
    res.json(publicRecord(r, mode));
});

// Fin de run : enregistre le score pour la chaîne du token
app.post('/api/rush/records', requireTwitch, (req, res) => {
    const body = req.body || {};
    const score      = Number.isInteger(body.score) ? body.score : -1;
    const maxRating  = Math.max(0, Math.min(4000, parseInt(body.maxRating) || 0));
    const durationMs = Math.max(0, Math.min(24 * 3600e3, parseInt(body.durationMs) || 0));

    if (score < 0 || score > 1000) {
        return res.status(400).json({ error: 'Score invalide' });
    }
    const mode = rushMode(body.mode);
    if (!mode) return res.status(400).json({ error: 'Mode invalide' });

    const { login, userId } = req.twitch;
    const now  = Date.now();
    const prev = rushRecords[login];
    const run  = { score, maxRating, durationMs, at: now };

    const displayName = typeof body.displayName === 'string' ? body.displayName.slice(0, 50) : (prev?.displayName || login);
    const avatar      = typeof body.avatar === 'string' && /^https:\/\/[^\s"'<>]+$/.test(body.avatar) ? body.avatar.slice(0, 300) : (prev?.avatar || null);

    const prevMode    = prev?.modes?.[mode];
    const isNewRecord = !prevMode || score > prevMode.best.score;
    rushRecords[login] = {
        login,
        userId,
        displayName,
        avatar,
        modes: {
            ...prev?.modes,
            [mode]: {
                best:      isNewRecord ? run : prevMode.best,
                runs:      (prevMode?.runs || 0) + 1,
                lastScore: score,
                lastAt:    now,
                // Derniers runs, pour la courbe de progression
                history:   [...(prevMode?.history || []), { score, at: now }].slice(-20)
            }
        }
    };
    saveRushRecords();

    console.log(`🔥 [${login}] run terminé (mode ${mode}) : ${score} puzzle(s)${isNewRecord ? ' — NOUVEAU RECORD' : ''}`);
    const gain = economy.onRushRun(login, { score, isNewRecord, mode, at: now });
    res.json({ record: publicRecord(rushRecords[login], mode), isNewRecord, gain });
});

// Fiche d'une chaîne : tous les modes, avec son rang dans chacun
app.get('/api/rush/channel/:login', (req, res) => {
    const r = rushRecords[String(req.params.login).toLowerCase()];
    if (!r?.modes) return res.status(404).json({ error: 'Aucun record pour cette chaîne' });
    const modes = {};
    for (const mode of RUSH_MODES) {
        if (!r.modes[mode]) continue;
        const board = leaderboard(Infinity, mode);
        modes[mode] = { ...publicRecord(r, mode), rank: board.findIndex(x => x.login === r.login) + 1, total: board.length };
    }
    res.json({ login: r.login, displayName: r.displayName || r.login, avatar: r.avatar || null, modes });
});

loadRushRecords();

// Stats Multi et viewers (stats.js)
// XP / niveaux et pions par compte Twitch (economy.js)
const economy = require('./economy')({ app, requireTwitch, dataDir: DATA_DIR, jsonStore: require('./stats').jsonStore });
const stats = require('./stats')({ app, requireTwitch, dataDir: DATA_DIR, rushRecords: () => rushRecords, economy });

const games = {}; // Stockage des parties actives

// ============================================
// ROUTE MULTI : SALON AVANT LA PARTIE
// ============================================
// #/multi/<hôte>/<code> : l'hôte (Blancs) crée le salon, public ou privé. Le premier
// autre streamer connecté qui arrive avec le code prend les Noirs. Un salon public
// s'affiche dans Parcourir avec un bouton Rejoindre ; un salon privé n'y montre pas
// son code, il ne se rejoint que par le lien. Le compte à rebours des inscriptions
// démarre quand les deux sont là, puis la partie se lance.
const MULTI_LOBBY_MS = parseInt(process.env.MULTI_LOBBY_MS) || 2 * 60 * 1000;
const multiRooms = {}; // gameId -> { gameId, publicId, a, b, isPublic, settings, sockets: { login: socketId }, endsAt, timeout }

function sanitizeMultiSettings(s = {}) {
    return {
        timerDuration: Math.min(300, Math.max(5, parseInt(s.timerDuration) || 30)),
        majorityMode:  !!s.majorityMode,
        // Animation du tirage (s) : aucune, rapide, normale, lente
        wheelDuration: [0, 3, 6, 10].includes(Number(s.wheelDuration)) ? Number(s.wheelDuration) : 6,
        followersOnly: !!s.followersOnly,
        subsOnly:      !!s.subsOnly,
        // Anonymat du vote choisi par le créateur, suivi par les deux chaînes
        anonymity:     ['names', 'secret'].includes(s.anonymity) ? s.anonymity : 'none'
    };
}

function emitMultiRoom(room) {
    // Pas de diffusion au canal de la partie : la page de l'autre streamer peut
    // encore y être, sur le résultat de la partie précédente
    const state = {
        a:           room.a,
        b:           room.b,
        isPublic:    room.isPublic,
        present:     Object.keys(room.sockets),
        remainingMs: room.endsAt ? room.endsAt - Date.now() : null,
        settings:    room.settings
    };
    Object.entries(room.sockets).forEach(([login, id]) => io.to(id).emit('multi:lobby', {
        ...state,
        // Régie seulement : adversaire fictif pour tester un salon sans second streamer
        canBot: login === room.a && !room.b && !!station?.isRegie(login)
    }));
}

// ---------- Adversaire fictif (tests de la régie) ----------
// Une chaîne sim_* prend les Noirs ; le serveur joue ses coups après un délai de « vote ».
// Ses parties sont retirées des stats par la purge de sim.js (préfixe sim_).
const BOT_LOBBY_MS = Math.min(MULTI_LOBBY_MS, 30 * 1000);
const isBotSocket = (id) => typeof id === 'string' && id.startsWith('bot:');

function scheduleBotMove(game) {
    if (!game.bot || game.status !== 'playing' || !game.lastFen) return;
    let chess;
    try { chess = new Chess(game.lastFen); } catch { return; }
    if (chess.turn() !== 'b' || chess.isGameOver()) return;
    const turnMs = (game.settings?.timerDuration || 30) * 1000;
    const delay  = Math.min(25000, Math.max(2500, turnMs * (0.3 + Math.random() * 0.45)));
    const fen    = game.lastFen;
    clearTimeout(game.botTimer);
    game.botTimer = setTimeout(async () => {
        if (games[game.gameId] !== game || game.status !== 'playing' || game.lastFen !== fen) return;
        // Stockfish au niveau choisi ; à défaut, le choix simple de sim.js
        let san = null;
        try { san = await require('./stockfish').botMove(fen, game.botElo || 1500); } catch {}
        if (games[game.gameId] !== game || game.status !== 'playing' || game.lastFen !== fen) return;
        const c = new Chess(fen);
        let move = null;
        try { move = c.move(san || require('./sim').chooseMove(c)); } catch {}
        if (!move) return;
        applyMultiMove(game, { player: 'black', move: move.san, fen: c.fen() });
    }, delay);
}

/** Coup d'une partie multi : historique, résultat, spectateurs, puis diffusion aux deux pages */
function applyMultiMove(game, data) {
    if (game) {
        if (typeof data.fen === 'string' && FEN_RE.test(data.fen)) {
            // Case de départ et d'arrivée, pour les spectateurs
            let lastMove = null;
            try {
                const m = new Chess(game.lastFen || undefined).move(String(data.move || ''));
                if (m) {
                    lastMove = { from: m.from, to: m.to };
                    (game.history ||= []).push(m.san);
                    if (game.history.length > 400) game.history.shift();
                }
            } catch { /* coup illisible : pas de surlignage */ }
            game.lastFen  = data.fen;
            game.lastMove = lastMove;
            game.detail   = null;   // au tour de l'autre chaîne de voter
        }
        game.moveCount = (game.moveCount || 0) + 1;
        // Mat, pat ou nulle : le résultat de la bataille est enregistré
        const result = stats.recordMultiResult(game);
        if (result) {
            game.result = result.result;
            io.to(game.gameId).emit('multi:result', result);
        }
        emitSpectate(game);
    }
    io.to(data.gameId ?? game?.gameId).emit('movePlayed', {
        player: data.player,
        move:   data.move,
        fen:    data.fen || null
    });
    console.log(`♟ [${data.gameId ?? game?.gameId}] ${data.player}: ${data.move}`);
    if (game?.bot && !game.result) scheduleBotMove(game);
}

function launchMultiRoom(room) {
    games[room.gameId] = {
        gameId:      room.gameId,
        publicId:    room.publicId,
        isPublic:    room.isPublic,
        host:        room.a,
        hostSocket:  room.sockets[room.a],
        settings:    room.settings,
        guest:       room.b,
        guestSocket: room.bot ? null : room.sockets[room.b],
        bot:         !!room.bot,
        botElo:      room.botElo || 1500,
        status:      'playing',
        moveCount:   0,
        startedAt:   Date.now(),
        lastFen:     null
    };
    delete multiRooms[room.gameId];
    io.to(room.gameId).emit('gameReady', {
        players:  { white: room.a, black: room.b },
        settings: room.settings
    });
    console.log(`Partie multi lancée : ${room.a} vs ${room.b}`);
    emitSpectate(games[room.gameId]);
    if (watchers.has(room.publicId)) emitSpectators(room.publicId);
    broadcastGamesList();
}

function leaveMultiRoom(socket) {
    const room = multiRooms[socket.data.multiRoom];
    if (!room) return;
    const login = Object.keys(room.sockets).find(l => room.sockets[l] === socket.id);
    if (!login) return;
    delete room.sockets[login];
    // La place des Noirs se libère : un autre streamer peut la prendre
    if (login === room.b) room.b = null;
    // Il faut les deux streamers : le compte à rebours repartira à leur retour
    clearTimeout(room.timeout);
    room.timeout = null;
    room.endsAt  = null;
    if (Object.values(room.sockets).every(isBotSocket)) {
        delete multiRooms[room.gameId];
        io.to('spec:' + room.publicId).emit('spectate:ended', { reason: 'closed' });
    } else {
        emitMultiRoom(room);
        emitSpectate(room);
    }
    broadcastGamesList();
}

/** Modes annoncés par les parties d'une seule chaîne */
const LIVE_MODES = ['sandbox', 'problems', 'rush', 'mono', 'chatVsChat', '1v1', '1vAll'];

/** Retourne la liste publique des parties (sans données internes) */
function getPublicGamesList() {
    // Salons Multi pas encore lancés : seul un salon public donne de quoi le rejoindre
    const rooms = Object.values(multiRooms).map(r => ({
        gameId:    r.publicId,
        host:      r.a,
        guest:     r.b,
        status:    'waiting',
        moveCount: 0,
        startedAt: r.createdAt,
        settings:  r.settings,
        mode:      'multi',
        players:   null,
        isPublic:  r.isPublic,
        spectators: watchers.get(r.publicId)?.size || 0,
        draw:      null,
        turn:      r.settings?.timerDuration || null,
        join:      r.isPublic && !r.b ? { host: r.a, code: r.gameId.slice(r.a.length + 1) } : null
    }));
    const live = Object.values(games)
        .filter(g => g.status !== 'ended')
        .map(g => ({
            gameId:     g.publicId,
            host:       g.host,
            guest:      g.guest,
            status:     g.status,
            moveCount:  g.moveCount,
            startedAt:  g.startedAt,
            settings:   g.settings,
            mode:       g.mode || 'multi',
            players:    g.players ?? null,
            isPublic:   g.isPublic ?? true,
            spectators: watchers.get(g.publicId)?.size || 0,
            // Vote : roue / bande, durée d'un tour (la dernière connue : pas de minuteur pendant un tirage)
            draw:       g.detail?.wheel || null,
            turn:       (g.lastTurn = g.detail?.timer?.total || g.lastTurn || g.settings?.timerDuration || null),
            join:       null
        }));
    return rooms.concat(live);
}

// ============================================
// SPECTATEURS : salle spec:<publicId>
// ============================================
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function spectateState(g) {
    return {
        id:          g.publicId,
        mode:        g.mode || 'multi',
        host:        g.host ?? g.a ?? null,
        guest:       g.guest ?? g.b ?? null,
        status:      g.status || 'waiting',
        moveCount:   g.moveCount || 0,
        // Partie lancée mais aucun coup encore joué : position de départ
        fen:         g.lastFen || (g.status === 'playing' ? START_FEN : null),
        lastMove:    g.lastMove || null,
        orientation: g.orientation === 'black' ? 'black' : 'white',
        players:     g.players ?? null,
        isPublic:    g.isPublic ?? true,
        result:      g.result || null,
        // Ce que voient les joueurs : votes en cours, minuteur, historique, Puzzle Rush
        votes:       g.detail?.votes || [],
        timer:       g.detail?.timer ? { endsIn: Math.max(0, g.detail.timer.endsAt - Date.now()), total: g.detail.timer.total, paused: !!g.detail.timer.paused, left: g.detail.timer.left } : null,
        history:     g.history || [],
        rush:        g.detail?.rush || null,
        // Mode roue : style de tirage de l'hôte, et tirage en cours (même gagnant pour tous)
        wheel:       g.detail?.wheel || null,
        // Couleurs du tirage de l'hôte, score du vote de chaque coup (aligné sur la fin de l'historique)
        pal:         g.detail?.pal || null,
        hv:          g.detail?.hv || [],
        // Vote secret de l'hôte : seulement le nombre de votes, pas les coups
        sec:         g.detail?.sec ?? null,
        draw:        g.detail?.draw ? { votes: g.detail.draw.votes, winner: g.detail.draw.winner, duration: g.detail.draw.duration, stop: g.detail.draw.stop ?? null, endsIn: Math.max(0, g.detail.draw.endsAt - Date.now()) } : null,
        spectators:  spectatorsOf(g.publicId)
    };
}

/** Clé de comparaison : le temps qui s'écoule seul ne compte pas comme un changement */
function spectateKey(g) {
    const s = spectateState(g);
    s.timer = s.timer && { ...s.timer, endsIn: Math.round(s.timer.endsIn / 2000) };
    s.draw = s.draw && { ...s.draw, endsIn: 0 };
    return JSON.stringify(s);
}

// ---------- Détail publié par le navigateur d'un joueur ----------
const SAN_RE = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/;
const PALETTE_IDS = ['violet', 'twitch', 'night', 'fire', 'ocean', 'muted', 'access'];
const clampInt = (v, min, max) => Math.min(Math.max(parseInt(v, 10) || 0, min), max);

function sanitizeDetail(data = {}, prev = null) {
    if (!data || typeof data !== 'object') return null;
    const votes = (Array.isArray(data.votes) ? data.votes : []).slice(0, 12)
        .map(v => ({ m: String(v?.m || ''), n: clampInt(v?.n, 0, 99999) }))
        .filter(v => SAN_RE.test(v.m) && v.n > 0);
    let timer = null;
    if (data.timer && typeof data.timer === 'object') {
        const left   = clampInt(data.timer.left, 0, 3600);
        const total  = clampInt(data.timer.total, 1, 3600);
        const paused = !!data.timer.paused;
        const endsAt = Date.now() + left * 1000;
        // Même échéance à ±1,5 s près : on garde l'ancienne (pas de renvoi chaque seconde)
        const keep = prev?.timer && !paused && !prev.timer.paused && prev.timer.total === total && Math.abs(prev.timer.endsAt - endsAt) < 1500;
        timer = keep ? prev.timer : { endsAt, total, paused, left: paused ? left : null };
    }
    let rush = null;
    if (data.rush && typeof data.rush === 'object') {
        rush = {
            score:      clampInt(data.rush.score, 0, 9999),
            strikes:    clampInt(data.rush.strikes, 0, 10),
            maxStrikes: clampInt(data.rush.maxStrikes, 1, 10),
            rating:     clampInt(data.rush.rating, 0, 4000),
            mode:       ['0', '30', '60', '120'].includes(String(data.rush.mode)) ? String(data.rush.mode) : null
        };
    }
    const wheel = ['band', 'classic'].includes(data.wheel) ? data.wheel : null;
    let draw = null;
    if (data.draw && typeof data.draw === 'object') {
        const dv = (Array.isArray(data.draw.votes) ? data.draw.votes : []).slice(0, 12)
            .map(v => ({ m: String(v?.m || ''), n: clampInt(v?.n, 0, 99999) }))
            .filter(v => SAN_RE.test(v.m) && v.n > 0);
        const winner = String(data.draw.winner || '');
        if (dv.length && dv.some(v => v.m === winner)) {
            const duration = clampInt(data.draw.duration, 300, 30000);
            const endsAt = Date.now() + clampInt(data.draw.endsIn, 0, 30000);
            const same = prev?.draw && prev.draw.winner === winner && JSON.stringify(prev.draw.votes) === JSON.stringify(dv);
            const stop = Number(data.draw.stop);
            draw = same ? prev.draw : { votes: dv, winner, duration, endsAt,
                stop: Number.isFinite(stop) ? Math.min(0.85, Math.max(0.15, stop)) : null };
        }
    }
    const pal = PALETTE_IDS.includes(data.pal) ? data.pal : null;
    const hv = (Array.isArray(data.hv) ? data.hv : []).slice(-400)
        .map(v => v === 'r' ? 'r' : (typeof v === 'number' && Number.isFinite(v) ? clampInt(v, 0, 100) : null));
    const sec = data.sec == null ? null : clampInt(data.sec, 0, 99999);
    return { votes: sec == null ? votes : [], timer, rush, wheel, draw, pal, hv, sec };
}

const sanitizeHistory = (h) => Array.isArray(h) ? h.slice(-400).map(String).filter(m => SAN_RE.test(m)) : null;

// ---------- Spectateurs : qui regarde quelle partie ----------
const watchers = new Map();   // publicId -> Map(socketId -> login | null)

function spectatorsOf(publicId) {
    const m = watchers.get(publicId);
    if (!m) return { count: 0, names: [], anon: 0 };
    const values = [...m.values()];
    const logins = [...new Set(values.filter(Boolean))].sort();
    return { count: m.size, names: logins.slice(0, 40), anon: values.filter(l => !l).length };
}

/** Sockets des joueurs d'une partie (pour leur dire qui les regarde) */
function playerSockets(publicId) {
    const room = Object.values(multiRooms).find(r => r.publicId === publicId);
    if (room) return Object.values(room.sockets);
    const entry = Object.entries(games).find(([, g]) => g.publicId === publicId && g.status !== 'ended');
    if (!entry) return [];
    const [id, g] = entry;
    if (id.startsWith('live-') && !g.sim) return [id.slice(5)];
    return [g.hostSocket, g.guestSocket].filter(Boolean);
}

function emitSpectators(publicId) {
    if (!publicId) return;
    const payload = { id: publicId, ...spectatorsOf(publicId) };
    io.to('spec:' + publicId).emit('spectators', payload);
    playerSockets(publicId).forEach(sid => io.to(sid).emit('spectators', payload));
    broadcastGamesList();
}

function unwatch(socket) {
    const id = socket.data.spectating;
    if (!id) return;
    socket.leave('spec:' + id);
    socket.data.spectating = null;
    const m = watchers.get(id);
    if (m) {
        m.delete(socket.id);
        if (!m.size) watchers.delete(id);
    }
    emitSpectators(id);
}

function findByPublicId(id) {
    if (typeof id !== 'string' || !id) return null;
    return Object.values(games).find(g => g.publicId === id && g.status !== 'ended')
        || Object.values(multiRooms).find(r => r.publicId === id) || null;
}

function emitSpectate(g) {
    if (g?.publicId) io.to('spec:' + g.publicId).emit('spectate:state', spectateState(g));
}

const FEN_RE    = /^[1-8pnbrqkPNBRQK/]{15,71} [wb] [KQkq-]{1,4} (?:-|[a-h][36]) \d{1,3} \d{1,4}$/;
const SQUARE_RE = /^[a-h][1-8]$/;

/** Diffuse la liste mise à jour à tous les clients sur le canal 'browse' */
function broadcastGamesList() {
    io.to('browse').emit('gamesListUpdated', getPublicGamesList());
}

io.on('connection', (socket) => {
    console.log('Nouvelle connexion:', socket.id);

    // Un client browse s'abonne aux mises à jour de la liste
    socket.on('subscribeBrowse', () => {
        socket.join('browse');
        socket.emit('gamesList', getPublicGamesList());
    });

    socket.on('getGames', () => {
        socket.emit('gamesList', getPublicGamesList());
    });

    // Aperçu d'une partie dans Parcourir : l'état spectateur, sans compter comme spectateur
    socket.on('game:peek', (id, ack) => {
        if (typeof ack !== 'function') return;
        const g = findByPublicId(String(id || '').slice(0, 64));
        ack(g ? spectateState(g) : null);
    });

    // Regarder une partie de Parcourir (lecture seule)
    socket.on('spectate:join', async (data = {}) => {
        unwatch(socket);
        const g = findByPublicId(String(data.id || ''));
        if (!g) return socket.emit('spectate:ended', { reason: 'notFound' });
        const id = g.publicId;
        socket.data.spectating = id;
        socket.join('spec:' + id);
        if (!watchers.has(id)) watchers.set(id, new Map());
        watchers.get(id).set(socket.id, null);
        socket.emit('spectate:state', spectateState(g));
        emitSpectators(id);
        // Connecté à Twitch : son pseudo (vérifié) apparaît dans la liste des spectateurs
        if (typeof data.token === 'string' && data.token) {
            try {
                const { login } = await verifyTwitchToken(data.token);
                const m = watchers.get(id);
                if (m?.has(socket.id) && socket.data.spectating === id) {
                    m.set(socket.id, login);
                    emitSpectators(id);
                }
            } catch { /* reste anonyme */ }
        }
    });

    socket.on('spectate:leave', () => unwatch(socket));

    // Partie d'une seule chaîne (Mono, Rush, partie libre) : le navigateur du streamer
    // en publie un résumé pour Parcourir. Une entrée par connexion, retirée à la déconnexion.
    socket.on('game:announce', (data = {}) => {
        const id   = `live-${socket.id}`;
        const host = String(data.host || '').toLowerCase();
        const mode = String(data.mode || '');
        const prev = games[id];
        const fen  = typeof data.fen === 'string' && FEN_RE.test(data.fen) ? data.fen : null;
        const lm   = data.lastMove && SQUARE_RE.test(data.lastMove.from) && SQUARE_RE.test(data.lastMove.to)
            ? { from: data.lastMove.from, to: data.lastMove.to } : null;
        games[id] = {
            gameId:    id,
            publicId:  prev?.publicId || newPublicId(),
            lastFen:   fen,
            lastMove:  lm,
            orientation: data.orientation === 'black' ? 'black' : 'white',
            host:      /^[a-z0-9_]{2,25}$/.test(host) ? host : null,
            guest:     null,
            mode:      LIVE_MODES.includes(mode) ? mode : 'sandbox',
            status:    data.waiting ? 'waiting' : 'playing',
            moveCount: Math.min(Math.max(parseInt(data.moveCount, 10) || 0, 0), 99999),
            players:   Number.isInteger(data.players) ? Math.min(Math.max(data.players, 0), 99999) : null,
            startedAt: prev?.startedAt || Date.now(),
            settings:  null,
            detail:    sanitizeDetail(data.detail, prev?.detail),
            history:   sanitizeHistory(data.history) || prev?.history || []
        };
        const g = games[id];
        // La position change souvent : seuls les spectateurs la reçoivent
        const pub = (x) => x && [x.host, x.mode, x.status, x.moveCount, x.players].join('|');
        if (!prev || pub(prev) !== pub(g)) broadcastGamesList();
        if (!prev || spectateKey(prev) !== spectateKey(g)) emitSpectate(g);
        if (!prev && watchers.has(g.publicId)) socket.emit('spectators', { id: g.publicId, ...spectatorsOf(g.publicId) });
    });

    // Multi : le navigateur dont c'est le tour publie ses votes et son minuteur
    socket.on('game:detail', (data = {}) => {
        const g = Object.values(games).find(x => x.status === 'playing' && (x.hostSocket === socket.id || x.guestSocket === socket.id));
        if (!g) return;
        const turn = (g.lastFen || 'x w').split(' ')[1];
        const mine = socket.id === g.hostSocket ? 'w' : 'b';
        if (turn !== mine) return;
        const before = spectateKey(g);
        g.detail = sanitizeDetail(data, g.detail);
        if (spectateKey(g) !== before) emitSpectate(g);
    });

    socket.on('multi:enter', async (data = {}) => {
        const host = String(data.host || '').toLowerCase();
        const code = String(data.code || '').toLowerCase();
        const valid = /^[a-z0-9_]{2,25}$/;
        if (!valid.test(host) || !valid.test(code)) {
            return socket.emit('multi:denied', { reason: 'invalid' });
        }

        let login;
        try {
            ({ login } = await verifyTwitchToken(String(data.token || '')));
        } catch (e) {
            return socket.emit('multi:denied', { reason: 'auth' });
        }
        const gameId = `${host}-${code}`;
        if (games[gameId]?.status === 'playing') {
            return socket.emit('multi:denied', { reason: 'playing' });
        }

        let room = multiRooms[gameId];
        const previous = games[gameId];
        if (!room) {
            // Seul l'hôte crée le salon… ou l'adversaire de la partie précédente (revanche)
            const rematch = !!previous && previous.guest === login;
            if (login !== host && !rematch) return socket.emit('multi:denied', { reason: 'notFound' });
            room = multiRooms[gameId] = {
                gameId,
                publicId:  newPublicId(),
                a:         host,
                b:         rematch ? login : null,
                isPublic:  previous ? !!previous.isPublic : !!data.isPublic,
                settings:  previous?.settings || sanitizeMultiSettings(data.settings),
                sockets:   {},
                endsAt:    null,
                timeout:   null,
                createdAt: Date.now()
            };
        } else if (login !== host) {
            if (room.b && room.b !== login) return socket.emit('multi:denied', { reason: 'full' });
            room.b = login;
        }
        room.sockets[login]   = socket.id;
        socket.data.multiRoom = gameId;
        socket.join(gameId);

        if (room.b && room.sockets[room.a] && room.sockets[room.b] && !room.timeout) {
            room.endsAt  = Date.now() + MULTI_LOBBY_MS;
            room.timeout = setTimeout(() => launchMultiRoom(room), MULTI_LOBBY_MS);
        }
        emitMultiRoom(room);
        emitSpectate(room);
        broadcastGamesList();
        if (watchers.has(room.publicId)) socket.emit('spectators', { id: room.publicId, ...spectatorsOf(room.publicId) });
    });

    // Régie : un adversaire fictif rejoint le salon de l'hôte (tests sans second streamer)
    socket.on('multi:testBot', async (data = {}) => {
        let login;
        try { ({ login } = await verifyTwitchToken(String(data.token || ''))); } catch { return; }
        const room = multiRooms[socket.data.multiRoom];
        if (!room || room.a !== login || room.b || room.sockets[login] !== socket.id || !station?.isRegie(login)) return;
        room.b   = 'sim_adversaire';
        room.bot = true;
        room.botElo = require('./stockfish').snapLevel(data.elo ?? 1500);
        room.sockets[room.b] = 'bot:' + room.gameId;
        clearTimeout(room.timeout);
        room.endsAt  = Date.now() + BOT_LOBBY_MS;
        room.timeout = setTimeout(() => launchMultiRoom(room), BOT_LOBBY_MS);
        console.log(`🧪 Adversaire fictif (${room.botElo}) dans le salon ${room.gameId}`);
        emitMultiRoom(room);
        emitSpectate(room);
        broadcastGamesList();
    });

    // Outils de test réservés à la régie (faux viewers, adversaire fictif)
    socket.on('tester:check', async (data = {}, ack) => {
        if (typeof ack !== 'function') return;
        try {
            const { login } = await verifyTwitchToken(String(data.token || ''));
            ack(!!station?.isRegie(login));
        } catch { ack(false); }
    });

    socket.on('chat:message', (data) => {
        // Stocker dans l'historique
        if (!chatHistory[data.gameId]) {
            chatHistory[data.gameId] = [];
        }
        chatHistory[data.gameId].push(data);

        // Limiter l'historique à 100 messages
        if (chatHistory[data.gameId].length > 100) {
            chatHistory[data.gameId].shift();
        }

        // Diffuser à tous les participants de la partie
        io.to(data.gameId).emit('chat:message', data);

        console.log(`💬 [${data.gameId}] ${data.author}: ${data.content}`);
    });

    socket.on('reconnectGame', (data) => {
        socket.join(data.gameId);
        console.log(`Reconnexion à la partie ${data.gameId}`);
    });

    socket.on('votesUpdate', (data) => {
        // Transmettre les votes au partenaire
        socket.to(data.gameId).emit('partnerVotes', data.votes);
    });

    socket.on('moveSelected', (data) => {
        const game = games[data.gameId];
        // L'identifiant d'une partie multi est public : seuls ses deux streamers jouent
        if (game && socket.id !== game.hostSocket && socket.id !== game.guestSocket) return;
        // Contre l'adversaire fictif, l'hôte ne joue que les Blancs
        if (game?.bot && data.player !== 'white') return;
        applyMultiMove(game, data);
    });

    socket.on('requestSync', (data) => {
        // Un client demande une resynchronisation du FEN
        const game = games[data.gameId];
        if (game?.lastFen) {
            socket.emit('syncFen', { fen: game.lastFen });
        }
    });

    socket.on('disconnect', () => {
        console.log('Déconnexion:', socket.id);
        unwatch(socket);
        leaveMultiRoom(socket);
        if (games[`live-${socket.id}`]) {
            io.to('spec:' + games[`live-${socket.id}`].publicId).emit('spectate:ended', { reason: 'left' });
            delete games[`live-${socket.id}`];
            broadcastGamesList();
        }
        // Marquer la partie comme terminée si un joueur actif se déconnecte
        for (const game of Object.values(games)) {
            if (game.hostSocket === socket.id || game.guestSocket === socket.id) {
                // Le second départ ne concerne plus personne : l'autre est peut-être déjà au salon suivant
                if (game.status === 'ended') break;
                game.status = 'ended';
                io.to(game.gameId).emit('partnerLeft');
                io.to('spec:' + game.publicId).emit('spectate:ended', { reason: game.result ? 'over' : 'left' });
                broadcastGamesList();
                break;
            }
        }
    });
});

// Station 24/24 : partie permanente des viewers (votes du web, puis du chat Twitch)
const station = require('./station')({
    io, verifyTwitchToken, dataDir: DATA_DIR,
    // Tests locaux : phases raccourcies
    durations: process.env.STATION_FAST ? { recap: 5000, voteMode: 6000, voteOption: 5000, signup: 8000, turn: 6000 } : {}
});

// Stats globales du 24/24 (page Records, onglet 24/24)
app.get('/api/h24/stats', (req, res) => {
    res.json(station.stats({
        bots: req.query.bots !== '0',
        tz: Math.max(-840, Math.min(840, Number(req.query.tz) || 0)),
        days: Math.max(0, Math.min(3650, Number(req.query.days) || 0))
    }));
});

// Simulation d'activité (chaînes sim_*), pilotée depuis la machine : voir sim.js et sim-cli.js
require('./sim')({
    app, io, games, multiRooms, stats, emitSpectate, broadcastGamesList, newPublicId, dataDir: DATA_DIR, station,
    rush: { get: () => rushRecords, set: (r) => { rushRecords = r || {}; }, save: saveRushRecords }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📺 Interface solo: http://localhost:${PORT}`);
    console.log(`🎮 Setup multiplayer: http://localhost:${PORT}/multiplayer`);
});