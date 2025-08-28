/**
 * MULTI.JS - Gestion du mode multiplayer StreamerChat vs StreamerChat
 * Intégré directement dans index.html sans page intermédiaire
 */

class MultiplayerManager {
    constructor() {
        if (window.multiplayerManagerInstance) {
            console.warn('⚠️ MultiplayerManager existe déjà');
            return window.multiplayerManagerInstance;
        }
        
        this.socket = null;
        this.gameId = null;
        this.role = null;
        this.streamerName = null;
        this.partnerConnected = false;
        this.initialized = false; // Flag pour éviter double init
        
        // Sauvegarder l'instance
        window.multiplayerManagerInstance = this;
        
        // Initialiser dès le chargement de la page
        this.initializeFromURL();
        this.bindEvents();
    }
    
    /**
     * Initialise le mode multiplayer depuis les paramètres URL
     */
    initializeFromURL() {
        // Éviter la double initialisation
        if (this.initialized) {
            console.warn('⚠️ MultiplayerManager déjà initialisé');
            return;
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const gameId = urlParams.get('game');
        const role = urlParams.get('role');
        const streamer = urlParams.get('streamer');
        
        if (gameId && role && streamer) {
            this.gameId = gameId;
            this.role = role;
            this.streamerName = streamer;
            this.initialized = true;
            
            // Activer le mode multiplayer global
            window.multiplayerMode = true;
            window.currentGameId = gameId;
            window.playerColor = (role === 'host') ? 'white' : 'black';
            
            console.log(`🎮 Mode multiplayer activé: ${role} dans la partie ${gameId}`);
            
            // Configurer les variables pour le mode StreamerChat
            this.configureStreamerChatMode();
            
            // Socket.IO sera initialisé plus tard quand il sera chargé
            this.waitForSocketIO();
        }
    }
    
    waitForSocketIO() {
        if (this.socketInitialized) return;
        
        // Vérifier si Socket.IO est déjà disponible
        if (typeof io !== 'undefined') {
            this.initializeSocket();
            return;
        }
        
        // Sinon, attendre qu'il soit chargé
        const checkInterval = setInterval(() => {
            if (typeof io !== 'undefined') {
                clearInterval(checkInterval);
                this.initializeSocket();
            }
        }, 100);
        
        // Timeout après 10 secondes
        setTimeout(() => {
            clearInterval(checkInterval);
            if (typeof io === 'undefined') {
                console.warn('⚠️ Socket.IO non chargé après 10s');
            }
        }, 10000);
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
        
        // Récupérer TOUS les paramètres de configuration
        const baseUrl = window.location.origin + window.location.pathname;
        const commonParams = this.getCommonUrlParams();
        
        // Créer les URLs avec les noms de streamers corrects
        const hostUrl = `${baseUrl}?game=${this.gameId}&role=host&streamer=${encodeURIComponent(streamerName)}&streamerChatvStreamerChat0=${encodeURIComponent(streamerName)}&${commonParams}`;
        
        // Pour le guest, on ne connaît pas encore son nom, donc placeholder
        const guestUrl = `${baseUrl}?game=${this.gameId}&role=guest&streamer=GUEST_NAME&streamerChatvStreamerChat1=GUEST_NAME&${commonParams}`;
        
        // Mettre à jour l'interface
        this.updateGameCreatedUI(this.gameId, hostUrl, guestUrl);
        
        // Sauvegarder les configs localement aussi
        window.multiplayerMode = true;
        window.currentGameId = this.gameId;
        window.playerColor = 'white';
        window.streamer1Channel = streamerName;
        window.streamerChatvStreamerChat0 = streamerName;
        
        // Initialiser Socket.IO
        this.initializeSocket();
        
        this.showToast('Partie créée avec succès ! Partagez l\'URL Guest avec votre adversaire.', 'success');
        console.log(`🎮 Partie créée: ${this.gameId} par ${streamerName}`);
        console.log('🔗 Configuration complète dans l\'URL');
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
        
        // === CONFIGURATION DE BASE ===
        
        // Mode de jeu (forcé en StreamerChat vs StreamerChat)
        params.append('gameMode', 'modStreamerChatvStreamerChat');
        
        // Canal par défaut
        if (typeof defaultChannel !== 'undefined' && defaultChannel) {
            params.append('defaultChannel', defaultChannel);
        }
        
        // === OPTIONS DE TIMER ===
        
        // Timer activé/désactivé
        if (typeof timerMode !== 'undefined') {
            params.append('timerMode', timerMode ? 'on' : 'off');
        }
        
        // Durée du timer de vote
        if (typeof InitialvoterTimer !== 'undefined' && InitialvoterTimer) {
            params.append('InitialvoterTimer', InitialvoterTimer);
        }
        
        // Pause après victoire/défaite
        if (typeof pauseAfterWinLose !== 'undefined' && pauseAfterWinLose) {
            params.append('pauseAfterWinLose', pauseAfterWinLose);
        }
        
        // Animation de la roue
        if (typeof timerWheelAnimation !== 'undefined' && timerWheelAnimation) {
            params.append('timerWheelAnimation', timerWheelAnimation);
        }
        
        // === OPTIONS DE VOTE ===
        
        // Vote unique par tour
        if (typeof limitToOneVote !== 'undefined') {
            params.append('limitToOneVote', limitToOneVote ? 'on' : 'off');
        }
        
        // Mode majorité
        if (typeof majorityMode !== 'undefined') {
            params.append('majorityMode', majorityMode ? 'on' : 'off');
        }
        
        // === RESTRICTIONS D'ACCÈS ===
        
        // Mode followers uniquement
        if (typeof followMode !== 'undefined') {
            params.append('followMode', followMode ? 'on' : 'off');
        }
        
        // Mode abonnés uniquement
        if (typeof subMode !== 'undefined') {
            params.append('subMode', subMode ? 'on' : 'off');
        }
        
        // === MODE PROBLÈME ===
        
        // Mode problème activé
        if (typeof probMode !== 'undefined') {
            params.append('probMode', probMode ? 'on' : 'off');
        }
        
        // Thèmes sélectionnés pour les problèmes
        if (typeof selectedThemes !== 'undefined' && selectedThemes && selectedThemes.size > 0) {
            const themesArray = Array.from(selectedThemes);
            params.append('selectedThemes', themesArray.join(','));
        }
        
        // === AUTRES OPTIONS ===
        
        // Background supprimé (pour OBS)
        if (typeof noBg !== 'undefined') {
            params.append('noBg', noBg ? 'on' : 'off');
        }
        
        console.log('📋 Paramètres URL générés:', params.toString());
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
        if (this.socketInitialized) {
            console.warn('⚠️ Socket déjà initialisé');
            return;
        }
        
        if (typeof io === 'undefined') {
            console.warn('⚠️ Socket.IO non disponible');
            return;
        }
        
        this.socketInitialized = true;
        this.socket = io();
        window.gameSocket = this.socket; // Partager globalement
        
        console.log('🔌 Connexion Socket.IO initialisée');
        
        this.socket.on('connect', () => {
            console.log('🔗 Connecté au serveur');
            
            if (this.role === 'host') {
                this.socket.emit('createGame', {
                    gameId: this.gameId,
                    hostName: this.streamerName,
                    settings: {
                        timer: typeof timerMode !== 'undefined' ? timerMode : false,
                        restrictions: {
                            followMode: typeof followMode !== 'undefined' ? followMode : false,
                            subMode: typeof subMode !== 'undefined' ? subMode : false
                        }
                    }
                });
            } else if (this.role === 'guest') {
                this.socket.emit('joinGame', {
                    gameId: this.gameId,
                    guestName: this.streamerName
                });
            }
        });
        
        // Configurer les handlers une seule fois
        this.setupSocketHandlers();
    }
    setupSocketHandlers() {
        if (!this.socket) return;
        
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
            // Synchroniser les coups
            if (data.player !== window.playerColor && typeof window.chess !== 'undefined') {
                console.log(`🎯 Coup reçu de l'adversaire: ${data.move}`);
                
                // Utiliser moveAction avec le flag isFromNetwork
                if (typeof moveAction === 'function') {
                    moveAction(data.move, true);
                } else {
                    // Fallback si moveAction n'est pas disponible
                    window.chess.move(data.move);
                    if (typeof window.board !== 'undefined') {
                        window.board.position(window.chess.fen());
                    }
                }
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
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    
    /**
     * Affiche un toast de notification
     */
    showToast(message, type = 'info') {
        // Créer un élément de notification
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            border-radius: 4px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        
        // Retirer après 5 secondes
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
    
    /**
     * Retourne les informations de la partie actuelle
     */
    getGameInfo() {
        return {
            gameId: this.gameId,
            role: this.role,
            streamerName: this.streamerName,
            isMultiplayer: true,
            partnerConnected: this.partnerConnected
        };
    }
}

// Initialiser le gestionnaire multiplayer
const multiplayerManager = new MultiplayerManager();

// Rendre le gestionnaire disponible globalement
window.multiplayerManager = multiplayerManager;