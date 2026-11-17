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
app.use(express.json({ limit: '16kb' }));


const io = require('socket.io')(http, {
    cors: {
        origin: "*", // En production, mettez votre domaine
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const chatHistory = {};



// Servir les fichiers statiques (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/mp3', express.static(path.join(__dirname, 'mp3')));

// Route principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route pour le setup multiplayer
app.get('/multiplayer', (req, res) => {
    res.sendFile(path.join(__dirname, 'multiplayer-setup.html'));
});

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

app.get('/proxy/chess-event/:slug', async (req, res) => {
    try {
                const url = `https://www.chess.com/events/v1/api/room/${req.params.slug}`;
        
        const r = await fetch(url, {
            method: 'POST',
            headers: CHESS_COM_EVENT_HEADERS,
            body: JSON.stringify({})
        });
        
        console.log('🔍 Status chess.com:', r.status);
        console.log('🔍 Response headers:', JSON.stringify(Object.fromEntries(r.headers), null, 2));
        
        if (!r.ok) {
            const body = await r.text();
            console.log('🔍 Response body:', body.slice(0, 500));
            return res.status(r.status).json({ error: `chess.com HTTP ${r.status}`, body });
        }
        res.json(await r.json());
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

let rushRecords = {}; // { [login]: { login, userId, displayName, avatar, best: {score, maxRating, durationMs, at}, runs, lastScore, lastAt } }

function loadRushRecords() {
    try {
        rushRecords = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')) || {};
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

function publicRecord(r) {
    return {
        login:       r.login,
        displayName: r.displayName || r.login,
        avatar:      r.avatar || null,
        best:        r.best,
        runs:        r.runs || 1,
        lastScore:   r.lastScore,
        lastAt:      r.lastAt
    };
}

function leaderboard(limit) {
    return Object.values(rushRecords)
        .sort((a, b) => (b.best.score - a.best.score)
            || (b.best.maxRating - a.best.maxRating)
            || (a.best.at - b.best.at))
        .slice(0, limit)
        .map(publicRecord);
}

// Validation des tokens Twitch, avec cache court pour ne pas spammer Twitch
const tokenCache = new Map(); // token -> { login, userId, until }
const TOKEN_CACHE_MS = 5 * 60 * 1000;

async function verifyTwitchToken(token) {
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
    res.json({ records: leaderboard(limit), total: Object.keys(rushRecords).length });
});

// Record d'une chaîne
app.get('/api/rush/records/:login', (req, res) => {
    const r = rushRecords[String(req.params.login).toLowerCase()];
    if (!r) return res.status(404).json({ error: 'Aucun record pour cette chaîne' });
    res.json(publicRecord(r));
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

    const { login, userId } = req.twitch;
    const now  = Date.now();
    const prev = rushRecords[login];
    const run  = { score, maxRating, durationMs, at: now };

    const displayName = typeof body.displayName === 'string' ? body.displayName.slice(0, 50) : (prev?.displayName || login);
    const avatar      = typeof body.avatar === 'string' && /^https:\/\/[^\s"'<>]+$/.test(body.avatar) ? body.avatar.slice(0, 300) : (prev?.avatar || null);

    const isNewRecord = !prev || score > prev.best.score;
    rushRecords[login] = {
        login,
        userId,
        displayName,
        avatar,
        best:      isNewRecord ? run : prev.best,
        runs:      (prev?.runs || 0) + 1,
        lastScore: score,
        lastAt:    now
    };
    saveRushRecords();

    console.log(`🔥 [${login}] run terminé : ${score} puzzle(s)${isNewRecord ? ' — NOUVEAU RECORD' : ''}`);
    res.json({ record: publicRecord(rushRecords[login]), isNewRecord });
});

loadRushRecords();

const games = {}; // Stockage des parties actives

// ============================================
// ROUTE MULTI : SALON AVANT LA PARTIE
// ============================================
// #/multi/a/b : chaque streamer entre avec son token Twitch. Le compte à rebours
// des inscriptions démarre quand les deux sont là, puis la partie se lance.
const MULTI_LOBBY_MS = parseInt(process.env.MULTI_LOBBY_MS) || 2 * 60 * 1000;
const multiRooms = {}; // gameId -> { gameId, a, b, settings, sockets: { login: socketId }, endsAt, timeout }

function sanitizeMultiSettings(s = {}) {
    return {
        timerDuration: Math.min(300, Math.max(5, parseInt(s.timerDuration) || 30)),
        majorityMode:  !!s.majorityMode,
        followersOnly: !!s.followersOnly,
        subsOnly:      !!s.subsOnly
    };
}

function emitMultiRoom(room) {
    // Pas de diffusion au canal de la partie : la page de l'autre streamer peut
    // encore y être, sur le résultat de la partie précédente
    const state = {
        present:     Object.keys(room.sockets),
        remainingMs: room.endsAt ? room.endsAt - Date.now() : null,
        settings:    room.settings
    };
    Object.values(room.sockets).forEach(id => io.to(id).emit('multi:lobby', state));
}

function launchMultiRoom(room) {
    games[room.gameId] = {
        gameId:      room.gameId,
        host:        room.a,
        hostSocket:  room.sockets[room.a],
        settings:    room.settings,
        guest:       room.b,
        guestSocket: room.sockets[room.b],
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
    broadcastGamesList();
}

function leaveMultiRoom(socket) {
    const room = multiRooms[socket.data.multiRoom];
    if (!room) return;
    const login = Object.keys(room.sockets).find(l => room.sockets[l] === socket.id);
    if (!login) return;
    delete room.sockets[login];
    // Il faut les deux streamers : le compte à rebours repartira à leur retour
    clearTimeout(room.timeout);
    room.timeout = null;
    room.endsAt  = null;
    if (Object.keys(room.sockets).length === 0) delete multiRooms[room.gameId];
    else emitMultiRoom(room);
}

/** Retourne la liste publique des parties (sans données internes) */
function getPublicGamesList() {
    return Object.values(games)
        .filter(g => g.status !== 'ended')
        .map(g => ({
            gameId:     g.gameId,
            host:       g.host,
            guest:      g.guest,
            status:     g.status,
            moveCount:  g.moveCount,
            startedAt:  g.startedAt,
            settings:   g.settings
        }));
}

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

    socket.on('multi:enter', async (data = {}) => {
        const a = String(data.a || '').toLowerCase();
        const b = String(data.b || '').toLowerCase();
        const valid = /^[a-z0-9_]{2,25}$/;
        if (!valid.test(a) || !valid.test(b) || a === b) {
            return socket.emit('multi:denied', { reason: 'invalid' });
        }

        let login;
        try {
            ({ login } = await verifyTwitchToken(String(data.token || '')));
        } catch (e) {
            return socket.emit('multi:denied', { reason: 'auth' });
        }
        // Personne ne peut lancer une partie au nom de deux autres chaînes
        if (login !== a && login !== b) {
            return socket.emit('multi:denied', { reason: 'notParticipant' });
        }

        const gameId = `${a}-${b}`;
        if (games[gameId]?.status === 'playing') {
            return socket.emit('multi:denied', { reason: 'playing' });
        }

        const room = multiRooms[gameId] ||= {
            gameId, a, b,
            settings: sanitizeMultiSettings(data.settings),
            sockets:  {},
            endsAt:   null,
            timeout:  null
        };
        room.sockets[login]   = socket.id;
        socket.data.multiRoom = gameId;
        socket.join(gameId);

        if (room.sockets[a] && room.sockets[b] && !room.timeout) {
            room.endsAt  = Date.now() + MULTI_LOBBY_MS;
            room.timeout = setTimeout(() => launchMultiRoom(room), MULTI_LOBBY_MS);
        }
        emitMultiRoom(room);
    });

    socket.on('createGame', (data) => {
        games[data.gameId] = {
            gameId:      data.gameId,
            host:        data.hostName,
            hostSocket:  socket.id,
            settings:    data.settings || {},
            guest:       null,
            guestSocket: null,
            status:      'waiting',
            moveCount:   0,
            startedAt:   null,
            lastFen:     null
        };
        socket.join(data.gameId);
        console.log(`Partie créée: ${data.gameId} par ${data.hostName}`);
        broadcastGamesList();
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

    socket.on('joinGame', (data) => {
        const game = games[data.gameId];
        if (game) {
            game.guest       = data.guestName;
            game.guestSocket = socket.id;
            game.status      = 'playing';
            game.startedAt   = Date.now();
            socket.join(data.gameId);

            if (chatHistory[data.gameId]) {
                socket.emit('chat:history', chatHistory[data.gameId]);
            }

            io.to(data.gameId).emit('gameReady', {
                players: { white: game.host, black: game.guest },
                settings: game.settings
            });
            console.log(`${data.guestName} a rejoint la partie ${data.gameId}`);
            broadcastGamesList();
        }
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
        if (game) {
            if (data.fen) game.lastFen = data.fen;
            game.moveCount = (game.moveCount || 0) + 1;
        }
        io.to(data.gameId).emit('movePlayed', {
            player: data.player,
            move:   data.move,
            fen:    data.fen || null
        });
        console.log(`♟ [${data.gameId}] ${data.player}: ${data.move}`);
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
        leaveMultiRoom(socket);
        // Marquer la partie comme terminée si un joueur actif se déconnecte
        for (const game of Object.values(games)) {
            if (game.hostSocket === socket.id || game.guestSocket === socket.id) {
                // Le second départ ne concerne plus personne : l'autre est peut-être déjà au salon suivant
                if (game.status === 'ended') break;
                game.status = 'ended';
                io.to(game.gameId).emit('partnerLeft');
                broadcastGamesList();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📺 Interface solo: http://localhost:${PORT}`);
    console.log(`🎮 Setup multiplayer: http://localhost:${PORT}/multiplayer`);
});