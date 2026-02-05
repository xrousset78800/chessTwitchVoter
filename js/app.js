/**
 * PHANTOM TWITCHESS - Main Application
 * Point d'entrée principal, Router, État global
 */

import gameEngine from './core/gameEngine.js';
import timer from './core/timer.js';
import voting from './core/voting.js';
import twitch from './managers/twitch.js';

// ============================================
// ÉTAT GLOBAL
// ============================================
const AppState = {
    currentPage: 'landing',
    
    // Mode de jeu
    gameMode: 'sandbox', // sandbox, problems, oneVsAll, oneVsOne, chatVsChat
    
    // Configuration du jeu
    config: {
        // Twitch
        defaultChannel: '',
        
        // Timer/Vote
        timerEnabled: false,
        timerDuration: 25,
        wheelDuration: 5,
        pauseAfterEnd: 15,
        singleVote: false,
        majorityMode: false,
        
        // Restrictions Twitch
        followersOnly: false,
        subsOnly: false,
        
        // Affichage
        noBg: false,
        
        // Phantom
        phantomAutoSync: true,
        phantomSpeed: 3
    },
    
    // Joueurs selon le mode
    players: {
        solo: '',           // 1vsAll
        player1: '',        // 1v1
        player2: '',        // 1v1
        chat1: '',          // ChatVsChat
        chat2: ''           // ChatVsChat
    },
    
    // Problèmes
    problems: {
        selectedThemes: []
    },
    
    // Configs sauvegardées
    savedConfigs: []
};

// ============================================
// STORAGE MANAGER
// ============================================
const Storage = {
    KEYS: {
        CONFIG: 'phantom_twitchess_config',
        SAVED_CONFIGS: 'phantom_twitchess_saved_configs'
    },
    
    get(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn('Storage get error:', e);
            return null;
        }
    },
    
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('Storage set error:', e);
            return false;
        }
    },
    
    saveConfig() {
        Storage.set(Storage.KEYS.CONFIG, {
            gameMode: AppState.gameMode,
            config: AppState.config,
            players: AppState.players
        });
    },
    
    loadConfig() {
        const saved = Storage.get(Storage.KEYS.CONFIG);
        if (saved) {
            AppState.gameMode = saved.gameMode || 'sandbox';
            Object.assign(AppState.config, saved.config || {});
            Object.assign(AppState.players, saved.players || {});
            console.log('📦 Config chargée depuis localStorage');
        }
    },
    
    saveNamedConfig(name) {
        const config = {
            id: Date.now().toString(),
            name,
            createdAt: new Date().toISOString(),
            gameMode: AppState.gameMode,
            config: { ...AppState.config },
            players: { ...AppState.players },
            fen: gameEngine.getFen()
        };
        
        AppState.savedConfigs.unshift(config);
        Storage.set(Storage.KEYS.SAVED_CONFIGS, AppState.savedConfigs);
        return config;
    },
    
    loadSavedConfigs() {
        AppState.savedConfigs = Storage.get(Storage.KEYS.SAVED_CONFIGS) || [];
    },
    
    deleteSavedConfig(id) {
        AppState.savedConfigs = AppState.savedConfigs.filter(c => c.id !== id);
        Storage.set(Storage.KEYS.SAVED_CONFIGS, AppState.savedConfigs);
    }
};

// ============================================
// ROUTER (SPA Navigation)
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
        const [path] = hash.split('?');
        const pageName = this.routes[path] || 'landing';
        
        this.showPage(pageName);
    },

    showPage(pageName) {
        // Cacher toutes les pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('is-active');
        });
        
        // Afficher la page cible
        const target = document.getElementById(`page-${pageName}`);
        if (target) {
            target.classList.add('is-active');
            AppState.currentPage = pageName;
        }

        // Mettre à jour la nav
        document.querySelectorAll('.nav__link').forEach(link => {
            const linkPath = link.dataset.navigate;
            link.classList.toggle('is-active', 
                linkPath === '/' + pageName || (linkPath === '/' && pageName === 'landing')
            );
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
    initialized: false,

    init() {
        if (!this.initialized) {
            // Première initialisation du GameEngine
            gameEngine.init({
                timerEnabled: AppState.config.timerEnabled,
                timerDuration: AppState.config.timerDuration,
                wheelDuration: AppState.config.wheelDuration,
                pauseAfterEnd: AppState.config.pauseAfterEnd,
                majorityMode: AppState.config.majorityMode,
                singleVote: AppState.config.singleVote
            });
            
            this.setupEventListeners();
            this.initialized = true;
        } else {
            // Resize le board si déjà initialisé
            gameEngine.board?.resize();
        }
        
        // Synchroniser l'UI avec l'état
        this.syncUIFromState();
        
        // Charger les configs sauvegardées
        this.loadConfigs();
        
        // Mettre à jour les sections conditionnelles
        this.updateConditionalUI();
    },

    setupEventListeners() {
        // ========== BOUTONS DE CONTRÔLE ==========
        
        // Bouton APPLIQUER
        document.getElementById('btn-apply-config')?.addEventListener('click', () => {
            this.applyConfig();
        });
        
        // Reset
        document.getElementById('btn-reset')?.addEventListener('click', () => {
            gameEngine.reset();
            Toast.success('Échiquier réinitialisé');
        });
        
        // Undo
        document.getElementById('btn-undo')?.addEventListener('click', () => {
            const move = gameEngine.undo();
            if (move) {
                Toast.success(`Annulé: ${move.san}`);
            } else {
                Toast.warning('Aucun coup à annuler');
            }
        });
        
        // Flip
        document.getElementById('btn-flip')?.addEventListener('click', () => {
            gameEngine.flip();
        });
        
        // Sync Phantom
        document.getElementById('btn-sync')?.addEventListener('click', () => {
            if (window.phantomChessboard?.isConnected) {
                window.phantomChessboard.syncPosition(gameEngine.getFen());
                Toast.info('Synchronisation envoyée');
            }
        });
        
        // Game End Phantom
        document.getElementById('btn-game-end')?.addEventListener('click', async () => {
            if (window.phantomChessboard?.isConnected) {
                await window.phantomChessboard.sendGameEnd();
                Toast.success('Game End envoyé');
            }
        });
        
        // Sauvegarder config
        document.getElementById('btn-save-config')?.addEventListener('click', () => {
            this.showSaveModal();
        });

        // ========== MODE DE JEU ==========
        document.querySelectorAll('.mode-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('is-active'));
                option.classList.add('is-active');
                AppState.gameMode = option.dataset.mode;
                this.updateModeOptions();
            });
        });

        // ========== TOGGLES ==========
        this.setupToggle('toggle-voting', (active) => {
            AppState.config.timerEnabled = active;
            this.updateVotingUI();
        });
        
        this.setupToggle('toggle-single-vote', (active) => {
            AppState.config.singleVote = active;
        });
        
        this.setupToggle('toggle-majority', (active) => {
            AppState.config.majorityMode = active;
        });
        
        this.setupToggle('toggle-followers', (active) => {
            AppState.config.followersOnly = active;
        });
        
        this.setupToggle('toggle-subs', (active) => {
            AppState.config.subsOnly = active;
        });
        
        this.setupToggle('toggle-auto-sync', (active) => {
            AppState.config.phantomAutoSync = active;
        });

        // ========== INPUTS NUMÉRIQUES ==========
        document.getElementById('timer-duration')?.addEventListener('change', (e) => {
            AppState.config.timerDuration = parseInt(e.target.value) || 25;
        });
        
        document.getElementById('wheel-duration')?.addEventListener('change', (e) => {
            AppState.config.wheelDuration = parseInt(e.target.value) || 5;
        });

        // ========== INPUTS JOUEURS ==========
        document.getElementById('player-solo')?.addEventListener('blur', (e) => {
            AppState.players.solo = e.target.value;
        });
        
        document.getElementById('player-1')?.addEventListener('blur', (e) => {
            AppState.players.player1 = e.target.value;
        });
        
        document.getElementById('player-2')?.addEventListener('blur', (e) => {
            AppState.players.player2 = e.target.value;
        });
        
        document.getElementById('chat-1')?.addEventListener('blur', (e) => {
            AppState.players.chat1 = e.target.value;
        });
        
        document.getElementById('chat-2')?.addEventListener('blur', (e) => {
            AppState.players.chat2 = e.target.value;
        });

        // ========== MODAL SAUVEGARDE ==========
        document.getElementById('btn-confirm-save')?.addEventListener('click', () => {
            const name = document.getElementById('config-name')?.value?.trim();
            if (name) {
                Storage.saveNamedConfig(name);
                this.renderConfigs();
                Toast.success(`Config "${name}" sauvegardée`);
                document.getElementById('modal-save')?.classList.remove('is-active');
                document.getElementById('config-name').value = '';
            } else {
                Toast.error('Veuillez entrer un nom');
            }
        });
    },

    setupToggle(id, callback) {
        const toggle = document.getElementById(id);
        if (toggle) {
            toggle.addEventListener('click', function() {
                this.classList.toggle('is-active');
                callback(this.classList.contains('is-active'));
            });
        }
    },

    /**
     * APPLIQUE LA CONFIG ET DÉMARRE LE JEU
     */
    applyConfig() {
        console.log('🎮 Application de la configuration...');
        
        // Sauvegarder dans localStorage
        Storage.saveConfig();
        
        // Mettre à jour la config du GameEngine
        gameEngine.setConfig({
            timerEnabled: AppState.config.timerEnabled,
            timerDuration: AppState.config.timerDuration,
            wheelDuration: AppState.config.wheelDuration,
            pauseAfterEnd: AppState.config.pauseAfterEnd,
            majorityMode: AppState.config.majorityMode,
            singleVote: AppState.config.singleVote
        });
        
        // Appliquer noBg
        document.body.classList.toggle('no-bg', AppState.config.noBg);
        
        // Démarrer le jeu
        gameEngine.startGame();
        
        // Notification
        Toast.success('✅ Configuration appliquée !');
        
        console.log('✅ Config appliquée:', {
            mode: AppState.gameMode,
            timer: AppState.config.timerEnabled,
            duration: AppState.config.timerDuration
        });
    },

    syncUIFromState() {
        // Mode de jeu
        document.querySelectorAll('.mode-option').forEach(o => {
            o.classList.toggle('is-active', o.dataset.mode === AppState.gameMode);
        });
        this.updateModeOptions();

        // Toggles
        this.setToggleState('toggle-voting', AppState.config.timerEnabled);
        this.setToggleState('toggle-single-vote', AppState.config.singleVote);
        this.setToggleState('toggle-majority', AppState.config.majorityMode);
        this.setToggleState('toggle-followers', AppState.config.followersOnly);
        this.setToggleState('toggle-subs', AppState.config.subsOnly);
        this.setToggleState('toggle-auto-sync', AppState.config.phantomAutoSync);

        // Inputs numériques
        const timerDuration = document.getElementById('timer-duration');
        if (timerDuration) timerDuration.value = AppState.config.timerDuration;
        
        const wheelDuration = document.getElementById('wheel-duration');
        if (wheelDuration) wheelDuration.value = AppState.config.wheelDuration;

        // Inputs joueurs
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

        // Voting panel
        this.updateVotingUI();
    },

    setToggleState(id, active) {
        const toggle = document.getElementById(id);
        if (toggle) {
            toggle.classList.toggle('is-active', active);
        }
    },

    updateModeOptions() {
        document.querySelectorAll('.mode-options').forEach(el => {
            el.classList.remove('is-visible');
        });
        
        const modeOptions = document.getElementById(`options-${AppState.gameMode}`);
        if (modeOptions) {
            modeOptions.classList.add('is-visible');
        }
    },

    updateVotingUI() {
        const votingPanel = document.getElementById('voting-panel');
        if (votingPanel) {
            votingPanel.classList.toggle('is-visible', AppState.config.timerEnabled);
        }
    },

    updateConditionalUI() {
        const twitchConnected = window.twitch?.isConnected;
        const phantomConnected = window.phantomChessboard?.isConnected;

        document.querySelectorAll('.twitch-only').forEach(el => {
            el.classList.toggle('is-visible', twitchConnected);
        });

        document.querySelectorAll('.phantom-only').forEach(el => {
            el.classList.toggle('is-visible', phantomConnected);
        });

        document.getElementById('btn-sync')?.toggleAttribute('disabled', !phantomConnected);
        document.getElementById('btn-game-end')?.toggleAttribute('disabled', !phantomConnected);
    },

    showSaveModal() {
        document.getElementById('modal-save')?.classList.add('is-active');
        document.getElementById('config-name')?.focus();
    },

    loadConfigs() {
        Storage.loadSavedConfigs();
        this.renderConfigs();
    },

    renderConfigs() {
        const container = document.getElementById('configs-list');
        if (!container) return;

        if (AppState.savedConfigs.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Aucune configuration</p></div>';
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
                Storage.deleteSavedConfig(btn.dataset.delete);
                this.renderConfigs();
                Toast.info('Config supprimée');
            });
        });
    },

    loadConfig(id) {
        const config = AppState.savedConfigs.find(c => c.id === id);
        if (!config) return;

        AppState.gameMode = config.gameMode;
        Object.assign(AppState.config, config.config);
        Object.assign(AppState.players, config.players);

        if (config.fen) {
            gameEngine.loadFen(config.fen);
        }

        this.syncUIFromState();
        Toast.success(`Config "${config.name}" chargée`);
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

        // Mock data
        const games = [];

        if (games.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state__icon">📺</div>
                    <p class="empty-state__title">Aucune partie en cours</p>
                    <p class="empty-state__desc">Sois le premier à lancer une Bataille Twitch !</p>
                </div>
            `;
        }
    }
};

// ============================================
// TOAST NOTIFICATIONS
// ============================================
const Toast = {
    container: null,

    init() {
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },

    show(message, type = 'info', duration = 3000) {
        if (!this.container) this.init();

        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.textContent = message;

        this.container.appendChild(toast);

        setTimeout(() => toast.classList.add('is-visible'), 10);

        setTimeout(() => {
            toast.classList.remove('is-visible');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error'); },
    warning(msg) { this.show(msg, 'warning'); },
    info(msg) { this.show(msg, 'info'); }
};

// ============================================
// MODALS
// ============================================
function setupModals() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('is-active');
            }
        });
    });

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal-overlay')?.classList.remove('is-active');
        });
    });
}

// ============================================
// CONNECTION HANDLERS
// ============================================
function setupConnectionHandlers() {
    document.querySelectorAll('[data-action="connect-twitch"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await window.twitch?.connect();
                updateConnectionUI();
                Toast.success('Twitch connecté !');
            } catch (e) {
                Toast.error('Connexion Twitch échouée');
            }
        });
    });

    document.querySelectorAll('[data-action="connect-phantom"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await window.phantomChessboard?.connect();
                updateConnectionUI();
                Toast.success('Phantom connecté !');
            } catch (e) {
                Toast.error('Connexion Phantom échouée');
            }
        });
    });
}

function updateConnectionUI() {
    const twitchConnected = window.twitch?.isConnected;
    const phantomConnected = window.phantomChessboard?.isConnected;

    document.querySelectorAll('.status-dot--twitch').forEach(dot => {
        dot.classList.toggle('is-connected', twitchConnected);
    });
    
    document.querySelectorAll('.status-dot--phantom').forEach(dot => {
        dot.classList.toggle('is-connected', phantomConnected);
    });

    if (AppState.currentPage === 'sandbox') {
        SandboxPage.updateConditionalUI();
    }
}


document.getElementById('phantom-speed')?.addEventListener('input', (e) => {
    const speed = parseInt(e.target.value);
    document.getElementById('phantom-speed-value').textContent = speed;
});

document.getElementById('phantom-speed')?.addEventListener('change', async (e) => {
    const speed = parseInt(e.target.value);
    console.log(`⚡ Modification vitesse: ${speed}`);
    
    if (window.phantomChessboard?.isConnected) {
        await window.phantomChessboard.setSpeed(speed);
        Toast.success(`Vitesse réglée à ${speed}`);
    }
});

// Écouter l'événement de connexion Phantom pour mettre à jour l'UI
window.addEventListener('phantomConnected', async () => {
    if (window.phantomChessboard) {
        const speed = await window.phantomChessboard.getSpeed();
        const slider = document.getElementById('phantom-speed');
        const valueEl = document.getElementById('phantom-speed-value');
        
        if (slider) slider.value = speed;
        if (valueEl) valueEl.textContent = speed;
        
        console.log(`⚡ Vitesse actuelle du Phantom: ${speed}`);
    }
});


// ============================================
// INITIALISATION
// ============================================
async function initApp() {
    console.log('🚀 Phantom Twitchess - Initialisation...');

    // Charger la config sauvegardée
    Storage.loadConfig();

    // Setup
    Toast.init();
    setupModals();
    setupConnectionHandlers();

    // Init router
    Router.init();

    // Restore connections
    await twitch?.restore();

    // Écouter les votes Twitch
    if (twitch) {
        twitch.onVote = (voteContext) => {
            if (voting.isOpen) {
                voting.addVote(voteContext.username, voteContext.move);
            }
        };
    }

    // Écouter les événements Phantom pour pause/resume du timer
    window.addEventListener('phantomMoveStart', () => {
        if (AppState.config.timerEnabled && timer.isRunning) {
            console.log('⏸️ Pause timer - Phantom en mouvement');
            timer.pause();
        }
    });
    
    window.addEventListener('phantomMoveComplete', () => {
        if (AppState.config.timerEnabled && timer.isRunning && timer.isPaused) {
            console.log('▶️ Reprise timer - Phantom terminé');
            timer.resume();
        }
    });

    updateConnectionUI();

    console.log('✅ Phantom Twitchess prêt !');
}

// Démarrer quand le DOM est prêt
document.addEventListener('DOMContentLoaded', initApp);

// Exports
export { AppState, Router, SandboxPage, BrowsePage, Toast, Storage, gameEngine, timer, voting };