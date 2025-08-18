        let socket = null;
        let currentGameId = null;
        let playerRole = null;

        function showCreateForm() {
            document.getElementById('mainMenu').style.display = 'none';
            document.getElementById('createForm').classList.add('active');
        }

        function showJoinForm() {
            document.getElementById('mainMenu').style.display = 'none';
            document.getElementById('joinForm').classList.add('active');
        }

        function backToMenu() {
            document.getElementById('mainMenu').style.display = 'block';
            document.getElementById('createForm').classList.remove('active');
            document.getElementById('joinForm').classList.remove('active');
            document.getElementById('gameCreatedInfo').style.display = 'none';
            document.getElementById('gameJoinedInfo').style.display = 'none';
        }

        function generateGameId() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let result = '';
            for (let i = 0; i < 4; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return result;
        }

        function createGame() {
            const streamerName = document.getElementById('hostStreamer').value.trim();
            const voteTime = document.getElementById('voteTime').value;
            
            if (!streamerName) {
                alert('Veuillez entrer votre nom Twitch');
                return;
            }
            
            currentGameId = generateGameId();
            playerRole = 'host';
            
            // Générer les URLs
            const baseUrl = window.location.origin;
            const hostUrl = `${baseUrl}/index.html?game=${currentGameId}&role=host`;
            const guestUrl = `${baseUrl}/index.html?game=${currentGameId}&role=guest`;
            
            // Afficher les infos
            document.getElementById('gameCode').textContent = currentGameId;
            document.getElementById('hostUrl').textContent = hostUrl;
            document.getElementById('guestUrl').textContent = guestUrl;
            document.getElementById('gameCreatedInfo').style.display = 'block';
            
            // Initialiser Socket.io (si vous avez un serveur)
            initSocket(streamerName);
        }

        function joinGame() {
            const streamerName = document.getElementById('guestStreamer').value.trim();
            const gameCode = document.getElementById('gameCodeInput').value.trim().toUpperCase();
            
            if (!streamerName || !gameCode) {
                alert('Veuillez remplir tous les champs');
                return;
            }
            
            currentGameId = gameCode;
            playerRole = 'guest';
            
            // Générer l'URL
            const playerUrl = `${window.location.origin}/index.html?game=${currentGameId}&role=guest`;
            
            document.getElementById('playerUrl').textContent = playerUrl;
            document.getElementById('gameJoinedInfo').style.display = 'block';
            
            // Initialiser Socket.io
            initSocket(streamerName);
        }

        function initSocket(streamerName) {            
            socket = io('http://localhost:3000');
            
            socket.on('connect', () => {
                console.log('Connecté au serveur');
                
                if (playerRole === 'host') {
                    socket.emit('createGame', {
                        gameId: currentGameId,
                        hostName: streamerName,
                        voteTime: document.getElementById('voteTime').value
                    });
                } else {
                    socket.emit('joinGame', {
                        gameId: currentGameId,
                        guestName: streamerName
                    });
                }
            });
            
            socket.on('playerJoined', (data) => {
                if (playerRole === 'host') {
                    document.querySelector('.status-waiting').textContent = 'Joueur connecté !';
                    document.querySelector('.status-waiting').className = 'status status-connected';
                }
            });
            
            
            // Pour l'instant, simulation sans serveur
            //console.log(`Mode: ${playerRole}, Game: ${currentGameId}, Streamer: ${streamerName}`);
        }

        function startGame() {
            const url = document.getElementById('playerUrl').textContent;
            if (url && url !== 'URL à générer...') {
                window.location.href = url;
            }
        }

        function copyUrl(elementId) {
            const text = document.getElementById(elementId).textContent;
            navigator.clipboard.writeText(text).then(() => {
                alert('URL copiée !');
            });
        }

        // Auto-format du code
        document.getElementById('gameCodeInput')?.addEventListener('input', function(e) {
            e.target.value = e.target.value.toUpperCase();
        });