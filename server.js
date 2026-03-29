const express = require('express');
const app = express();
const http = require('http').createServer(app);


app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});


const io = require('socket.io')(http, {
    cors: {
        origin: "*", // En production, mettez votre domaine
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const chatHistory = {};

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));


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
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
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
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
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
app.get('/proxy/chess-event/:slug', async (req, res) => {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
        const url = `https://www.chess.com/events/v1/api/room/${req.params.slug}`;
        
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
                'Referer': 'https://www.chess.com/',
                'Origin': 'https://www.chess.com',
                'Content-Type': 'application/json'
            },
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
app.get('/proxy/chess-event-game/:tournamentSlug/:roundSlug/:gameSlug', async (req, res) => {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
        const url = `https://www.chess.com/events/${req.params.tournamentSlug}/${req.params.roundSlug}/${req.params.gameSlug}`;
        console.log('🔍 Fetching game page:', url);
        const r = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
                'Referer': 'https://www.chess.com/',
            }
        });
        console.log('🔍 Status:', r.status);
        console.log('🔍 Content-Type:', r.headers.get('content-type'));
        const body = await r.text();
        console.log('🔍 Body preview:', body.slice(0, 1000));
        res.status(r.status).send(body);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
const games = {}; // Stockage des parties actives

io.on('connection', (socket) => {
    console.log('Nouvelle connexion:', socket.id);
    
    socket.on('createGame', (data) => {
        games[data.gameId] = {
            host: data.hostName,
            hostSocket: socket.id,
            settings: data.settings,
            guest: null,
            guestSocket: null,
            moves: []
        };
        socket.join(data.gameId);
        console.log(`Partie créée: ${data.gameId} par ${data.hostName}`);
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
        if (games[data.gameId]) {
            games[data.gameId].guest = data.guestName;
            games[data.gameId].guestSocket = socket.id;
            socket.join(data.gameId);

            if (chatHistory[data.gameId]) {
                socket.emit('chat:history', chatHistory[data.gameId]);
            }
            
            // Notifier les deux joueurs
            io.to(data.gameId).emit('gameReady', {
                players: {
                    white: games[data.gameId].host,
                    black: games[data.gameId].guest
                }
            });
            console.log(`${data.guestName} a rejoint la partie ${data.gameId}`);
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
        // Synchroniser le coup joué
        io.to(data.gameId).emit('movePlayed', data);
    });
    
    socket.on('disconnect', () => {
        console.log('Déconnexion:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📺 Interface solo: http://localhost:${PORT}`);
    console.log(`🎮 Setup multiplayer: http://localhost:${PORT}/multiplayer`);
});