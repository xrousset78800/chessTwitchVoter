/**
 * MULTI.JS - Gestion du mode multiplayer StreamerChat vs StreamerChat
 * Intégré directement dans index.html sans page intermédiaire
 */

class MultiplayerManager {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.role = null;
        this.streamerName = null;
        this.partnerConnected = false;
        
        // Initialiser dès le chargement de la page
        this.initializeFromURL();
        this.bindEvents();
    }
    
    /**
     * Initialise le mode multiplayer depuis les paramètres URL
     */
    initializeFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const gameId = urlParams.get('game');
        const role = urlParams.get('role');
        const streamer = urlParams.get('streamer');
        
        if (gameId && role && streamer) {
            this.gameId = gameId;
            this.role = role;
            this.streamerName = streamer;
            
            // Activer le mode multiplayer global
            window.multiplayerMode = true;
            window.currentGameId = gameId;
            window.playerColor = (role === 'host') ? 'white' : 'black';
            
            console.log(`🎮 Mode multiplayer activé: ${role} dans la partie ${gameId}`);
            
            // Initialiser la connexion Socket.IO
            this.initializeSocket();
            
            // Configurer les variables pour le mode StreamerChat
            this.configureStreamerChatMode();
        }
    }
    
    /**
     * Configure les variables globales pour le mode StreamerChat
     */
    configureStreamerChatMode() {
        // Forcer le mode StreamerChat vs StreamerChat
        window.modStreamerChatvStreamerChat = true;
        
        // Configurer les streamers selon le rôle
        if (this.role === 'host') {
            window.streamer1Channel = this.streamerName;
            window.streamerChatvStreamerChat0 = this.streamerName;
            // Le streamer2 sera défini quand le guest se connecte
        } else if (this.role === 'guest') {
            window.streamer2Channel = this.streamerName;
            window.streamerChatvStreamerChat1 = this.streamerName;
        }
        
        console.log(`📺 Streamer configuré: ${this.streamerName} (${this.role})`);
    }
    
    /**
     * Lie les événements pour l'interface multiplayer dans index.html
     */
    bindEvents() {
        // Gestion des onglets multiplayer
        document.addEventListener('DOMContentLoaded', () => {
            this.setupMultiplayerTabs();
            this.setupMultiplayerButtons();
            this.setupCopyButtons();
        });
    }
    
    setupMultiplayerTabs() {
        document.querySelectorAll('.multiplayer-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                
                // Activer l'onglet
                document.querySelectorAll('.multiplayer-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Afficher le panneau correspondant
                document.querySelectorAll('.multiplayer-panel').forEach(panel => panel.classList.remove('active'));
                document.getElementById(tabName + '-panel').classList.add('active');
            });
        });
    }
    
    setupMultiplayerButtons() {
        // Bouton créer partie
        const createBtn = document.getElementById('createGameBtn');
        if (createBtn) {
            createBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.createGame();
            });
        }
        
        // Bouton rejoindre partie
        const joinBtn = document.getElementById('joinGameBtn');
        if (joinBtn) {
            joinBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.joinGame();
            });
        }
    }
    
    setupCopyButtons() {
        // Boutons de copie
        document.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.target;
                const text = document.getElementById(targetId).textContent;
                
                navigator.clipboard.writeText(text).then(() => {
                    const originalIcon = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i>';
                    setTimeout(() => {
                        btn.innerHTML = originalIcon;
                    }, 2000);
                    
                    this.showToast('URL copiée !', 'success');
                });
            });
        });
        
        // Boutons d'ouverture dans un nouvel onglet
        document.querySelectorAll('.btn-blank').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = btn.dataset.target;
                const url = document.getElementById(targetId).textContent;
                window.open(url, '_blank');
            });
        });
    }
    
    /**
     * Créer une nouvelle partie multiplayer
     */
    createGame() {
        const streamerInput = document.getElementById('hostStreamerName');
        const streamerName = streamerInput ? streamerInput.value.trim() : '';
        
        if (!streamerName) {
            this.showToast('Veuillez entrer votre nom de streameur', 'error');
            return;
        }
        
        // Générer un code de partie
        this.gameId = this.generateGameId();
        this.role = 'host';
        this.streamerName = streamerName;
        
        // Générer les URLs avec tous les paramètres nécessaires
        const baseUrl = window.location.origin + window.location.pathname;
        const commonParams = this.getCommonUrlParams();
        
        const hostUrl = `${baseUrl}?game=${this.gameId}&role=host&streamer=${encodeURIComponent(streamerName)}&${commonParams}`;
        const guestUrl = `${baseUrl}?game=${this.gameId}&role=guest&streamer=${encodeURIComponent(streamerName)}&${commonParams}`;
        
        // Mettre à jour l'interface
        this.updateGameCreatedUI(this.gameId, hostUrl, guestUrl);
        
        // Activer le mode multiplayer
        window.multiplayerMode = true;
        window.currentGameId = this.gameId;
        window.playerColor = 'white';
        
        // Initialiser Socket.IO pour la partie créée
        this.initializeSocket();
        
        this.showToast('Partie créée avec succès !', 'success');
        console.log(`🎮 Partie créée: ${this.gameId} par ${streamerName}`);
    }
    
    /**
     * Rejoindre une partie existante
     */
    joinGame() {
        const streamerInput = document.getElementById('guestStreamerName');
        const codeInput = document.getElementById('gameCodeInput');
        
        const streamerName = streamerInput ? streamerInput.value.trim() : '';
        const gameCode = codeInput ? codeInput.value.trim().toUpperCase() : '';
        
        if (!streamerName || !gameCode) {
            this.showToast('Veuillez remplir tous les champs', 'error');
            return;
        }
        
        this.gameId = gameCode;
        this.role = 'guest';
        this.streamerName = streamerName;
        
        // Générer l'URL du joueur
        const baseUrl = window.location.origin + window.location.pathname;
        const commonParams = this.getCommonUrlParams();
        const playerUrl = `${baseUrl}?game=${this.gameId}&role=guest&streamer=${encodeURIComponent(streamerName)}&${commonParams}`;
        
        // Mettre à jour l'interface
        this.updateGameJoinedUI(playerUrl);
        
        // Activer le mode multiplayer
        window.multiplayerMode = true;
        window.currentGameId = this.gameId;
        window.playerColor = 'black';
        
        // Initialiser Socket.IO pour rejoindre la partie
        this.initializeSocket();
        
        this.showToast('Connexion à la partie !', 'success');
        console.log(`🎮 Connexion à la partie: ${this.gameId} par ${streamerName}`);
    }
    
    /**
     * Génère les paramètres communs pour les URLs
     */
    getCommonUrlParams() {
        const params = new URLSearchParams();
        
        // Mode de jeu
        params.append('gameMode', 'modStreamerChatvStreamerChat');
        /*
        // Paramètres par défaut
        params.append('defaultChannel', 'Xou____');
        params.append('timerMode', 'on');
        params.append('InitialvoterTimer', '50');
        params.append('timerWheelAnimation', '10');
        params.append('pauseAfterWinLose', '15');*/
        
        return params.toString();
    }
    
    /**
     * Met à jour l'UI après création de partie
     */
    updateGameCreatedUI(gameCode, hostUrl, guestUrl) {
        const gameCodeEl = document.getElementById('gameCode');
        const hostUrlEl = document.getElementById('hostUrl');
        const guestUrlEl = document.getElementById('guestUrl');
        const gameInfoEl = document.getElementById('gameCreatedInfo');
        const createBtn = document.getElementById('createGameBtn');
        
        if (gameCodeEl) gameCodeEl.textContent = gameCode;
        if (hostUrlEl) hostUrlEl.textContent = hostUrl;
        if (guestUrlEl) guestUrlEl.textContent = guestUrl;
        if (gameInfoEl) gameInfoEl.style.display = 'block';
        if (createBtn) createBtn.style.display = 'none';
    }
    
    /**
     * Met à jour l'UI après avoir rejoint une partie
     */
    updateGameJoinedUI(playerUrl) {
        const playerUrlEl = document.getElementById('playerUrl');
        const gameInfoEl = document.getElementById('gameJoinedInfo');
        const joinBtn = document.getElementById('joinGameBtn');
        
        if (playerUrlEl) playerUrlEl.textContent = playerUrl;
        if (gameInfoEl) gameInfoEl.style.display = 'block';
        if (joinBtn) joinBtn.style.display = 'none';
    }
    
    /**
     * Initialise la connexion Socket.IO
     */
    initializeSocket() {
        if (typeof io === 'undefined') {
            console.warn('⚠️ Socket.IO non disponible');
            return;
        }
        
        const SOCKET_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? 'http://localhost:3000'
            : 'https://chesstwitchvoter.onrender.com';
            
        this.socket = io(SOCKET_URL);
        
        this.socket.on('connect', () => {
            console.log('🔗 Connecté au serveur');
            
            // AJOUTER CETTE LIGNE
            this.setupChatListeners();
            console.log('🔗 Connecté au serveur');
            
            if (this.role === 'host') {
                this.socket.emit('createGame', {
                    gameId: this.gameId,
                    hostName: this.streamerName,
                    settings: {
                        timer: true,
                        restrictions: {}
                    }
                });
            } else if (this.role === 'guest') {
                this.socket.emit('joinGame', {
                    gameId: this.gameId,
                    guestName: this.streamerName
                });
            }
        });
        
        this.socket.on('gameReady', (data) => {
            console.log('🎮 Partie prête !', data);
            
            // Configurer les streamers des deux côtés
            window.streamer1Channel = data.players.white;
            window.streamer2Channel = data.players.black;
            window.streamerChatvStreamerChat0 = data.players.white;
            window.streamerChatvStreamerChat1 = data.players.black;
            
            this.partnerConnected = true;
            this.updateConnectionStatus('Adversaire connecté !');
            this.showToast('La partie peut commencer !', 'success');
        });
        
        this.socket.on('partnerVotes', (votes) => {
            // Afficher les votes du partenaire
            this.displayPartnerVotes(votes);
        });
        
this.socket.on('movePlayed', (data) => {
    if (data.player !== window.playerColor && typeof window.chess !== 'undefined') {
        // Appeler moveAction avec flag réseau pour éviter boucle
        if (typeof window.moveAction === 'function') {
            window.moveAction(data.move, true);
        }
        console.log(`🎯 Coup reçu: ${data.move}`);
    }
});
        
        this.socket.on('disconnect', () => {
            console.log('🔌 Déconnecté du serveur');
            this.updateConnectionStatus('Connexion perdue...');
        });
    }
    
    /**
     * Affiche les votes du partenaire
     */
    displayPartnerVotes(votes) {
        // Cette fonction peut être étendue pour afficher les votes en temps réel
        console.log('👥 Votes du partenaire:', votes);
    }
    
    /**
     * Met à jour le statut de connexion
     */
    updateConnectionStatus(message) {
        const statusEl = document.getElementById('gameStatus') || document.querySelector('.status-waiting');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }
    
    /**
     * Envoie les votes via Socket.IO
     */
    sendVotes(votes) {
        if (this.socket && this.gameId) {
            this.socket.emit('votesUpdate', {
                gameId: this.gameId,
                votes: votes
            });
        }
    }
    
    /**
     * Envoie un coup joué via Socket.IO
     */
    sendMove(move) {
        if (this.socket && this.gameId) {
            this.socket.emit('moveSelected', {
                gameId: this.gameId,
                player: window.playerColor,
                move: move,
                fen: window.chess ? window.chess.fen() : null
            });
        }
    }
    
    /**
     * Génère un ID de partie aléatoire
     */
    generateGameId() {
        return Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    
    /**
     * Affiche un toast de notification
     */
    showToast(message, type = 'info') {
        // Utiliser l'alerte native en fallback
        console.log(`${type.toUpperCase()}: ${message}`);
        
        // Créer un toast personnalisé
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#48bb78' : type === 'error' ? '#f56565' : '#4299e1'};
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
    
    /**
     * Retourne les informations de la partie actuelle
     */
    getGameInfo() {
        return {
            gameId: this.gameId,
            role: this.role,
            streamerName: this.streamerName,
            partnerConnected: this.partnerConnected,
            isMultiplayer: !!this.gameId
        };
    }

    /**
     * Envoie un message de chat via Socket.IO
     * @param {Object} messageData - Données du message
     */
    sendChatMessage(messageData) {
        if (!this.socket || !this.gameId) {
            console.warn('⚠️ Pas de connexion Socket.IO active');
            return;
        }
        
        this.socket.emit('chat:message', {
            gameId: this.gameId,
            role: this.role,
            ...messageData
        });
        
        console.log('💬 Message envoyé:', messageData);
    }

    /**
     * Configure l'écoute des messages de chat entrants
     */
    setupChatListeners() {
        if (!this.socket) return;
        
        this.socket.on('chat:message', (data) => {
            this.displayChatMessage(data);
        });
        
        this.socket.on('chat:history', (messages) => {
            // Afficher l'historique des messages
            messages.forEach(msg => this.displayChatMessage(msg));
        });
    }

    /**
     * Affiche un message de chat dans l'interface
     */
    displayChatMessage(data) {
        const chatMessages = document.querySelector('.chat-messages');
        if (!chatMessages) {
            console.warn('⚠️ Zone de chat non trouvée dans le DOM');
            return;
        }
        
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        
        // Déterminer l'équipe du message
        const teamClass = data.team || (data.role === 'host' ? 'white' : 'black');
        
        messageElement.innerHTML = `
            <div class="message-author ${teamClass}-team">
                ${data.author} 
                ${data.badges?.broadcaster ? '📺' : ''}
                ${data.badges?.moderator ? '⚔️' : ''}
                ${data.badges?.subscriber ? '⭐' : ''}
            </div>
            <div class="message-content">${this.escapeHtml(data.content)}</div>
            <div class="message-time">${new Date(data.timestamp).toLocaleTimeString()}</div>
        `;
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    /**
     * Échappe le HTML pour éviter les injections XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    
}

// Initialiser le gestionnaire multiplayer
const multiplayerManager = new MultiplayerManager();

// Rendre le gestionnaire disponible globalement
window.multiplayerManager = multiplayerManager;