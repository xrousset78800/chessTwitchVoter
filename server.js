const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // En production, mettez votre domaine
        methods: ["GET", "POST"]
    }
});
const path = require('path');

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
    
    socket.on('joinGame', (data) => {
        if (games[data.gameId]) {
            games[data.gameId].guest = data.guestName;
            games[data.gameId].guestSocket = socket.id;
            socket.join(data.gameId);
            
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