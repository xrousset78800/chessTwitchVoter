/**
 * PHANTOM TWITCHESS - Twitch Manager v2
 * Gestion améliorée de la connexion Twitch
 * 
 * AMÉLIORATIONS:
 * - Modal moderne avec preview
 * - Historique des channels récents
 * - Validation en temps réel
 * - Indicateurs visuels de statut
 * - Reconnexion intelligente
 * - Support multi-channel pour Chat vs Chat
 */

class TwitchManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.channel = null;
        this.linkedChannels = new Set();
        
        // Historique des channels (max 5)
        this.recentChannels = this.loadRecentChannels();
        
        // Settings
        this.settings = {
            followersOnly: false,
            subsOnly: false,
            autoReconnect: true
        };

        // État de connexion
        this.connectionState = 'disconnected'; // disconnected, connecting, connected, error
        this.lastError = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;

        // Callbacks
        this.onConnectionChange = null;
        this.onMessage = null;
        this.onVote = null;
        this.onStateChange = null;

        // UI Elements (injectés après DOM ready)
        this.statusDot = null;
        this.statusText = null;
        this.modal = null;

        // Bind methods
        this.handleMessage = this.handleMessage.bind(this);
    }

    // ========== STORAGE ==========

    loadRecentChannels() {
        try {
            const stored = localStorage.getItem('twitch_recent_channels');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }

    saveRecentChannels() {
        try {
            // Garder max 5 channels
            const channels = this.recentChannels.slice(0, 5);
            localStorage.setItem('twitch_recent_channels', JSON.stringify(channels));
        } catch {}
    }

    addToRecentChannels(channel) {
        // Retirer si déjà présent
        this.recentChannels = this.recentChannels.filter(c => c !== channel);
        // Ajouter en premier
        this.recentChannels.unshift(channel);
        // Limiter à 5
        this.recentChannels = this.recentChannels.slice(0, 5);
        this.saveRecentChannels();
    }

    // ========== CONNECTION STATE ==========

    setState(state, error = null) {
        this.connectionState = state;
        this.lastError = error;
        
        this.updateUI();
        
        if (this.onStateChange) {
            this.onStateChange({
                state,
                error,
                channel: this.channel,
                linkedChannels: Array.from(this.linkedChannels)
            });
        }

        // Dispatch custom event
        window.dispatchEvent(new CustomEvent('twitchStateChange', {
            detail: { state, error, channel: this.channel }
        }));
    }

    // ========== UI UPDATES ==========

    updateUI() {
        // Mettre à jour tous les indicateurs de statut
        document.querySelectorAll('.status-dot--twitch').forEach(dot => {
            dot.classList.remove('is-connecting', 'is-connected', 'is-error');
            
            switch (this.connectionState) {
                case 'connecting':
                    dot.classList.add('is-connecting');
                    break;
                case 'connected':
                    dot.classList.add('is-connected');
                    break;
                case 'error':
                    dot.classList.add('is-error');
                    break;
            }
        });

        // Mettre à jour les textes de statut
        document.querySelectorAll('[data-twitch-status]').forEach(el => {
            switch (this.connectionState) {
                case 'disconnected':
                    el.textContent = el.dataset.textDisconnected || 'Non connecté';
                    break;
                case 'connecting':
                    el.textContent = el.dataset.textConnecting || 'Connexion...';
                    break;
                case 'connected':
                    el.textContent = this.channel ? `#${this.channel}` : 'Connecté';
                    break;
                case 'error':
                    el.textContent = el.dataset.textError || 'Erreur';
                    break;
            }
        });

        // Mettre à jour les boutons de connexion
        document.querySelectorAll('[data-action="connect-twitch"]').forEach(btn => {
            if (this.connectionState === 'connected') {
                btn.innerHTML = `<i class="fab fa-twitch"></i> ${this.channel}`;
                btn.classList.add('is-connected');
            } else if (this.connectionState === 'connecting') {
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connexion...`;
                btn.disabled = true;
            } else {
                btn.innerHTML = `<i class="fab fa-twitch"></i> Connecter Twitch`;
                btn.classList.remove('is-connected');
                btn.disabled = false;
            }
        });
    }

    // ========== MODAL ==========

    /**
     * Affiche la modal de connexion Twitch
     */
    showConnectionModal() {
        return new Promise((resolve) => {
            // Supprimer modal existante
            document.getElementById('twitch-connect-modal')?.remove();

            const modal = document.createElement('div');
            modal.id = 'twitch-connect-modal';
            modal.className = 'modal-overlay is-active';
            modal.innerHTML = `
                <div class="modal twitch-modal">
                    <div class="modal__header twitch-modal__header">
                        <div class="twitch-modal__logo">
                            <i class="fab fa-twitch"></i>
                        </div>
                        <div>
                            <h2 class="modal__title">Connexion Twitch</h2>
                            <p class="modal__subtitle">Connectez-vous à un channel pour activer les votes</p>
                        </div>
                        <button class="modal__close" data-action="close">&times;</button>
                    </div>
                    
                    <div class="modal__body">
                        <!-- Input principal -->
                        <div class="twitch-input-group">
                            <span class="twitch-input-prefix">#</span>
                            <input type="text" 
                                   class="twitch-input" 
                                   id="twitch-channel-input"
                                   placeholder="nom_du_channel"
                                   autocomplete="off"
                                   spellcheck="false">
                            <div class="twitch-input-status" id="twitch-input-status"></div>
                        </div>
                        
                        <!-- Channels récents -->
                        ${this.recentChannels.length > 0 ? `
                            <div class="twitch-recent">
                                <span class="twitch-recent__label">Récents</span>
                                <div class="twitch-recent__list">
                                    ${this.recentChannels.map(ch => `
                                        <button class="twitch-recent__item" data-channel="${ch}">
                                            <i class="fab fa-twitch"></i>
                                            ${ch}
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                        
                        <!-- Preview du channel (caché par défaut) -->
                        <div class="twitch-preview" id="twitch-preview" style="display: none;">
                            <div class="twitch-preview__avatar" id="twitch-avatar"></div>
                            <div class="twitch-preview__info">
                                <span class="twitch-preview__name" id="twitch-name"></span>
                                <span class="twitch-preview__status" id="twitch-status"></span>
                            </div>
                        </div>
                        
                        <!-- Message d'erreur -->
                        <div class="twitch-error" id="twitch-error" style="display: none;"></div>
                    </div>
                    
                    <div class="modal__footer">
                        <button class="btn btn--ghost" data-action="close">Annuler</button>
                        <button class="btn btn--primary btn--twitch" id="twitch-connect-btn" disabled>
                            <i class="fab fa-twitch"></i>
                            Connecter
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Elements
            const input = modal.querySelector('#twitch-channel-input');
            const connectBtn = modal.querySelector('#twitch-connect-btn');
            const statusEl = modal.querySelector('#twitch-input-status');
            const errorEl = modal.querySelector('#twitch-error');

            let validationTimeout = null;
            let selectedChannel = null;

            // Validation en temps réel
            const validateChannel = (channel) => {
                clearTimeout(validationTimeout);
                
                if (!channel) {
                    statusEl.innerHTML = '';
                    connectBtn.disabled = true;
                    selectedChannel = null;
                    return;
                }

                // Nettoyer le nom
                channel = channel.toLowerCase().replace(/[^a-z0-9_]/g, '');
                
                if (channel.length < 2) {
                    statusEl.innerHTML = '<i class="fas fa-times-circle" style="color: var(--accent-red);"></i>';
                    connectBtn.disabled = true;
                    selectedChannel = null;
                    return;
                }

                // Validation basique OK
                statusEl.innerHTML = '<i class="fas fa-check-circle" style="color: var(--accent-green);"></i>';
                connectBtn.disabled = false;
                selectedChannel = channel;
            };

            // Event: Input change
            input.addEventListener('input', (e) => {
                validateChannel(e.target.value.trim());
            });

            // Event: Channels récents
            modal.querySelectorAll('.twitch-recent__item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const channel = btn.dataset.channel;
                    input.value = channel;
                    validateChannel(channel);
                    input.focus();
                });
            });

            // Event: Connexion
            const handleConnect = async () => {
                if (!selectedChannel) return;

                connectBtn.disabled = true;
                connectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion...';
                errorEl.style.display = 'none';

                try {
                    await this.connect(selectedChannel);
                    modal.remove();
                    resolve(selectedChannel);
                } catch (error) {
                    errorEl.textContent = error.message || 'Impossible de se connecter';
                    errorEl.style.display = 'block';
                    connectBtn.disabled = false;
                    connectBtn.innerHTML = '<i class="fab fa-twitch"></i> Réessayer';
                }
            };

            connectBtn.addEventListener('click', handleConnect);

            // Event: Enter
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && selectedChannel) {
                    handleConnect();
                }
            });

            // Event: Fermer
            const handleClose = () => {
                modal.remove();
                resolve(null);
            };

            modal.querySelectorAll('[data-action="close"]').forEach(el => {
                el.addEventListener('click', handleClose);
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) handleClose();
            });

            // Focus sur l'input
            setTimeout(() => input.focus(), 100);
        });
    }

    // ========== CONNECTION ==========

    /**
     * Connexion à un channel Twitch
     */
    async connect(channel = null, options = {}) {
        // Si pas de channel, afficher la modal
        if (!channel) {
            // Essayer le localStorage d'abord
            channel = localStorage.getItem('twitch_channel');
            
            if (!channel) {
                channel = await this.showConnectionModal();
            }
            
            if (!channel) {
                throw new Error('Connexion annulée');
            }
        }

        // Nettoyer le nom
        channel = channel.toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
        
        if (!channel || channel.length < 2) {
            throw new Error('Nom de channel invalide');
        }

        // Déjà connecté au même channel
        if (this.isConnected && this.channel === channel) {
            this.log(`Déjà connecté à #${channel}`);
            return true;
        }

        // Déconnecter si nécessaire
        if (this.isConnected) {
            await this.disconnect();
        }

        this.setState('connecting');

        try {
            this.log(`🔍 Connexion à #${channel}...`);

            // Créer le client TMI.js
            this.client = new tmi.Client({
                options: { debug: false },
                connection: {
                    secure: true,
                    reconnect: true
                },
                identity: options.identity || undefined,
                channels: [channel]
            });

            // Event handlers
            this.setupEventHandlers(channel);

            // Connexion
            await this.client.connect();
            
            // Sauvegarder
            localStorage.setItem('twitch_channel', channel);
            this.addToRecentChannels(channel);
            
            return true;

        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            this.setState('error', error.message);
            throw error;
        }
    }

    setupEventHandlers(channel) {
        this.client.on('connected', () => {
            this.log(`✅ Connecté à #${channel}`);
            this.isConnected = true;
            this.channel = channel;
            this.reconnectAttempts = 0;
            
            this.setState('connected');
            
            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }
            
            window.dispatchEvent(new CustomEvent('twitchConnected', { 
                detail: { channel } 
            }));
        });

        this.client.on('disconnected', (reason) => {
            this.log(`🔌 Déconnecté: ${reason}`);
            this.handleDisconnect(reason);
        });

        this.client.on('message', (channel, tags, message, self) => {
            if (self) return;
            this.handleMessage(channel, tags, message);
        });

        // Reconnexion automatique
        this.client.on('reconnect', () => {
            this.log('🔄 Reconnexion en cours...');
            this.setState('connecting');
        });
    }

    handleDisconnect(reason) {
        this.isConnected = false;
        
        if (this.onConnectionChange) {
            this.onConnectionChange(false);
        }

        // Tentative de reconnexion automatique
        if (this.settings.autoReconnect && 
            this.reconnectAttempts < this.maxReconnectAttempts &&
            this.channel) {
            
            this.reconnectAttempts++;
            this.setState('connecting');
            
            this.log(`🔄 Tentative de reconnexion ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
            
            setTimeout(() => {
                this.connect(this.channel).catch(err => {
                    this.log(`❌ Reconnexion échouée: ${err.message}`, 'error');
                });
            }, 2000 * this.reconnectAttempts);
            
        } else {
            this.setState('disconnected');
            this.channel = null;
        }
    }

    // ========== MULTI-CHANNEL (Chat vs Chat) ==========

    /**
     * Rejoindre un channel supplémentaire
     */
    async joinChannel(channel) {
        if (!this.client || !this.isConnected) {
            throw new Error('Non connecté au client principal');
        }

        channel = channel.toLowerCase().replace(/[^a-z0-9_]/g, '').trim();

        if (this.linkedChannels.has(channel)) {
            this.log(`Déjà connecté à #${channel}`);
            return true;
        }

        try {
            await this.client.join(channel);
            this.linkedChannels.add(channel);
            this.addToRecentChannels(channel);
            this.log(`✅ Rejoint #${channel}`);
            
            window.dispatchEvent(new CustomEvent('twitchChannelJoined', {
                detail: { channel }
            }));
            
            return true;
        } catch (error) {
            this.log(`❌ Erreur join #${channel}: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Quitter un channel secondaire
     */
    async leaveChannel(channel) {
        if (!this.client || !this.isConnected) return;

        channel = channel.toLowerCase().replace(/[^a-z0-9_]/g, '');

        if (!this.linkedChannels.has(channel)) return;

        try {
            await this.client.part(channel);
            this.linkedChannels.delete(channel);
            this.log(`👋 Quitté #${channel}`);
        } catch (error) {
            this.log(`Erreur leave #${channel}: ${error.message}`, 'error');
        }
    }

    // ========== MESSAGE HANDLING ==========

    handleMessage(channel, tags, message) {
        const channelName = channel.replace('#', '');
        
        // Callback générique
        if (this.onMessage) {
            this.onMessage({
                channel: channelName,
                username: tags.username,
                displayName: tags['display-name'] || tags.username,
                message: message,
                tags: tags,
                isMod: tags.mod || tags.badges?.moderator,
                isVip: tags.badges?.vip,
                isSub: tags.subscriber,
                isBroadcaster: tags.badges?.broadcaster
            });
        }

        // Détecter les votes (coups d'échecs)
        const vote = this.parseChessMove(message);
        if (vote && this.onVote) {
            // Vérifier les restrictions
            if (this.checkVoteEligibility(tags)) {
                this.onVote({
                    channel: channelName,
                    username: tags.username,
                    displayName: tags['display-name'] || tags.username,
                    move: vote,
                    tags: tags
                });
            }
        }
    }

    parseChessMove(message) {
        const clean = message.trim().toLowerCase();
        
        const patterns = [
            // SAN: e4, Nf3, Qxd5, O-O, etc.
            /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h])([1-8])(=[QRBN])?(\+|#)?$/i,
            // Roque
            /^(o-o-o|o-o|0-0-0|0-0)$/i,
            // UCI: e2e4, e2-e4
            /^([a-h])([1-8])-?([a-h])([1-8])(=[qrbn])?$/i
        ];

        for (const pattern of patterns) {
            if (pattern.test(clean)) {
                return clean.replace('-', ''); // Normaliser
            }
        }

        return null;
    }

    checkVoteEligibility(tags) {
        // Toujours autoriser: broadcaster, mods, VIPs
        if (tags.badges?.broadcaster || tags.mod || tags.badges?.vip) {
            return true;
        }

        // Followers only
        if (this.settings.followersOnly && !tags.badges?.broadcaster) {
            // Note: TMI.js ne fournit pas directement le statut follower
            // On fait confiance au mode followers de Twitch
        }

        // Subs only
        if (this.settings.subsOnly && !tags.subscriber) {
            return false;
        }

        return true;
    }

    // ========== UTILITY ==========

    /**
     * Déconnexion
     */
    async disconnect() {
        // Désactiver auto-reconnect pour éviter la reconnexion immédiate
        this.settings.autoReconnect = false;
        
        if (this.client) {
            try {
                await this.client.disconnect();
            } catch {}
            this.client = null;
        }
        
        this.isConnected = false;
        this.channel = null;
        this.linkedChannels.clear();
        this.setState('disconnected');
        
        // Supprimer du localStorage pour éviter restore() auto
        localStorage.removeItem('twitch_channel');
        
        // Réactiver auto-reconnect pour les futures connexions
        this.settings.autoReconnect = true;
        
        window.dispatchEvent(new Event('twitchDisconnected'));
    }

    /**
     * Envoyer un message
     */
    async say(message, channel = null) {
        if (!this.client || !this.isConnected) return false;
        
        try {
            await this.client.say(channel || this.channel, message);
            return true;
        } catch (error) {
            this.log(`Erreur envoi: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Restaurer la connexion au chargement
     */
    async restore() {
        const savedChannel = localStorage.getItem('twitch_channel');
        if (savedChannel) {
            try {
                await this.connect(savedChannel);
                return true;
            } catch {
                this.log('Impossible de restaurer la connexion');
                return false;
            }
        }
        return false;
    }

    /**
     * Logger
     */
    log(message, level = 'info') {
        const prefix = '🟣 [Twitch]';
        switch (level) {
            case 'error':
                console.error(prefix, message);
                break;
            case 'warn':
                console.warn(prefix, message);
                break;
            default:
                console.log(prefix, message);
        }
    }

    /**
     * Statut complet
     */
    getStatus() {
        return {
            state: this.connectionState,
            isConnected: this.isConnected,
            channel: this.channel,
            linkedChannels: Array.from(this.linkedChannels),
            recentChannels: this.recentChannels,
            error: this.lastError
        };
    }
}

// ========== INSTANCE GLOBALE ==========
window.twitch = new TwitchManager();

export default window.twitch;
