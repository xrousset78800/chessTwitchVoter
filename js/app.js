/**
 * PHANTOM TWITCHESS - Main Application
 * Router, State Management, Initialization
 */

// ============================================
// STATE
// ============================================
const AppState = {
    currentPage: 'landing',
    gameMode: 'yolo', // yolo, problems, oneVsAll, oneVsOne, chatVsChat
    
    // Voting
    voting: {
        enabled: false,
        timerDuration: 25,
        wheelDuration: 5,
        singleVote: false,
        majorityMode: false
    },
    
    // Restrictions (requires Twitch)
    restrictions: {
        followersOnly: false,
        subsOnly: false
    },
    
    // Mode-specific
    players: {
        solo: '',      // 1vsAll
        player1: '',   // 1v1
        player2: '',   // 1v1
        chat1: '',     // ChatVsChat
        chat2: ''      // ChatVsChat
    },
    
    // Configs
    savedConfigs: [],

    // Webcam
    webcam: {
        enabled: false,
        opacity: 0.3,
        stream: null
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
        
        // Parse query params
        if (queryString) {
            const params = new URLSearchParams(queryString);
            if (params.has('mode')) {
                AppState.gameMode = params.get('mode');
            }
        }

        this.showPage(pageName);
    },

    showPage(pageName) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(p => p.classList.remove('is-active'));
        
        // Show target page
        const target = document.getElementById(`page-${pageName}`);
        if (target) {
            target.classList.add('is-active');
            AppState.currentPage = pageName;
        }

        // Update nav
        document.querySelectorAll('.nav__link').forEach(link => {
            const linkPath = link.dataset.navigate;
            link.classList.toggle('is-active', linkPath === '/' + pageName || 
                (linkPath === '/' && pageName === 'landing'));
        });

        // Page-specific init
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
        
        // Update conditional UI
        this.updateConditionalUI();
        
        // Load saved configs
        this.loadConfigs();
    },

    setupModeSelector() {
        document.querySelectorAll('.mode-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('is-active'));
                option.classList.add('is-active');
                
                AppState.gameMode = option.dataset.mode;
                this.updateModeOptions();
            });
        });

        // Set initial active mode
        const currentModeEl = document.querySelector(`.mode-option[data-mode="${AppState.gameMode}"]`);
        if (currentModeEl) {
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
            if (window.phantom?.isConnected) {
                await window.phantom.setSpeed(speed);
            }
        });

        // Save config
        document.getElementById('btn-save-config')?.addEventListener('click', () => {
            this.showSaveModal();
        });
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
        const config = {
            id: Date.now().toString(),
            name,
            createdAt: new Date().toISOString(),
            gameMode: AppState.gameMode,
            voting: { ...AppState.voting },
            players: { ...AppState.players },
            fen: window.chessManager?.fen()
        };

        AppState.savedConfigs.unshift(config);
        window.storage?.set('configs', AppState.savedConfigs);
        this.renderConfigs();
        
        window.toast?.success(window.i18n?.t('configs.saved', { name }) || `Saved: ${name}`);
    },

    loadConfigs() {
        AppState.savedConfigs = window.storage?.get('configs') || [];
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

        AppState.gameMode = config.gameMode;
        AppState.voting = { ...config.voting };
        AppState.players = { ...config.players };

        if (config.fen) {
            window.chessManager?.loadFen(config.fen);
        }

        this.setupModeSelector();
        window.toast?.success(window.i18n?.t('configs.loaded', { name: config.name }));
    },

    deleteConfig(id) {
        AppState.savedConfigs = AppState.savedConfigs.filter(c => c.id !== id);
        window.storage?.set('configs', AppState.savedConfigs);
        this.renderConfigs();
        window.toast?.info(window.i18n?.t('configs.deleted'));
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
                    ${game.live ? '<span class="game-card__live">LIVE</span>' : ''}
                </div>
                <div class="game-card__players">
                    <div class="game-card__player">
                        <div class="game-card__avatar">${game.players[0][0]}</div>
                        <span class="game-card__player-name">${game.players[0]}</span>
                    </div>
                    <span class="game-card__vs">VS</span>
                    <div class="game-card__player game-card__player--right">
                        <span class="game-card__player-name">${game.players[1]}</span>
                        <div class="game-card__avatar">${game.players[1][0]}</div>
                    </div>
                </div>
                <div class="game-card__footer">
                    <span class="game-card__spectators"><i class="fas fa-eye"></i> ${game.spectators}</span>
                    <span>${game.moves} moves</span>
                </div>
            </div>
        `).join('');
    }
};

// ============================================
// CONNECTION HANDLERS
// ============================================
function setupConnectionHandlers() {
    // Twitch connect
    document.querySelectorAll('[data-action="connect-twitch"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (window.twitch?.isConnected) {
                await window.twitch.disconnect();
            } else {
                const channel = prompt(window.i18n?.t('connections.enterChannel') || 'Enter Twitch channel:');
                if (channel) {
                    try {
                        await window.twitch.connect(channel);
                        window.toast?.success(`Connected to ${channel}`);
                    } catch (e) {
                        window.toast?.error('Connection failed');
                    }
                }
            }
        });
    });

    // Phantom connect
    document.querySelectorAll('[data-action="connect-phantom"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (window.phantom?.isConnected) {
                await window.phantom.disconnect();
            } else {
                try {
                    await window.phantom.connect();
                    window.toast?.success('Phantom connected');
                    SandboxPage.updateConditionalUI();
                    SandboxPage.updateWebcam();
                } catch (e) {
                    window.toast?.error(e.message);
                }
            }
        });
    });

    // Listen for connection events
    window.addEventListener('phantomConnected', () => updateConnectionUI());
    window.addEventListener('phantomDisconnected', () => updateConnectionUI());
    window.addEventListener('twitchConnected', () => updateConnectionUI());
    window.addEventListener('twitchDisconnected', () => updateConnectionUI());
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
            window.toast?.error(window.i18n?.t('toast.enterName'));
        }
    });
}

// ============================================
// INITIALIZATION
// ============================================
async function initApp() {
    console.log('🚀 Phantom Twitchess - Initializing...');

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
        const reconnect = confirm(window.i18n?.t('connections.reconnectPrompt', { device: savedPhantom }));
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
export { AppState, Router, SandboxPage, BrowsePage };
