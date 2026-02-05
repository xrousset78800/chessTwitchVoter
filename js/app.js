/**
 * PHANTOM TWITCHESS - Main Application
 * Router, State Management, Initialization
 */

// ============================================
// STATE - Inclut tous les paramètres de l'ancien formulaire
// ============================================
const AppState = {
    currentPage: 'landing',
    
    // Mode de jeu (anciennement gameMode radio)
    gameMode: 'yolo', // yolo, problems, oneVsAll, oneVsOne, chatVsChat
    
    // Chaîne Twitch principale (anciennement defaultChannel)
    defaultChannel: '',
    
    // Voting / Timer (anciennement timerMode, InitialvoterTimer, etc.)
    voting: {
        enabled: false,           // timerMode
        timerDuration: 25,        // InitialvoterTimer
        wheelDuration: 5,         // timerWheelAnimation
        pauseAfterWinLose: 15,    // pauseAfterWinLose
        singleVote: false,        // limitToOneVote
        majorityMode: false       // majorityMode
    },
    
    // Restrictions Twitch (anciennement followMode, subMode)
    restrictions: {
        followersOnly: false,     // followMode
        subsOnly: false           // subMode
    },
    
    // Options d'affichage
    display: {
        noBg: false               // noBg - pour OBS sans fond
    },
    
    // Mode-specific players (anciens champs du formulaire)
    players: {
        solo: '',                 // mod1vViewersPlayer
        player1: '',              // oneVsOneModeList0
        player2: '',              // oneVsOneModeList1
        chat1: '',                // streamerChatvStreamerChat0
        chat2: ''                 // streamerChatvStreamerChat1
    },
    
    // Problèmes / Puzzles
    problems: {
        selectedThemes: []        // selectedThemes
    },
    
    // Phantom Board settings
    phantom: {
        autoSync: true,           // phantomAutoSync
        speed: 3
    },
    
    // Configs sauvegardées
    savedConfigs: [],

    // Webcam
    webcam: {
        enabled: false,
        opacity: 0.3,
        stream: null
    }
};

// ============================================
// CONFIG MANAGER - Sauvegarde/Chargement
// ============================================
const ConfigManager = {
    STORAGE_KEY: 'phantom_twitchess_config',
    CONFIGS_KEY: 'phantom_twitchess_saved_configs',

    // Récupérer la config actuelle depuis AppState
    getCurrentConfig() {
        return {
            gameMode: AppState.gameMode,
            defaultChannel: AppState.defaultChannel,
            voting: { ...AppState.voting },
            restrictions: { ...AppState.restrictions },
            display: { ...AppState.display },
            players: { ...AppState.players },
            problems: { ...AppState.problems },
            phantom: { ...AppState.phantom }
        };
    },

    // Appliquer une config à AppState
    applyConfig(config) {
        if (config.gameMode) AppState.gameMode = config.gameMode;
        if (config.defaultChannel) AppState.defaultChannel = config.defaultChannel;
        if (config.voting) AppState.voting = { ...AppState.voting, ...config.voting };
        if (config.restrictions) AppState.restrictions = { ...AppState.restrictions, ...config.restrictions };
        if (config.display) AppState.display = { ...AppState.display, ...config.display };
        if (config.players) AppState.players = { ...AppState.players, ...config.players };
        if (config.problems) AppState.problems = { ...AppState.problems, ...config.problems };
        if (config.phantom) AppState.phantom = { ...AppState.phantom, ...config.phantom };
    },

    // Sauvegarder la config actuelle en localStorage
    saveCurrentConfig() {
        const config = this.getCurrentConfig();
        window.storage?.set(this.STORAGE_KEY, config);
    },

    // Charger la config depuis localStorage au démarrage
    loadSavedConfig() {
        const config = window.storage?.get(this.STORAGE_KEY);
        if (config) {
            this.applyConfig(config);
            console.log('📦 Config chargée depuis localStorage');
        }
    },

    // Sauvegarder une config nommée
    saveNamedConfig(name) {
        const config = {
            id: Date.now().toString(),
            name,
            createdAt: new Date().toISOString(),
            ...this.getCurrentConfig(),
            fen: window.chessManager?.fen()
        };

        AppState.savedConfigs.unshift(config);
        window.storage?.set(this.CONFIGS_KEY, AppState.savedConfigs);
        return config;
    },

    // Charger les configs nommées
    loadNamedConfigs() {
        AppState.savedConfigs = window.storage?.get(this.CONFIGS_KEY) || [];
    },

    // Supprimer une config nommée
    deleteNamedConfig(id) {
        AppState.savedConfigs = AppState.savedConfigs.filter(c => c.id !== id);
        window.storage?.set(this.CONFIGS_KEY, AppState.savedConfigs);
    },

    // Convertir les anciens params GET en config (migration)
    parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const config = {};

        // Mode de jeu
        if (params.has('gameMode')) {
            const mode = params.get('gameMode');
            const modeMap = {
                'normal': 'yolo',
                'probMode': 'problems',
                '1vViewers': 'oneVsAll',
                'mod1vViewers': 'oneVsAll',
                '1v1': 'oneVsOne',
                'mod1v1': 'oneVsOne',
                'modStreamerChatvStreamerChat': 'chatVsChat'
            };
            config.gameMode = modeMap[mode] || mode;
        }
        if (params.get('probMode') === 'on') {
            config.gameMode = 'problems';
        }

        // Channel
        if (params.has('defaultChannel')) {
            config.defaultChannel = params.get('defaultChannel');
        }

        // Voting / Timer
        config.voting = {};
        if (params.get('timerMode') === 'on') config.voting.enabled = true;
        if (params.has('InitialvoterTimer')) config.voting.timerDuration = parseInt(params.get('InitialvoterTimer'));
        if (params.has('timerWheelAnimation')) config.voting.wheelDuration = parseInt(params.get('timerWheelAnimation'));
        if (params.has('pauseAfterWinLose')) config.voting.pauseAfterWinLose = parseInt(params.get('pauseAfterWinLose'));
        if (params.get('limitToOneVote') === 'on') config.voting.singleVote = true;
        if (params.get('majorityMode') === 'on') config.voting.majorityMode = true;

        // Restrictions
        config.restrictions = {};
        if (params.get('followMode') === 'on') config.restrictions.followersOnly = true;
        if (params.get('subMode') === 'on') config.restrictions.subsOnly = true;

        // Display
        config.display = {};
        if (params.get('noBg') === 'on') config.display.noBg = true;

        // Players
        config.players = {};
        if (params.has('mod1vViewersPlayer')) config.players.solo = params.get('mod1vViewersPlayer');
        if (params.has('oneVsOneModeList0')) config.players.player1 = params.get('oneVsOneModeList0');
        if (params.has('oneVsOneModeList1')) config.players.player2 = params.get('oneVsOneModeList1');
        if (params.has('streamerChatvStreamerChat0')) config.players.chat1 = params.get('streamerChatvStreamerChat0');
        if (params.has('streamerChatvStreamerChat1')) config.players.chat2 = params.get('streamerChatvStreamerChat1');

        // Thèmes
        if (params.has('selectedThemes')) {
            try {
                const themes = decodeURIComponent(params.get('selectedThemes')).split(',').filter(t => t.trim());
                config.problems = { selectedThemes: themes };
            } catch (e) {
                console.warn('Erreur parsing thèmes:', e);
            }
        }

        // Phantom
        config.phantom = {};
        if (params.has('phantomAutoSync')) {
            config.phantom.autoSync = params.get('phantomAutoSync') === 'on';
        }

        return config;
    }
};

// ============================================
// ROUTER
// ============================================
const Router = {
    routes: {
        '/': 'landing',
        '/sandbox': 'sandbox',
        '/browse': 'browse'
    },

    init() {
        window.addEventListener('hashchange', () => this.handleRoute());
        
        document.querySelectorAll('[data-navigate]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.hash = el.dataset.navigate;
            });
        });

        this.handleRoute();
    },

    handleRoute() {
        const hash = window.location.hash.slice(1) || '/';
        const [path, queryString] = hash.split('?');
        const pageName = this.routes[path] || 'landing';
        
        // Parse query params si présents
        if (queryString) {
            const params = new URLSearchParams(queryString);
            if (params.has('mode')) {
                AppState.gameMode = params.get('mode');
            }
        }

        this.showPage(pageName);
    },

    showPage(pageName) {
        // IMPORTANT: Cacher TOUTES les pages d'abord
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('is-active');
        });
        
        // Montrer uniquement la page cible
        const target = document.getElementById(`page-${pageName}`);
        if (target) {
            target.classList.add('is-active');
            AppState.currentPage = pageName;
        }

        // Mettre à jour la nav
        document.querySelectorAll('.nav__link').forEach(link => {
            const linkPath = link.dataset.navigate;
            link.classList.toggle('is-active', linkPath === '/' + pageName || 
                (linkPath === '/' && pageName === 'landing'));
        });

        // Init spécifique à la page
        if (pageName === 'sandbox') {
            SandboxPage.init();
        } else if (pageName === 'browse') {
            BrowsePage.init();
        }
    }
};

// ============================================
// SANDBOX PAGE
// ============================================
const SandboxPage = {
    wheel: null,
    timer: null,
    timerInterval: null,

    init() {
        // Init chess if not done
        if (!window.chessManager?.initialized) {
            window.chessManager?.init('myBoard');
        } else {
            window.chessManager.board?.resize();
        }

        // Init voting wheel
        this.wheel = new window.VotingWheel('wheel-container');
        
        // Setup mode selector
        this.setupModeSelector();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Sync UI with AppState
        this.syncUIFromState();
        
        // Update conditional UI
        this.updateConditionalUI();
        
        // Load saved configs
        this.loadConfigs();
    },

    // Synchroniser l'UI avec l'AppState (après chargement config)
    syncUIFromState() {
        // Mode de jeu
        document.querySelectorAll('.mode-option').forEach(o => {
            o.classList.toggle('is-active', o.dataset.mode === AppState.gameMode);
        });
        this.updateModeOptions();

        // Voting toggles
        const votingToggle = document.getElementById('toggle-voting');
        if (votingToggle) {
            votingToggle.classList.toggle('is-active', AppState.voting.enabled);
        }

        // Timer values
        const timerDuration = document.getElementById('timer-duration');
        if (timerDuration) timerDuration.value = AppState.voting.timerDuration;

        const wheelDuration = document.getElementById('wheel-duration');
        if (wheelDuration) wheelDuration.value = AppState.voting.wheelDuration;

        // Single vote
        const singleVoteToggle = document.getElementById('toggle-single-vote');
        if (singleVoteToggle) {
            singleVoteToggle.classList.toggle('is-active', AppState.voting.singleVote);
        }

        // Majority mode
        const majorityToggle = document.getElementById('toggle-majority');
        if (majorityToggle) {
            majorityToggle.classList.toggle('is-active', AppState.voting.majorityMode);
        }

        // Restrictions
        const followersToggle = document.getElementById('toggle-followers');
        if (followersToggle) {
            followersToggle.classList.toggle('is-active', AppState.restrictions.followersOnly);
        }

        const subsToggle = document.getElementById('toggle-subs');
        if (subsToggle) {
            subsToggle.classList.toggle('is-active', AppState.restrictions.subsOnly);
        }

        // Players
        const playerSolo = document.getElementById('player-solo');
        if (playerSolo) playerSolo.value = AppState.players.solo || '';

        const player1 = document.getElementById('player-1');
        if (player1) player1.value = AppState.players.player1 || '';

        const player2 = document.getElementById('player-2');
        if (player2) player2.value = AppState.players.player2 || '';

        const chat1 = document.getElementById('chat-1');
        if (chat1) chat1.value = AppState.players.chat1 || '';

        const chat2 = document.getElementById('chat-2');
        if (chat2) chat2.value = AppState.players.chat2 || '';

        // Phantom settings
        const autoSyncToggle = document.getElementById('toggle-auto-sync');
        if (autoSyncToggle) {
            autoSyncToggle.classList.toggle('is-active', AppState.phantom.autoSync);
        }

        // Update voting panel visibility
        this.updateVotingUI();
    },

    // Synchroniser AppState depuis l'UI (avant sauvegarde)
    syncStateFromUI() {
        // Timer values
        const timerDuration = document.getElementById('timer-duration');
        if (timerDuration) AppState.voting.timerDuration = parseInt(timerDuration.value) || 25;

        const wheelDuration = document.getElementById('wheel-duration');
        if (wheelDuration) AppState.voting.wheelDuration = parseInt(wheelDuration.value) || 5;

        // Players
        const playerSolo = document.getElementById('player-solo');
        if (playerSolo) AppState.players.solo = playerSolo.value;

        const player1 = document.getElementById('player-1');
        if (player1) AppState.players.player1 = player1.value;

        const player2 = document.getElementById('player-2');
        if (player2) AppState.players.player2 = player2.value;

        const chat1 = document.getElementById('chat-1');
        if (chat1) AppState.players.chat1 = chat1.value;

        const chat2 = document.getElementById('chat-2');
        if (chat2) AppState.players.chat2 = chat2.value;
    },

    setupModeSelector() {
        document.querySelectorAll('.mode-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('is-active'));
                option.classList.add('is-active');
                
                AppState.gameMode = option.dataset.mode;
                this.updateModeOptions();
                
                // Sauvegarder automatiquement
                ConfigManager.saveCurrentConfig();
            });
        });

        // Set initial active mode
        const currentModeEl = document.querySelector(`.mode-option[data-mode="${AppState.gameMode}"]`);
        if (currentModeEl) {
            document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('is-active'));
            currentModeEl.classList.add('is-active');
        }
        
        this.updateModeOptions();
    },

    updateModeOptions() {
        // Hide all mode-specific options
        document.querySelectorAll('.mode-options').forEach(el => {
            el.classList.remove('is-visible');
        });
        
        // Show current mode options
        const modeOptions = document.getElementById(`options-${AppState.gameMode}`);
        if (modeOptions) {
            modeOptions.classList.add('is-visible');
        }
    },

    setupEventListeners() {
        // Board controls
        document.getElementById('btn-reset')?.addEventListener('click', () => {
            window.chessManager?.reset();
            window.toast?.success(window.i18n?.t('toast.boardReset') || 'Board reset');
        });

        document.getElementById('btn-undo')?.addEventListener('click', () => {
            const move = window.chessManager?.undo();
            if (move) {
                window.toast?.success(window.i18n?.t('toast.moveUndone', { move: move.san }) || `Undone: ${move.san}`);
            } else {
                window.toast?.warning(window.i18n?.t('toast.noMoveToUndo') || 'No move to undo');
            }
        });

        document.getElementById('btn-flip')?.addEventListener('click', () => {
            window.chessManager?.flip();
        });

        document.getElementById('btn-sync')?.addEventListener('click', () => {
            if (window.phantom?.isConnected) {
                window.phantom.syncPosition(window.chessManager?.fen());
                window.toast?.info(window.i18n?.t('toast.syncSent') || 'Sync sent');
            }
        });

        document.getElementById('btn-game-end')?.addEventListener('click', async () => {
            if (window.phantom?.isConnected) {
                await window.phantom.sendGameEnd();
                window.toast?.success(window.i18n?.t('toast.gameEndSent') || 'Game End sent');
            }
        });

        // Voting toggle
        document.getElementById('toggle-voting')?.addEventListener('click', function() {
            this.classList.toggle('is-active');
            AppState.voting.enabled = this.classList.contains('is-active');
            SandboxPage.updateVotingUI();
            ConfigManager.saveCurrentConfig();
        });

        // Single vote toggle
        document.getElementById('toggle-single-vote')?.addEventListener('click', function() {
            this.classList.toggle('is-active');
            AppState.voting.singleVote = this.classList.contains('is-active');
            ConfigManager.saveCurrentConfig();
        });

        // Majority mode toggle
        document.getElementById('toggle-majority')?.addEventListener('click', function() {
            this.classList.toggle('is-active');
            AppState.voting.majorityMode = this.classList.contains('is-active');
            ConfigManager.saveCurrentConfig();
        });

        // Followers toggle
        document.getElementById('toggle-followers')?.addEventListener('click', function() {
            this.classList.toggle('is-active');
            AppState.restrictions.followersOnly = this.classList.contains('is-active');
            ConfigManager.saveCurrentConfig();
        });

        // Subs toggle
        document.getElementById('toggle-subs')?.addEventListener('click', function() {
            this.classList.toggle('is-active');
            AppState.restrictions.subsOnly = this.classList.contains('is-active');
            ConfigManager.saveCurrentConfig();
        });

        // Auto-sync toggle
        document.getElementById('toggle-auto-sync')?.addEventListener('click', function() {
            this.classList.toggle('is-active');
            AppState.phantom.autoSync = this.classList.contains('is-active');
            ConfigManager.saveCurrentConfig();
        });

        // Timer/wheel duration inputs - save on change
        document.getElementById('timer-duration')?.addEventListener('change', function() {
            AppState.voting.timerDuration = parseInt(this.value) || 25;
            ConfigManager.saveCurrentConfig();
        });

        document.getElementById('wheel-duration')?.addEventListener('change', function() {
            AppState.voting.wheelDuration = parseInt(this.value) || 5;
            ConfigManager.saveCurrentConfig();
        });

        // Player inputs - save on blur
        ['player-solo', 'player-1', 'player-2', 'chat-1', 'chat-2'].forEach(id => {
            document.getElementById(id)?.addEventListener('blur', () => {
                this.syncStateFromUI();
                ConfigManager.saveCurrentConfig();
            });
        });

        // Webcam controls
        document.getElementById('toggle-webcam')?.addEventListener('click', function() {
            this.classList.toggle('is-active');
            AppState.webcam.enabled = this.classList.contains('is-active');
            SandboxPage.updateWebcam();
        });

        document.getElementById('webcam-opacity')?.addEventListener('input', function() {
            AppState.webcam.opacity = this.value / 100;
            document.getElementById('webcam-opacity-value').textContent = this.value + '%';
            const overlay = document.querySelector('.webcam-overlay');
            if (overlay) {
                overlay.style.setProperty('--webcam-opacity', AppState.webcam.opacity);
            }
        });

        // Phantom speed
        document.getElementById('phantom-speed')?.addEventListener('input', async function() {
            const speed = parseInt(this.value);
            document.getElementById('phantom-speed-value').textContent = speed;
            AppState.phantom.speed = speed;
            if (window.phantom?.isConnected) {
                await window.phantom.setSpeed(speed);
            }
        });

        // Save config
        document.getElementById('btn-save-config')?.addEventListener('click', () => {
            this.showSaveModal();
        });

        // APPLY CONFIG - Le bouton principal qui applique la config et reset l'échiquier
        document.getElementById('btn-apply-config')?.addEventListener('click', () => {
            this.applyConfig();
        });
    },

    /**
     * Applique la configuration actuelle et reset l'échiquier
     * C'est l'équivalent de l'ancien "submit" du formulaire GET
     */
    applyConfig() {
        console.log('🎮 Application de la configuration...');
        
        // 1. Synchroniser l'état depuis l'UI
        this.syncStateFromUI();
        
        // 2. Sauvegarder dans localStorage
        ConfigManager.saveCurrentConfig();
        
        // 3. Reset l'échiquier
        if (window.chessManager) {
            window.chessManager.reset();
            console.log('♟️ Échiquier réinitialisé');
        }
        
        // 4. Appliquer les options spécifiques au mode
        this.applyModeSpecificSettings();
        
        // 5. Sync Phantom si connecté et auto-sync activé
        if (window.phantom?.isConnected && AppState.phantom.autoSync) {
            window.phantom.syncPosition(window.chessManager?.fen());
            console.log('📡 Phantom synchronisé');
        }
        
        // 6. Mettre à jour l'UI conditionnelle
        this.updateConditionalUI();
        this.updateVotingUI();
        
        // 7. Notification
        window.toast?.success(window.i18n?.t('toast.configApplied') || '✅ Configuration appliquée !');
        
        console.log('✅ Configuration appliquée:', {
            mode: AppState.gameMode,
            voting: AppState.voting,
            players: AppState.players
        });
    },

    /**
     * Applique les paramètres spécifiques au mode de jeu
     */
    applyModeSpecificSettings() {
        const mode = AppState.gameMode;
        
        switch (mode) {
            case 'yolo':
                // Mode libre - pas de restrictions
                console.log('🎲 Mode YOLO activé');
                break;
                
            case 'problems':
                // Mode problèmes - charger un puzzle
                console.log('🧩 Mode Problèmes activé');
                // TODO: Charger un puzzle aléatoire selon les thèmes sélectionnés
                break;
                
            case 'oneVsAll':
                // 1 vs All - le joueur solo joue automatiquement
                console.log(`👤 Mode 1vsAll activé - Joueur: ${AppState.players.solo}`);
                break;
                
            case 'oneVsOne':
                // 1v1 - deux joueurs s'affrontent
                console.log(`⚔️ Mode 1v1 activé - ${AppState.players.player1} vs ${AppState.players.player2}`);
                break;
                
            case 'chatVsChat':
                // Chat vs Chat
                console.log(`🎭 Mode Chat vs Chat activé - ${AppState.players.chat1} vs ${AppState.players.chat2}`);
                break;
        }
        
        // Appliquer noBg si activé (pour OBS)
        if (AppState.display.noBg) {
            document.body.classList.add('no-bg');
        } else {
            document.body.classList.remove('no-bg');
        }
    },

    updateConditionalUI() {
        const twitchConnected = window.twitch?.isConnected;
        const phantomConnected = window.phantom?.isConnected;

        // Twitch-only sections
        document.querySelectorAll('.twitch-only').forEach(el => {
            el.classList.toggle('is-visible', twitchConnected);
        });

        // Phantom-only sections
        document.querySelectorAll('.phantom-only').forEach(el => {
            el.classList.toggle('is-visible', phantomConnected);
        });

        // Phantom buttons
        document.getElementById('btn-sync')?.toggleAttribute('disabled', !phantomConnected);
        document.getElementById('btn-game-end')?.toggleAttribute('disabled', !phantomConnected);

        // Update phantom battery
        if (phantomConnected && window.phantom.battery) {
            document.getElementById('phantom-battery').textContent = window.phantom.battery + '%';
        }
    },

    updateVotingUI() {
        const votingPanel = document.getElementById('voting-panel');
        if (votingPanel) {
            votingPanel.classList.toggle('is-visible', AppState.voting.enabled);
        }
    },

    async updateWebcam() {
        const overlay = document.querySelector('.webcam-overlay');
        const video = document.getElementById('webcam-video');
        
        if (AppState.webcam.enabled && window.phantom?.isConnected) {
            try {
                if (!AppState.webcam.stream) {
                    AppState.webcam.stream = await navigator.mediaDevices.getUserMedia({ video: true });
                }
                video.srcObject = AppState.webcam.stream;
                overlay?.classList.add('is-visible');
            } catch (e) {
                console.error('Webcam error:', e);
                window.toast?.error('Webcam access denied');
            }
        } else {
            if (AppState.webcam.stream) {
                AppState.webcam.stream.getTracks().forEach(t => t.stop());
                AppState.webcam.stream = null;
            }
            overlay?.classList.remove('is-visible');
        }
    },

    showSaveModal() {
        const modal = document.getElementById('modal-save');
        modal?.classList.add('is-active');
        document.getElementById('config-name')?.focus();
    },

    saveConfig(name) {
        // Sync UI to state before saving
        this.syncStateFromUI();
        
        const config = ConfigManager.saveNamedConfig(name);
        this.renderConfigs();
        
        window.toast?.success(window.i18n?.t('configs.saved', { name }) || `Saved: ${name}`);
    },

    loadConfigs() {
        ConfigManager.loadNamedConfigs();
        this.renderConfigs();
    },

    renderConfigs() {
        const container = document.getElementById('configs-list');
        if (!container) return;

        if (AppState.savedConfigs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p data-i18n="configs.empty">${window.i18n?.t('configs.empty') || 'No saved configurations'}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = AppState.savedConfigs.map(config => `
            <div class="config-card" data-id="${config.id}">
                <div class="config-card__header">
                    <span class="config-card__name">${config.name}</span>
                    <button class="btn btn--icon btn--sm" data-delete="${config.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <span class="badge badge--purple">${config.gameMode}</span>
            </div>
        `).join('');

        // Event listeners
        container.querySelectorAll('.config-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('[data-delete]')) {
                    this.loadConfig(card.dataset.id);
                }
            });
        });

        container.querySelectorAll('[data-delete]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteConfig(btn.dataset.delete);
            });
        });
    },

    loadConfig(id) {
        const config = AppState.savedConfigs.find(c => c.id === id);
        if (!config) return;

        // Appliquer la config à AppState
        ConfigManager.applyConfig(config);

        // Charger le FEN si présent
        if (config.fen) {
            window.chessManager?.loadFen(config.fen);
        }

        // Re-synchroniser l'UI
        this.syncUIFromState();
        this.updateModeOptions();
        
        window.toast?.success(window.i18n?.t('configs.loaded', { name: config.name }) || `Loaded: ${config.name}`);
    },

    deleteConfig(id) {
        ConfigManager.deleteNamedConfig(id);
        this.renderConfigs();
        window.toast?.info(window.i18n?.t('configs.deleted') || 'Config deleted');
    }
};

// ============================================
// BROWSE PAGE
// ============================================
const BrowsePage = {
    init() {
        this.renderGames();
    },

    renderGames() {
        const container = document.getElementById('games-list');
        if (!container) return;

        // Mock data pour l'instant
        const games = [
            { id: '1', mode: 'Chat vs Chat', players: ['TeamBlancs', 'TeamNoirs'], spectators: 234, moves: 42, live: true },
            { id: '2', mode: 'Chat vs Chat', players: ['StreamerA', 'StreamerB'], spectators: 89, moves: 18, live: true }
        ];

        if (games.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state__icon">📺</div>
                    <p class="empty-state__title" data-i18n="browse.noGames">No ongoing games</p>
                    <p class="empty-state__desc" data-i18n="browse.beFirst">Be the first to start a Twitch Battle!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = games.map(game => `
            <div class="game-card" data-id="${game.id}">
                <div class="game-card__header">
                    <span class="game-card__mode">${game.mode}</span>
                    ${game.live ? '<span class="badge badge--live">LIVE</span>' : ''}
                </div>
                <div class="game-card__players">
                    <span>${game.players[0]}</span>
                    <span class="vs">vs</span>
                    <span>${game.players[1]}</span>
                </div>
                <div class="game-card__stats">
                    <span><i class="fas fa-eye"></i> ${game.spectators}</span>
                    <span><i class="fas fa-chess"></i> ${game.moves} moves</span>
                </div>
                <button class="btn btn--sm btn--primary">Watch</button>
            </div>
        `).join('');
    }
};

// ============================================
// CONNECTION HANDLERS
// ============================================
function setupConnectionHandlers() {
    document.querySelectorAll('[data-action="connect-twitch"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await window.twitch?.connect();
                updateConnectionUI();
                window.toast?.success(window.i18n?.t('toast.twitchConnected') || 'Twitch connected!');
            } catch (e) {
                window.toast?.error('Twitch connection failed');
            }
        });
    });

    document.querySelectorAll('[data-action="connect-phantom"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await window.phantom?.connect();
                updateConnectionUI();
                window.toast?.success(window.i18n?.t('toast.phantomConnected') || 'Phantom connected!');
            } catch (e) {
                window.toast?.error('Phantom connection failed');
            }
        });
    });
}

function updateConnectionUI() {
    const twitchConnected = window.twitch?.isConnected;
    const phantomConnected = window.phantom?.isConnected;

    // Twitch status
    document.querySelectorAll('.status-dot--twitch').forEach(dot => {
        dot.classList.toggle('is-connected', twitchConnected);
    });
    document.querySelectorAll('[data-twitch-status]').forEach(el => {
        el.textContent = twitchConnected ? window.twitch.channel : (window.i18n?.t('connections.notConnected') || 'Not connected');
    });
    document.querySelectorAll('.connect-btn--twitch').forEach(btn => {
        btn.classList.toggle('is-connected', twitchConnected);
    });

    // Phantom status
    document.querySelectorAll('.status-dot--phantom').forEach(dot => {
        dot.classList.toggle('is-connected', phantomConnected);
    });
    document.querySelectorAll('[data-phantom-status]').forEach(el => {
        el.textContent = phantomConnected ? window.phantom.device?.name : (window.i18n?.t('connections.notConnected') || 'Not connected');
    });
    document.querySelectorAll('.connect-btn--phantom').forEach(btn => {
        btn.classList.toggle('is-connected', phantomConnected);
    });

    // Update sandbox if on that page
    if (AppState.currentPage === 'sandbox') {
        SandboxPage.updateConditionalUI();
    }
}

// ============================================
// LANGUAGE SELECTOR
// ============================================
function setupLanguageSelector() {
    document.querySelectorAll('[data-lang]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const lang = btn.dataset.lang;
            await window.i18n?.setLanguage(lang);
        });
    });
}

// ============================================
// MODAL HANDLERS
// ============================================
function setupModals() {
    // Close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('is-active');
            }
        });
    });

    // Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal-overlay')?.classList.remove('is-active');
        });
    });

    // Save config modal
    document.getElementById('btn-confirm-save')?.addEventListener('click', () => {
        const name = document.getElementById('config-name')?.value?.trim();
        if (name) {
            SandboxPage.saveConfig(name);
            document.getElementById('modal-save')?.classList.remove('is-active');
            document.getElementById('config-name').value = '';
        } else {
            window.toast?.error(window.i18n?.t('toast.enterName') || 'Please enter a name');
        }
    });
}

// ============================================
// INITIALIZATION
// ============================================
async function initApp() {
    console.log('🚀 Phantom Twitchess - Initializing...');

    // Charger la config sauvegardée
    ConfigManager.loadSavedConfig();
    
    // Migration: si on a des params GET dans l'URL, les appliquer
    if (window.location.search) {
        const urlConfig = ConfigManager.parseUrlParams();
        ConfigManager.applyConfig(urlConfig);
        ConfigManager.saveCurrentConfig();
        console.log('📦 Config migrée depuis URL params');
    }

    // Load translations
    await window.i18n?.init();

    // Setup handlers
    setupConnectionHandlers();
    setupLanguageSelector();
    setupModals();

    // Init router
    Router.init();

    // Try to restore connections
    await window.twitch?.restore();
    
    // Check for phantom reconnection
    const savedPhantom = window.storage?.get('phantom_device');
    if (savedPhantom) {
        const reconnect = confirm(window.i18n?.t('connections.reconnectPrompt', { device: savedPhantom }) || `Reconnecter ${savedPhantom}?`);
        if (reconnect) {
            try {
                await window.phantom?.connect();
            } catch (e) {
                console.log('Phantom reconnect failed');
            }
        }
    }

    updateConnectionUI();

    console.log('✅ Phantom Twitchess ready!');
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);

// Export for modules
export { AppState, Router, SandboxPage, BrowsePage, ConfigManager };