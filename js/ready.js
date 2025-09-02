class ReadySyncManager {
    constructor() {
        this.readyStates = {
            streamer1: false,
            streamer2: false
        };
        this.gameStarted = false;
        this.readyKeywords = ['ready', 'pret', 'prêt', 'go', 'start'];
        this.initializeReadySystem();
    }

    initializeReadySystem() {
        // Écouter les messages de chat pour détecter "ready"
        if (window.client) {
            window.client.on('message', (channel, tags, message, self) => {
                this.handleChatMessage(channel, tags, message, self);
            });
        }

        // Interface UI pour le statut ready
        this.createReadyUI();
        
        console.log('🎯 Système Ready initialisé');
    }

    createReadyUI() {
        // Créer l'interface de statut ready
        const readyContainer = document.createElement('div');
        readyContainer.id = 'readyStatusContainer';
        readyContainer.innerHTML = `
            <div class="ready-status-panel">
                <h3>🎮 Statut de synchronisation</h3>
                <div class="ready-status-row">
                    <span class="streamer-name">${window.streamerChatvStreamerChat0 || 'Streamer 1'}</span>
                    <span id="ready-status-1" class="ready-indicator waiting">⏳ En attente</span>
                </div>
                <div class="ready-status-row">
                    <span class="streamer-name">${window.streamerChatvStreamerChat1 || 'Streamer 2'}</span>
                    <span id="ready-status-2" class="ready-indicator waiting">⏳ En attente</span>
                </div>
                <div class="ready-instructions">
                    💬 Les streamers doivent taper "ready" dans leur chat pour commencer
                </div>
            </div>
        `;

        document.body.appendChild(readyContainer);
    }

    handleChatMessage(channel, tags, message, self) {
        // Ignorer les messages du bot
        if (self) return;

        const username = tags['display-name'] || tags.username;
        const messageText = message.toLowerCase().trim();

        // Vérifier si c'est un streamer et s'il dit "ready"
        if (this.isReadyCommand(messageText)) {
            this.checkStreamerReady(channel, username);
        }
    }

    isReadyCommand(message) {
        return this.readyKeywords.some(keyword => 
            message === keyword || 
            message.includes(keyword)
        );
    }

    checkStreamerReady(channel, username) {
        // Déterminer quel streamer a dit ready
        const channelName = channel.substring(1); // Retirer le #
        
        if (channelName === window.streamerChatvStreamerChat0 && 
            (username.toLowerCase() === channelName.toLowerCase() || this.isChannelModerator(username))) {
            this.setStreamerReady('streamer1', window.streamerChatvStreamerChat0);
        } 
        else if (channelName === window.streamerChatvStreamerChat1 && 
                (username.toLowerCase() === channelName.toLowerCase() || this.isChannelModerator(username))) {
            this.setStreamerReady('streamer2', window.streamerChatvStreamerChat1);
        }
    }

    isChannelModerator(username) {
        // Logique pour vérifier si l'utilisateur est modérateur
        // Pour l'instant, accepter seulement le streamer lui-même
        return false;
    }

    setStreamerReady(streamerKey, streamerName) {
        if (this.gameStarted) return;

        if (!this.readyStates[streamerKey]) {
            this.readyStates[streamerKey] = true;
            console.log(`✅ ${streamerName} est prêt !`);
            
            // Mettre à jour l'UI
            this.updateReadyUI(streamerKey);
            
            // Synchroniser avec l'autre instance via Socket.IO si disponible
            this.syncReadyState(streamerKey, streamerName);
            
            // Vérifier si les deux sont prêts
            this.checkBothReady();
        }
    }

    updateReadyUI(streamerKey) {
        const statusId = streamerKey === 'streamer1' ? 'ready-status-1' : 'ready-status-2';
        const statusElement = document.getElementById(statusId);
        
        if (statusElement) {
            statusElement.textContent = '✅ Prêt !';
            statusElement.className = 'ready-indicator ready';
        }
    }

    syncReadyState(streamerKey, streamerName) {
        // Si on est en mode multiplayer avec Socket.IO
        if (window.multiplayerSocket && window.multiplayerGameId) {
            window.multiplayerSocket.emit('streamerReady', {
                gameId: window.multiplayerGameId,
                streamer: streamerKey,
                streamerName: streamerName,
                timestamp: Date.now()
            });
        }
    }

    // Recevoir les états ready de l'autre instance
    handleRemoteReadyState(data) {
        if (data.streamer && !this.readyStates[data.streamer]) {
            this.readyStates[data.streamer] = true;
            this.updateReadyUI(data.streamer);
            console.log(`📡 État ready reçu pour ${data.streamerName}`);
            this.checkBothReady();
        }
    }

    checkBothReady() {
        if (this.readyStates.streamer1 && this.readyStates.streamer2 && !this.gameStarted) {
            console.log('🎉 Les deux streamers sont prêts ! Démarrage du jeu...');
            this.startSynchronizedGame();
        }
    }

    startSynchronizedGame() {
        this.gameStarted = true;
        
        // Animation de démarrage
        const panel = document.querySelector('.ready-status-panel');
        if (panel) {
            panel.classList.add('game-starting');
            panel.querySelector('.ready-instructions').textContent = '🚀 Démarrage du jeu...';
        }

        // Délai de 3 secondes pour la synchronisation
        setTimeout(() => {
            this.launchGame();
        }, 3000);
    }

    launchGame() {
        console.log('🎮 Lancement synchronisé du jeu !');
        
        // Activer le timer s'il est configuré
        if (window.timerMode && window.InitialvoterTimer > 0) {
            window.voteOpen = true;
            document.body.classList.add("showTimer");
            startTimer(window.InitialvoterTimer, true);
            console.log(`⏱️ Timer démarré : ${window.InitialvoterTimer}s`);
        } else {
            // Mode sans timer
            window.voteOpen = true;
            console.log('🗳️ Vote continu activé');
        }

        // Synchroniser le démarrage via Socket.IO
        if (window.multiplayerSocket && window.multiplayerGameId) {
            window.multiplayerSocket.emit('gameStarted', {
                gameId: window.multiplayerGameId,
                timestamp: Date.now()
            });
        }

        // Masquer le panneau ready après 5 secondes
        setTimeout(() => {
            const panel = document.getElementById('readyStatusContainer');
            if (panel) {
                panel.style.transition = 'opacity 1s';
                panel.style.opacity = '0';
                setTimeout(() => panel.remove(), 1000);
            }
        }, 5000);
    }

    // Méthode pour reset le système (pour les parties suivantes)
    reset() {
        this.readyStates.streamer1 = false;
        this.readyStates.streamer2 = false;
        this.gameStarted = false;
        
        // Recréer l'UI si nécessaire
        const existingPanel = document.getElementById('readyStatusContainer');
        if (existingPanel) {
            existingPanel.remove();
        }
        this.createReadyUI();
        
        console.log('🔄 Système Ready réinitialisé');
    }
}