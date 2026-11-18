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
    }

    // ==================== ROUTE #/multi/a/b ====================

    /** Entre dans le salon : le serveur vérifie le token et lance le compte à rebours */
    enterRoom({ a, b, login, token, settings }) {
        this.gameId       = `${a}-${b}`;
        this.role         = login === a ? 'host' : 'guest';
        this.streamerName = login;
        this.roomEntry    = { a, b, token, settings };

        window.multiplayerMode = true;
        window.currentGameId   = this.gameId;
        window.playerColor     = login === a ? 'white' : 'black';

        this.initializeSocket();
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

            // Après le lancement, une reconnexion ne doit pas rouvrir un salon
            if (this.roomEntry && !this.partnerConnected) this.socket.emit('multi:enter', this.roomEntry);
        });

        this.socket.on('disconnect', () => {
            console.log('🔌 Déconnecté du serveur');
            this.updatePartnerStatus(false);
            // Le serveur a clos la partie : la route multi propose d'en relancer une
            if (this.roomEntry && this.partnerConnected) {
                window.dispatchEvent(new Event('multiPartnerLeft'));
            }
        });
    }

    setupSocketListeners() {
        if (!this.socket || this.listening) return;
        this.listening = true;

        // ---- Salon de la route multi ----
        this.socket.on('multi:lobby', (data) => {
            window.dispatchEvent(new CustomEvent('multiRoomState', { detail: data }));
        });

        this.socket.on('multi:denied', (data) => {
            window.dispatchEvent(new CustomEvent('multiRoomDenied', { detail: data }));
        });

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

            // Connecter Twitch aux 2 channels (salon : chaque page garde le chat de sa chaîne)
            if (!this.roomEntry) this.connectTwitchChannels(white, black);

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

            // Vérifier la synchro : le FEN reçu est la position APRÈS le coup
            if (data.fen && ge.chess) {
                const remoteFen = data.fen.split(' ')[0]; // position seulement
                const probe = ge.chess.move(data.move);
                const localFen = ge.chess.fen().split(' ')[0];
                if (probe) ge.chess.undo();
                if (!probe || localFen !== remoteFen) {
                    console.warn('⚠️ Désync FEN détectée, resync...');
                    ge.loadFen(data.fen);
                    if (!ge.checkGameEnd()) ge.startTurn();
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
