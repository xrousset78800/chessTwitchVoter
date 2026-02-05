/**
 * PHANTOM TWITCHESS - Twitch Manager
 * Gestion de la connexion Twitch via TMI.js
 * 
 * VERSION CORRIGÉE - Avec prompt pour le channel
 */

class TwitchManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.channel = null;
        this.linkedChannels = [];
        
        // Settings
        this.settings = {
            followersOnly: false,
            subsOnly: false
        };

        // Callbacks
        this.onConnectionChange = null;
        this.onMessage = null;
        this.onVote = null;
    }

    /**
     * Connexion à un channel Twitch
     * Si aucun channel n'est fourni, affiche un prompt ou une modal
     */
    async connect(channel = null, options = {}) {
        // Si pas de channel fourni, essayer de le récupérer
        if (!channel) {
            // 1. Essayer le localStorage
            channel = window.storage?.get('twitch_channel');
            
            // 2. Si toujours pas de channel, afficher le prompt
            if (!channel) {
                channel = await this.showChannelPrompt();
            }
            
            // 3. Si l'utilisateur a annulé
            if (!channel) {
                throw new Error('Connexion annulée');
            }
        }

        // Nettoyer le nom du channel
        channel = channel.toLowerCase().replace('#', '').replace('@', '').trim();
        
        if (!channel) {
            throw new Error('Nom de channel invalide');
        }

        // Si déjà connecté au même channel, ne rien faire
        if (this.isConnected && this.channel === channel) {
            this.log(`Déjà connecté à ${channel}`);
            return true;
        }

        // Si connecté à un autre channel, déconnecter d'abord
        if (this.isConnected) {
            await this.disconnect();
        }

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
            this.client.on('connected', (addr, port) => {
                this.log(`✅ Connecté à #${channel}`);
                this.isConnected = true;
                this.channel = channel;
                
                // Sauvegarder pour reconnexion future
                window.storage?.set('twitch_channel', channel);
                
                if (this.onConnectionChange) this.onConnectionChange(true);
                window.dispatchEvent(new CustomEvent('twitchConnected', { detail: { channel } }));
            });

            this.client.on('disconnected', (reason) => {
                this.log(`🔌 Déconnecté: ${reason}`);
                this.handleDisconnect();
            });

            this.client.on('message', (channel, tags, message, self) => {
                if (self) return; // Ignorer nos propres messages
                this.handleMessage(channel, tags, message);
            });

            // Connexion
            await this.client.connect();
            
            return true;
        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * 🆕 Affiche un prompt/modal pour demander le channel
     */
    showChannelPrompt() {
        return new Promise((resolve) => {
            // Vérifier si une modal existe déjà
            let modal = document.getElementById('twitch-channel-modal');
            
            if (!modal) {
                // Créer la modal
                modal = document.createElement('div');
                modal.id = 'twitch-channel-modal';
                modal.className = 'modal-overlay is-active';
                modal.innerHTML = `
                    <div class="modal" style="max-width: 400px;">
                        <div class="modal__header">
                            <h2 class="modal__title">
                                <i class="fab fa-twitch" style="color: #9146FF;"></i>
                                Connexion Twitch
                            </h2>
                            <button class="modal__close" id="twitch-modal-close">&times;</button>
                        </div>
                        <div class="modal__body">
                            <div class="form-group">
                                <label class="form-label">Nom du channel Twitch</label>
                                <input type="text" 
                                       class="input" 
                                       id="twitch-channel-input" 
                                       placeholder="votrechannel"
                                       autocomplete="off"
                                       autofocus>
                                <small style="color: var(--text-muted); margin-top: 4px; display: block;">
                                    Entrez le nom du channel sans le # ou @
                                </small>
                            </div>
                        </div>
                        <div class="modal__footer">
                            <button class="btn" id="twitch-modal-cancel">Annuler</button>
                            <button class="btn btn--primary" id="twitch-modal-connect">
                                <i class="fab fa-twitch"></i> Connecter
                            </button>
                        </div>
                    </div>
                `;
                
                // Ajouter les styles si nécessaire
                if (!document.getElementById('twitch-modal-styles')) {
                    const style = document.createElement('style');
                    style.id = 'twitch-modal-styles';
                    style.textContent = `
                        #twitch-channel-modal .modal {
                            animation: modalSlideIn 0.3s ease;
                        }
                        @keyframes modalSlideIn {
                            from { transform: translateY(-20px); opacity: 0; }
                            to { transform: translateY(0); opacity: 1; }
                        }
                        #twitch-channel-input {
                            font-size: 1.1rem;
                            padding: 12px 16px;
                        }
                    `;
                    document.head.appendChild(style);
                }
                
                document.body.appendChild(modal);
            } else {
                modal.classList.add('is-active');
            }

            const input = document.getElementById('twitch-channel-input');
            const connectBtn = document.getElementById('twitch-modal-connect');
            const cancelBtn = document.getElementById('twitch-modal-cancel');
            const closeBtn = document.getElementById('twitch-modal-close');

            // Focus sur l'input
            setTimeout(() => input?.focus(), 100);

            const cleanup = () => {
                modal.classList.remove('is-active');
                // Supprimer les listeners pour éviter les doublons
                connectBtn?.removeEventListener('click', handleConnect);
                cancelBtn?.removeEventListener('click', handleCancel);
                closeBtn?.removeEventListener('click', handleCancel);
                input?.removeEventListener('keydown', handleKeydown);
            };

            const handleConnect = () => {
                const channel = input?.value?.trim();
                cleanup();
                resolve(channel || null);
            };

            const handleCancel = () => {
                cleanup();
                resolve(null);
            };

            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    handleConnect();
                } else if (e.key === 'Escape') {
                    handleCancel();
                }
            };

            connectBtn?.addEventListener('click', handleConnect);
            cancelBtn?.addEventListener('click', handleCancel);
            closeBtn?.addEventListener('click', handleCancel);
            input?.addEventListener('keydown', handleKeydown);

            // Fermer en cliquant sur l'overlay
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    handleCancel();
                }
            });
        });
    }

    /**
     * Ajouter un channel supplémentaire (pour Chat vs Chat)
     */
    async joinChannel(channel) {
        if (!this.client || !this.isConnected) {
            throw new Error('Non connecté');
        }

        channel = channel.toLowerCase().replace('#', '').trim();
        
        if (this.linkedChannels.includes(channel)) {
            return true; // Déjà connecté
        }

        try {
            await this.client.join(channel);
            this.linkedChannels.push(channel);
            this.log(`✅ Rejoint #${channel}`);
            return true;
        } catch (error) {
            this.log(`❌ Erreur join ${channel}: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Quitter un channel
     */
    async leaveChannel(channel) {
        if (!this.client || !this.isConnected) return;

        channel = channel.toLowerCase().replace('#', '').trim();

        try {
            await this.client.part(channel);
            this.linkedChannels = this.linkedChannels.filter(c => c !== channel);
            this.log(`👋 Quitté #${channel}`);
        } catch (error) {
            this.log(`Erreur leave ${channel}: ${error.message}`, 'error');
        }
    }

    /**
     * Déconnexion complète
     */
    async disconnect() {
        if (this.client) {
            try {
                await this.client.disconnect();
            } catch (e) {
                // Ignorer les erreurs de déconnexion
            }
        }
        this.handleDisconnect();
        
        // Effacer le channel sauvegardé
        window.storage?.remove('twitch_channel');
    }

    /**
     * Gestion interne de la déconnexion
     */
    handleDisconnect() {
        this.isConnected = false;
        this.channel = null;
        this.linkedChannels = [];
        
        if (this.onConnectionChange) this.onConnectionChange(false);
        window.dispatchEvent(new CustomEvent('twitchDisconnected'));
    }

    /**
     * Traitement des messages
     */
    handleMessage(channel, tags, message) {
        // Callback personnalisé
        if (this.onMessage) {
            this.onMessage(channel, tags, message);
        }

        // Extraire un vote potentiel
        const move = this.extractMove(message);
        if (move && this.onVote) {
            this.onVote(channel, tags, move);
        }

        // Event global
        window.dispatchEvent(new CustomEvent('twitchMessage', {
            detail: { channel, tags, message, move }
        }));
    }

    /**
     * Extraire un coup d'échecs d'un message
     */
    extractMove(message) {
        if (!message) return null;
        
        const clean = message.trim().toLowerCase();
        
        // Patterns de coups d'échecs
        const patterns = [
            // Notation algébrique standard
            /^([kqrbnp])?([a-h])?([1-8])?(x)?([a-h])([1-8])(=[qrbn])?(\+|#)?$/i,
            // Roque
            /^(o-o-o|o-o|0-0-0|0-0)$/i,
            // Format simple: e2e4, e2-e4
            /^([a-h])([1-8])-?([a-h])([1-8])(=[qrbn])?$/i
        ];

        for (const pattern of patterns) {
            if (pattern.test(clean)) {
                return clean;
            }
        }

        return null;
    }

    /**
     * Envoyer un message dans le chat
     */
    async say(message, channel = null) {
        if (!this.client || !this.isConnected) return false;
        
        try {
            await this.client.say(channel || this.channel, message);
            return true;
        } catch (error) {
            this.log(`Erreur envoi message: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Restaurer une connexion précédente (au chargement de la page)
     */
    async restore() {
        const savedChannel = window.storage?.get('twitch_channel');
        if (savedChannel) {
            try {
                await this.connect(savedChannel);
                return true;
            } catch (e) {
                this.log('Impossible de restaurer la connexion Twitch');
                return false;
            }
        }
        return false;
    }

    /**
     * Log avec préfixe
     */
    log(message, level = 'info') {
        const prefix = '[Twitch]';
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
     * Obtenir le statut de connexion
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            channel: this.channel,
            linkedChannels: this.linkedChannels
        };
    }
}

// Create global instance
window.twitch = new TwitchManager();

export default window.twitch;