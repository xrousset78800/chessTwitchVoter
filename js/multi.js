/**
 * MULTI.JS - Mode Bataille Twitch (Chat vs Chat en réseau)
 * Deux streamers, deux chats, une partie synchronisée via Socket.IO
 */

class MultiplayerManager {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.role = null;         // 'host' (blancs) ou 'guest' (noirs)
        this.streamerName = null;
        this.partnerConnected = false;

        this.initializeFromURL();
        this.bindEvents();
    }

    // ==================== INIT ====================

    initializeFromURL() {
        const params = new URLSearchParams(window.location.search);
        const gameId   = params.get('game');
        const role     = params.get('role');
        const streamer = params.get('streamer');

        if (gameId && role && streamer) {
            this.gameId       = gameId;
            this.role         = role;
            this.streamerName = streamer;

            window.multiplayerMode  = true;
            window.currentGameId    = gameId;
            window.playerColor      = (role === 'host') ? 'white' : 'black';

            console.log(`🎮 Multi depuis URL : ${role} dans la partie ${gameId}`);
            this.initializeSocket();
        }
    }

    bindEvents() {
        document.addEventListener('DOMContentLoaded', () => {
            this.setupTabs();
            this.setupButtons();
            this.setupCopyButtons();
            this.handleJoinParam();
        });
    }

    handleJoinParam() {
        const joinCode = new URLSearchParams(window.location.search).get('join');
        if (!joinCode) return;

        // Pré-remplir le code dans le formulaire browse
        const codeInput = document.getElementById('browse-join-code');
        if (codeInput) {
            codeInput.value = joinCode.toUpperCase();
            document.getElementById('browse-join-btn')?.scrollIntoView({ behavior: 'smooth' });
        }
    }

    // ==================== UI ====================

    setupTabs() {
        document.querySelectorAll('.multi-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const name = tab.dataset.tab;
                document.querySelectorAll('.multi-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.multi-tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(name + '-panel')?.classList.add('active');
            });
        });
    }

    setupButtons() {
        document.getElementById('createGameBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.createGame();
        });

        document.getElementById('joinGameBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.joinGame();
        });
    }

    setupCopyButtons() {
        document.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = document.getElementById(btn.dataset.target)?.textContent?.trim();
                if (!text) return;
                navigator.clipboard.writeText(text).then(() => {
                    const icon = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check" style="color:#34d399"></i>';
                    setTimeout(() => { btn.innerHTML = icon; }, 2000);
                });
            });
        });

        document.querySelectorAll('.btn-blank').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const url = document.getElementById(btn.dataset.target)?.textContent?.trim();
                if (url) window.open(url, '_blank');
            });
        });
    }

    // ==================== DEPUIS LA PAGE BROWSE ====================

    /** Appelé par BrowsePage quand l'utilisateur clique "Créer" */
    createGameFromBrowse(streamerName, options = {}) {
        this.gameId       = this.generateGameId();
        this.role         = 'host';
        this.streamerName = streamerName;

        if (options.timerDuration) window._browseTimerDuration = options.timerDuration;
        if (options.majorityMode  !== undefined) window._browseMajorityMode  = options.majorityMode;
        if (options.followersOnly !== undefined) window._browseFollowersOnly = options.followersOnly;
        if (options.subsOnly      !== undefined) window._browseSubsOnly      = options.subsOnly;

        window.multiplayerMode = true;
        window.currentGameId   = this.gameId;
        window.playerColor     = 'white';

        this.initializeSocket();

        // Naviguer vers sandbox et montrer le code
        window.dispatchEvent(new CustomEvent('multiNavigateSandbox', {
            detail: { role: 'host', gameId: this.gameId, streamer: streamerName }
        }));

        console.log(`🎮 Partie créée depuis browse : ${this.gameId}`);
        return this.gameId;
    }

    /** Appelé par BrowsePage quand l'utilisateur clique "Rejoindre" */
    joinGameFromBrowse(streamerName, gameCode) {
        this.gameId       = gameCode.toUpperCase();
        this.role         = 'guest';
        this.streamerName = streamerName;

        window.multiplayerMode = true;
        window.currentGameId   = this.gameId;
        window.playerColor     = 'black';

        this.initializeSocket();

        window.dispatchEvent(new CustomEvent('multiNavigateSandbox', {
            detail: { role: 'guest', gameId: this.gameId, streamer: streamerName }
        }));

        console.log(`🎮 Rejoindre depuis browse : ${this.gameId}`);
    }

    // ==================== CRÉER UNE PARTIE (depuis URL/sandbox legacy) ====================

    createGame() {
        const streamerName = document.getElementById('hostStreamerName')?.value?.trim();
        if (!streamerName) {
            this.showToast('Entre ton nom de channel Twitch', 'error');
            return;
        }

        this.gameId       = this.generateGameId();
        this.role         = 'host';
        this.streamerName = streamerName;

        const baseUrl      = window.location.origin + window.location.pathname;
        const commonParams = `gameMode=modStreamerChatvStreamerChat`;
        const hostUrl  = `${baseUrl}?game=${this.gameId}&role=host&streamer=${encodeURIComponent(streamerName)}&${commonParams}`;
        // URL guest = ouvre la page et pré-remplit le code + switche sur l'onglet Rejoindre
        const guestUrl = `${baseUrl}?join=${this.gameId}`;

        // Mettre à jour l'UI
        document.getElementById('gameCode').textContent  = this.gameId;
        document.getElementById('hostUrl').textContent   = hostUrl;
        document.getElementById('guestUrl').textContent  = guestUrl;
        document.getElementById('gameCreatedInfo').style.display = 'block';
        document.getElementById('createGameBtn').style.display   = 'none';

        window.multiplayerMode  = true;
        window.currentGameId    = this.gameId;
        window.playerColor      = 'white';

        this.initializeSocket();
        this.showToast(`Partie créée ! Code : ${this.gameId}`, 'success');
        console.log(`🎮 Partie créée : ${this.gameId} par ${streamerName}`);
    }

    // ==================== REJOINDRE UNE PARTIE ====================

    joinGame() {
        const streamerName = document.getElementById('guestStreamerName')?.value?.trim();
        const gameCode     = document.getElementById('gameCodeInput')?.value?.trim().toUpperCase();

        if (!streamerName || !gameCode) {
            this.showToast('Remplis tous les champs', 'error');
            return;
        }

        this.gameId       = gameCode;
        this.role         = 'guest';
        this.streamerName = streamerName;

        const baseUrl  = window.location.origin + window.location.pathname;
        const playerUrl = `${baseUrl}?game=${this.gameId}&role=guest&streamer=${encodeURIComponent(streamerName)}&gameMode=modStreamerChatvStreamerChat`;

        document.getElementById('playerUrl').textContent         = playerUrl;
        document.getElementById('gameJoinedInfo').style.display  = 'block';
        document.getElementById('joinGameBtn').style.display     = 'none';

        window.multiplayerMode  = true;
        window.currentGameId    = this.gameId;
        window.playerColor      = 'black';

        this.initializeSocket();
        this.showToast(`Connexion à la partie ${this.gameId}...`, 'info');
        console.log(`🎮 Rejoindre : ${this.gameId} en tant que ${streamerName}`);
    }

    // ==================== SOCKET.IO ====================

    initializeSocket() {
        if (typeof io === 'undefined') {
            console.warn('⚠️ Socket.IO non disponible — mode hors-ligne');
            return;
        }

        // Le serveur Socket.IO est servi par la même origine que la page
        this.socket = io({ transports: ['websocket', 'polling'] });

        this.socket.on('connect', () => {
            console.log('🔗 Connecté au serveur Socket.IO');
            this.setupSocketListeners();

            if (this.role === 'host') {
                this.socket.emit('createGame', {
                    gameId:    this.gameId,
                    hostName:  this.streamerName,
                    settings:  { timer: true }
                });
            } else if (this.role === 'guest') {
                this.socket.emit('joinGame', {
                    gameId:    this.gameId,
                    guestName: this.streamerName
                });
            }
        });

        this.socket.on('disconnect', () => {
            console.log('🔌 Déconnecté du serveur');
            this.updatePartnerStatus(false);
        });
    }

    setupSocketListeners() {
        if (!this.socket) return;

        // ---- Partie prête (les 2 joueurs connectés) ----
        this.socket.on('gameReady', (data) => {
            console.log('🎮 gameReady !', data);

            const white = data.players.white;
            const black = data.players.black;

            // Stocker les channels globalement
            window.streamer1Channel             = white;
            window.streamer2Channel             = black;
            window.streamerChatvStreamerChat0   = white;
            window.streamerChatvStreamerChat1   = black;

            this.partnerConnected = true;

            // Mettre à jour la bannière
            this.showActiveBanner(white, black);
            this.updatePartnerStatus(true);

            // Connecter Twitch aux 2 channels
            this.connectTwitchChannels(white, black);

            // Lancer le jeu (app.js écoute cet event)
            window.dispatchEvent(new CustomEvent('multiGameReady', { detail: data }));

            this.showToast(`⚔ Bataille lancée ! ${white} vs ${black}`, 'success');
        });

        // ---- Coup joué par le partenaire ----
        this.socket.on('movePlayed', (data) => {
            if (data.player === window.playerColor) return; // Notre propre coup rebounced, ignorer

            console.log(`🎯 Coup adverse reçu : ${data.move}`);

            const ge = window.gameEngine;
            if (!ge) return;

            // Vérifier la synchro via FEN avant d'appliquer
            if (data.fen && ge.chess) {
                const localFen = ge.chess.fen().split(' ')[0]; // position seulement
                const remoteFen = data.fen.split(' ')[0];
                if (localFen !== remoteFen) {
                    console.warn('⚠️ Désync FEN détectée, resync...');
                    ge.loadFen(data.fen);
                    return; // loadFen remet le board, pas besoin d'executeMove
                }
            }

            ge.executeMove(data.move, true); // true = fromNetwork, n'émet pas en retour
        });

        // ---- Votes du partenaire (affichage temps réel) ----
        this.socket.on('partnerVotes', (votes) => {
            this.displayPartnerVotes(votes);
        });

        // ---- Adversaire déconnecté ----
        this.socket.on('partnerLeft', () => {
            console.warn('⚠️ Adversaire déconnecté');
            this.partnerConnected = false;
            this.updatePartnerStatus(false);
            if (window.AppToast) window.AppToast.warning('⚠️ Adversaire déconnecté');
            window.dispatchEvent(new Event('multiPartnerLeft'));
        });

        // ---- Resynchronisation FEN forcée ----
        this.socket.on('syncFen', (data) => {
            const ge = window.gameEngine;
            if (data.fen && ge) {
                console.log('🔄 Resync FEN depuis serveur');
                ge.loadFen(data.fen);
            }
        });

        // ---- Historique chat ----
        this.socket.on('chat:history', (messages) => {
            messages.forEach(msg => this.displayChatMessage(msg));
        });

        this.socket.on('chat:message', (data) => {
            this.displayChatMessage(data);
        });
    }

    // ==================== TWITCH ====================

    async connectTwitchChannels(white, black) {
        const twitch = window.twitch;
        if (!twitch) {
            console.warn('⚠️ TwitchManager non disponible');
            return;
        }

        try {
            console.log(`📺 Connexion Twitch au channel principal : ${white}`);
            await twitch.connect(white);

            if (black && black !== white) {
                console.log(`📺 Rejoindre le channel secondaire : ${black}`);
                await twitch.joinChannel(black);
            }

            console.log('✅ Twitch connecté aux 2 channels');
            this.showToast(`📺 Twitch : #${white} & #${black}`, 'success');
        } catch (err) {
            console.error('❌ Erreur connexion Twitch multi:', err.message);
            this.showToast('Erreur connexion Twitch : ' + err.message, 'error');
        }
    }

    // ==================== ENVOI ====================

    sendMove(move) {
        if (!this.socket || !this.gameId) return;
        const ge = window.gameEngine;
        this.socket.emit('moveSelected', {
            gameId: this.gameId,
            player: window.playerColor,
            move:   move,
            fen:    ge?.chess?.fen() || null
        });
        console.log(`📤 Coup envoyé : ${move}`);
    }

    sendVotes(votes) {
        if (!this.socket || !this.gameId) return;
        this.socket.emit('votesUpdate', { gameId: this.gameId, votes });
    }

    sendChatMessage(messageData) {
        if (!this.socket || !this.gameId) return;
        this.socket.emit('chat:message', {
            gameId: this.gameId,
            role:   this.role,
            ...messageData
        });
    }

    // ==================== UI HELPERS ====================

    showActiveBanner(white, black) {
        const el = (id) => document.getElementById(id);
        if (el('multi-team-white')) el('multi-team-white').textContent = white;
        if (el('multi-team-black')) el('multi-team-black').textContent = black;
        if (el('multi-active-banner')) el('multi-active-banner').style.display = 'block';
        if (el('multi-status-badge')) el('multi-status-badge').style.display   = '';
        if (el('multi-tabs-container')) el('multi-tabs-container').style.display = 'none';
        document.body.classList.add('multi-active');
    }

    updatePartnerStatus(connected) {
        const waitEls = document.querySelectorAll('.multi-waiting');

        if (connected) {
            waitEls.forEach(el => {
                el.classList.add('multi-waiting--connected');
                const dot = el.querySelector('.multi-waiting__dot');
                if (dot) dot.style.background = '#10b981';
                const textNode = el.lastChild;
                if (textNode) textNode.textContent = ' Adversaire connecté !';
            });
        } else {
            waitEls.forEach(el => el.classList.remove('multi-waiting--connected'));
        }
    }

    updateTurnIndicator() {
        if (!window.multiplayerMode || !window.playerColor) return;
        const ge = window.gameEngine;
        if (!ge?.chess) return;

        const turn = ge.chess.turn(); // 'w' ou 'b'
        const isMyTurn = (window.playerColor === 'white' && turn === 'w') ||
                         (window.playerColor === 'black' && turn === 'b');

        document.body.classList.toggle('multi-your-turn',  isMyTurn);
        document.body.classList.toggle('multi-their-turn', !isMyTurn);

        const ind = document.getElementById('multi-turn-indicator');
        if (ind) {
            ind.textContent = isMyTurn
                ? '🗳 À votre tour — votez !'
                : '⏳ Tour de l\'adversaire...';
        }
    }

    displayPartnerVotes(votes) {
        // Affichage optionnel dans le vote-log
        if (!votes || !window.VoteLog) return;
        Object.entries(votes).forEach(([move, count]) => {
            window.VoteLog.add(`[adv] ×${count}`, move);
        });
    }

    displayChatMessage(data) {
        const chatEl = document.querySelector('.chat-messages');
        if (!chatEl) return;

        const el = document.createElement('div');
        el.className = 'chat-message';
        const teamClass = data.team || (data.role === 'host' ? 'white' : 'black');
        el.innerHTML = `
            <span class="message-author ${teamClass}-team">${data.author}</span>
            <span class="message-content"> ${this.escapeHtml(data.content)}</span>
        `;
        chatEl.appendChild(el);
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    // ==================== UTILS ====================

    generateGameId() {
        return Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    getGameInfo() {
        return {
            gameId:           this.gameId,
            role:             this.role,
            streamerName:     this.streamerName,
            partnerConnected: this.partnerConnected,
            isMultiplayer:    !!this.gameId
        };
    }

    showToast(message, type = 'info') {
        // Utilise le système de Toast de app.js si disponible
        if (window.AppToast) {
            window.AppToast[type]?.(message) || window.AppToast.show(message, type);
            return;
        }
        // Fallback maison
        const toast = document.createElement('div');
        const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
        toast.style.cssText = `
            position:fixed; top:20px; right:20px; z-index:99999;
            background:${colors[type] || colors.info};
            color:#fff; padding:10px 18px; border-radius:8px;
            font-size:0.85rem; font-weight:600;
            box-shadow:0 4px 20px rgba(0,0,0,0.4);
            animation:multi-glow-in 0.3s ease-out;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }
}

// Instance globale
const multiplayerManager = new MultiplayerManager();
window.multiplayerManager = multiplayerManager;
