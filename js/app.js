/**
 * PHANTOM TWITCHESS - Main Application
 * Point d'entrée principal, Router, État global
 * 
 * MISE À JOUR : Intégration du mode Problèmes via problemsManager
 * FIX: Structure corrigée - initProblemsMode intégré dans SandboxPage
 */

import gameEngine from './core/gameEngine.js';
import timer from './core/timer.js';
import voting from './core/voting.js';
import problemsManager from './core/problemManager.js';
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
        pauseAfterEnd: 5,
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
        selectedThemes: [],
        isActive: false
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
            players: AppState.players,
            problems: AppState.problems
        });
    },
    
    loadConfig() {
        const saved = Storage.get(Storage.KEYS.CONFIG);
        if (saved) {
            AppState.gameMode = saved.gameMode || 'sandbox';
            Object.assign(AppState.config, saved.config || {});
            Object.assign(AppState.players, saved.players || {});
            Object.assign(AppState.problems, saved.problems || {});
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
            problems: { ...AppState.problems },
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
        '/battle': 'battle',
        '/browse': 'browse',
        '/live': 'live',
        '/tournament': 'tournament',
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
        // /battle réutilise page-sandbox mais avec body.battle-mode
        const actualPage = pageName === 'battle' ? 'sandbox' : pageName;

        // Cacher toutes les pages
        document.querySelectorAll('.page').forEach(p => p.classList.remove('is-active'));

        // Activer/désactiver le mode Bataille sur le body
        document.body.classList.toggle('battle-mode', pageName === 'battle');

        // Afficher la page cible
        const target = document.getElementById(`page-${actualPage}`);
        if (target) {
            target.classList.add('is-active');
            AppState.currentPage = pageName;
        }

        // Mettre à jour la nav
        document.querySelectorAll('.nav__link').forEach(link => {
            const linkPath = link.dataset.navigate;
            link.classList.toggle('is-active',
                linkPath === '/' + actualPage || (linkPath === '/' && pageName === 'landing')
            );
        });

        // Init spécifique à la page
        if (pageName === 'sandbox' || pageName === 'battle') {
            SandboxPage.init();
        } else if (pageName === 'browse') {
            BrowsePage.init();
        } else if (pageName === 'live') {
            LivePage.init();
        } else if (pageName === 'tournament') {
            TournamentPage.init();
        }
    }
};

const TournamentPage = {
    initialized: false,
    init() {
        if (!this.initialized) {
            initTournamentBoard();
            this.initialized = true;
        }
        setTimeout(() => {
            stateT.board?.resize();
            // Auto-load depuis le hash
            const hash = window.location.hash;
            const hashParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
            const eventSlug = hashParams.get('event');
            if (eventSlug && !stateT.tournamentSlug) {
                document.getElementById('tournamentInput').value = eventSlug;
                document.getElementById('btnLoadTournament').click();
            }
        }, 50);
    }
};

const LivePage = {
    initialized: false,
    init() {
        if (!this.initialized) {
            initBoard();  // fonction du script de phantomLive
            this.initialized = true;
        }
    }
};


// ============================================
// SANDBOX PAGE
// ============================================
const SandboxPage = {
    initialized: false,
    problemsInitialized: false,

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

async applyConfigAfterReload() {
    document.body.classList.toggle('no-bg', AppState.config.noBg);

    if (gameEngine.updateVotingIndicator) gameEngine.updateVotingIndicator();

    if (AppState.gameMode === 'problems') {
        if (!this.problemsInitialized) {
            const success = await this.initProblemsMode();
            if (!success) { Toast.error('Erreur initialisation mode problèmes'); return; }
        }
        problemsManager.clearThemes();
        AppState.problems.selectedThemes.forEach(t => problemsManager.toggleTheme(t));
        problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
        AppState.problems.isActive = true;
        problemsManager.loadRandomProblem();
        Toast.success('🧩 Mode Problèmes activé !');
        return;
    }

    problemsManager.reset();
    AppState.problems.isActive = false;

    // Mettre à jour la config du GameEngine (copié de l'applyConfig existant)
    gameEngine.config.timerEnabled = AppState.config.timerEnabled;
    gameEngine.config.timerDuration = AppState.config.timerDuration;
    gameEngine.config.wheelDuration = AppState.config.wheelDuration;
    gameEngine.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
    gameEngine.config.majorityMode = AppState.config.majorityMode;
    gameEngine.config.singleVote = AppState.config.singleVote;

    gameEngine.mode = AppState.gameMode;
    gameEngine.startGame();
    Toast.success('✅ Configuration appliquée !');

    if (gameEngine.updateVotingIndicator) gameEngine.updateVotingIndicator();
},

    async initProblemsMode() {
        console.log('🧩 Initialisation du mode Problèmes...');
        
        // 1. Charger les problèmes si nécessaire
        if (!problemsManager.isLoaded()) {
            try {
                await problemsManager.loadProblems('js/problemsV2.csv');
            } catch (error) {
                console.error('Erreur chargement problèmes:', error);
                Toast.error('Erreur chargement des problèmes');
                return false;
            }
        }
        
        // 2. Injecter les références chess et board
        problemsManager.init({
            chess: gameEngine.chess,
            board: gameEngine.board,
            config: {
                pauseAfterEnd: AppState.config.pauseAfterEnd || 5,
                botMoveDelay: 1200,
                timerEnabled: AppState.config.timerEnabled,
                timerDuration: AppState.config.timerDuration,
                majorityMode: AppState.config.majorityMode,
                wheelDuration: AppState.config.wheelDuration
            }
        });
        
        // 3. Configurer les callbacks
        this.setupProblemsCallbacks();
        
        // 4. Remplir le menu des thèmes
        this.populateThemesSelect();
        
        this.problemsInitialized = true;
        
        return true;
    },

    // ========== CALLBACKS PROBLÈMES ==========
    
    setupProblemsCallbacks() {
        // Problème chargé
        problemsManager.onProblemLoaded = (problem) => {
            console.log('📋 Problème chargé:', problem.id);
            this.updateProblemUI(problem);
            this.syncPhantom();
        };
        
        // Bot joue
        problemsManager.onBotMove = (move) => {
            console.log('🤖 Bot:', move.san);
            this.addMoveToHistory(move, 'bot');
            this.syncPhantom();
        };

problemsManager.onResolveWithWheel = (results, callback) => {
    if (!gameEngine.votingWheel) {
        // Pas de roue : pondéré direct
        const total = results.reduce((s, r) => s + r.count, 0);
        let rand = Math.random() * total;
        let winner = results[0].move;
        for (const r of results) {
            rand -= r.count;
            if (rand <= 0) { winner = r.move; break; }
        }
        callback(winner);
        return;
    }
    
    gameEngine.votingWheel.clear();
    results.forEach(r => {
        gameEngine.votingWheel.votes.set(r.move, {
            count: r.count,
            voters: new Map([['system', r.count]])
        });
    });
    gameEngine.votingWheel.draw();
    gameEngine.showWheel();
    document.body.classList.add('randomWheel');
    
    const wheelDuration = (AppState.config.wheelDuration || 5) * 1000;
    gameEngine.votingWheel.onSpinEnd = (winner) => {
        document.body.classList.remove('randomWheel');
        gameEngine.hideWheel();
        callback(winner);
    };
    gameEngine.votingWheel.spin(wheelDuration);
};


        // Joueur correct
        problemsManager.onCorrectMove = (move) => {
            console.log('✅ Correct:', move.san);
            this.showProblemFeedback('correct');
            this.addMoveToHistory(move, 'player');
            this.syncPhantom();
        };
        
        // Joueur erreur
        problemsManager.onWrongMove = (expectedSAN, expectedUCI) => {
            console.log('❌ Erreur! Attendu:', expectedSAN);
            this.showProblemFeedback('wrong', expectedSAN);
            Toast.error(`Mauvais coup ! Le bon était ${expectedSAN}`);
        };
        
        // Problème résolu
        problemsManager.onProblemSolved = (problem) => {
            console.log('🎉 Résolu!');
            this.showProblemFeedback('solved');
            Toast.success('🎉 Problème résolu !');
            
            // Charger le suivant après délai
            setTimeout(() => {
                problemsManager.loadRandomProblem();
            }, (AppState.config.pauseAfterEnd || 5) * 1000);
        };
        
        // Problème échoué
        problemsManager.onProblemFailed = (problem) => {
            console.log('💔 Échoué');
            this.showProblemFeedback('failed');
            
            // Charger le suivant après délai
            setTimeout(() => {
                problemsManager.loadRandomProblem();
            }, (AppState.config.pauseAfterEnd || 5) * 1000);
        };
        
        // Changement d'état
        problemsManager.onStateChange = (state) => {
            this.updateProblemStateUI(state);
        };
    },
    
    // ========== UI HELPERS POUR PROBLÈMES ==========
    
    updateProblemUI(problem) {
        const updates = {
            '[data-prob-id]': problem.id,
            '[data-prob-elo]': problem.rating,
            '[data-opening-tags]': problem.themes,
            '[data-fen]': problem.fen,
            '[data-length]': Math.ceil(problem.moves.length / 2)
        };
        
        for (const [selector, value] of Object.entries(updates)) {
            const el = document.querySelector(selector);
            if (el) el.textContent = value;
        }
        
        // Afficher le panneau problème si caché
        const problemPanel = document.getElementById('problem-panel');
        if (problemPanel) problemPanel.classList.add('is-visible');
        
        // Vider l'historique
        const historyEl = document.querySelector('.move-history, .poll ol, #move-history');
        if (historyEl) historyEl.innerHTML = '';
    },
    
    updateProblemStateUI(state) {
        const attemptEl = document.querySelector('[data-attempt]');
        if (attemptEl) {
            attemptEl.textContent = Math.floor(state.attemptIndex / 2);
        }
        
        document.body.classList.toggle('player-turn', state.isPlayerTurn);
        document.body.classList.toggle('bot-turn', !state.isPlayerTurn);
    },
    
    addMoveToHistory(move, player) {
        const historyEl = document.querySelector('.move-history, .poll ol, #move-history');
        if (!historyEl) return;
        
        const moveEl = document.createElement('span');
        moveEl.className = player === 'bot' ? 'move-bot' : 'move-player';
        moveEl.textContent = move.san + ' ';
        historyEl.appendChild(moveEl);
    },
    
    showProblemFeedback(type, message = '') {
        // Retirer les anciens feedbacks
        document.body.classList.remove('problem-correct', 'problem-wrong', 'problem-solved', 'problem-failed');
        
        // Ajouter le nouveau
        document.body.classList.add(`problem-${type}`);
        
        // Créer un élément de feedback temporaire
        const existing = document.getElementById('problem-feedback');
        if (existing) existing.remove();
        
        const feedback = document.createElement('div');
        feedback.id = 'problem-feedback';
        feedback.className = `problem-feedback problem-feedback--${type}`;
        
        switch (type) {
            case 'correct':
                feedback.innerHTML = '<span class="feedback-icon">✓</span>';
                break;
            case 'wrong':
                feedback.innerHTML = `<span class="feedback-icon">✗</span><span class="feedback-text">${message}</span>`;
                break;
            case 'solved':
                feedback.innerHTML = '<span class="feedback-icon">🎉</span><span class="feedback-text">Résolu !</span>';
                break;
            case 'failed':
                feedback.innerHTML = '<span class="feedback-icon">💔</span>';
                break;
        }
        
        document.body.appendChild(feedback);
        
        setTimeout(() => {
            feedback.remove();
            document.body.classList.remove(`problem-${type}`);
        }, 2000);
    },
    
    syncPhantom() {
        const fen = gameEngine.chess?.fen?.() || problemsManager.chess?.fen?.();
        if (fen && window.phantomChessboard?.isConnected) {
            window.phantomChessboard.syncPosition(fen);
        }
    },

    setupEventListeners() {
        // ========== BOUTONS DE CONTRÔLE ==========
        
        // Bouton APPLIQUER
        document.getElementById('btn-apply-config')?.addEventListener('click', () => {
            this.applyConfig();
        });
        
        // Reset
        document.getElementById('btn-reset')?.addEventListener('click', () => {
            if (AppState.gameMode === 'problems' && problemsManager.isActive) {
                problemsManager.loadRandomProblem();
                Toast.info('Nouveau problème chargé');
            } else {
                gameEngine.reset();
                Toast.success('Échiquier réinitialisé');
            }
        });

        document.getElementById('btn-calibrate')?.addEventListener('click', async () => {
            if (window.phantomChessboard?.isConnected) {
                await window.phantomChessboard.calibrate();
                Toast.success('Calibration lancée');
            }
        });

        document.getElementById('problem-pause')?.addEventListener('change', (e) => {
            AppState.config.pauseAfterEnd = parseInt(e.target.value) || 5;
            if (window.problemsManager) {
                window.problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
            }
        });
        // Undo
        document.getElementById('btn-undo')?.addEventListener('click', () => {
            if (AppState.gameMode === 'problems') {
                Toast.warning('Undo désactivé en mode problèmes');
                return;
            }
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

        // Reset + Sync Phantom
        document.getElementById('btn-reset-sync')?.addEventListener('click', () => {
            gameEngine.reset();
            if (window.phantomChessboard?.isConnected) {
                window.phantomChessboard.syncPosition(gameEngine.getFen());
                Toast.success('Échiquier réinitialisé et synchronisé');
            } else {
                Toast.success('Échiquier réinitialisé');
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

                if (gameEngine.updateVotingIndicator) {
                    gameEngine.updateVotingIndicator();
                }                

                // Précharger les problèmes si mode problèmes sélectionné
                if (option.dataset.mode === 'problems' && !problemsManager.isLoaded()) {
                    problemsManager.loadProblems('js/problemsV2.csv').then(() => {
                        this.populateThemesSelect();
                    });
                }
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
        
        // ========== SÉLECTION THÈMES PROBLÈMES ==========
        document.getElementById('problem-themes')?.addEventListener('change', (e) => {
            const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
            AppState.problems.selectedThemes = selected;
            
            problemsManager.clearThemes();
            selected.forEach(theme => problemsManager.toggleTheme(theme));
            
            const count = problemsManager.getFilteredProblems().length;
            const countEl = document.getElementById('problem-count');
            if (countEl) countEl.textContent = `${count} problèmes`;
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
        
        // ========== INTERCEPTION DES COUPS EN MODE PROBLÈME ==========
        this.setupProblemsInterception();
    },

    setupProblemsInterception() {
        const originalOnDrop = gameEngine.onDrop?.bind(gameEngine);
        
        gameEngine.onDrop = (source, target, piece, newPos, oldPos, orientation) => {
            // Si mode problèmes actif, déléguer au problemsManager
            if (AppState.gameMode === 'problems' && problemsManager.isActive) {
                const move = source + target;
                const result = problemsManager.validateAndPlayMove(move);
                
                if (!result.valid || !result.correct) {
                    return 'snapback';
                }
                
                return; // Le board est déjà mis à jour par problemsManager
            }
            
            // Sinon comportement normal
            if (originalOnDrop) {
                return originalOnDrop(source, target, piece, newPos, oldPos, orientation);
            }
        };
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
    
    populateThemesSelect() {
        const select = document.getElementById('problem-themes');
        if (!select) return;
        
        const stats = problemsManager.themeStats;
        const sortedThemes = Object.entries(stats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30);
        
        select.innerHTML = sortedThemes.map(([theme, count]) => 
            `<option value="${theme}">${theme} (${count})</option>`
        ).join('');
    },

    /**
     * APPLIQUE LA CONFIG ET DÉMARRE LE JEU
     */
async applyConfig() {
    Storage.saveConfig();
    sessionStorage.setItem('autoStart', '1');
    window.location.reload();
},
fullReset() {
    console.log('🔄 Full reset de l\'état applicatif...');

    // 1. Stopper le timer
    if (window.timer) {
        timer.stop();
    }

    // 2. Stopper le voting system (intervalles de vote)
    if (window.voting) {
        voting.stop?.();
        voting.reset?.();
        // Fallback si pas de méthode stop
        if (voting.intervalId) {
            clearInterval(voting.intervalId);
            voting.intervalId = null;
        }
        if (voting.timeout) {
            clearTimeout(voting.timeout);
            voting.timeout = null;
        }
        voting.votes = {};
        voting.isActive = false;
    }

    // 3. Stopper la roue
    if (window.VotingWheel?.instance || document.querySelector('.voting-wheel')) {
        // Nettoyer l'animation en cours si besoin
        const wheel = document.querySelector('.voting-wheel');
        if (wheel) wheel.style.animation = 'none';
    }

    // 4. Reset du gameEngine
    if (window.gameEngine) {
        gameEngine.isRunning = false;
        gameEngine.reset?.();
    }

    // 5. Reset du problemsManager si actif
    if (window.problemsManager?.isActive) {
        problemsManager.stop?.();
        problemsManager.isActive = false;
    }

    // 6. Nettoyer tous les timers orphelins via les IDs connus
    // (sécurité supplémentaire)
    if (AppState._timerIds) {
        AppState._timerIds.forEach(id => {
            clearInterval(id);
            clearTimeout(id);
        });
        AppState._timerIds = [];
    }

    console.log('✅ Full reset terminé');
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
        document.getElementById('btn-calibrate')?.removeAttribute('disabled');

        document.getElementById('btn-sync')?.toggleAttribute('disabled', !phantomConnected);
        document.getElementById('btn-reset-sync')?.toggleAttribute('disabled', !phantomConnected);
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
        if (config.problems) {
            Object.assign(AppState.problems, config.problems);
        }

        if (config.fen && config.gameMode !== 'problems') {
            gameEngine.loadFen(config.fen);
        }

        this.syncUIFromState();

        if (gameEngine.updateVotingIndicator) {
            gameEngine.updateVotingIndicator();
        }
        Toast.success(`Config "${config.name}" chargée`);
    }
};

// ============================================
// BROWSE PAGE
// ============================================
const BrowsePage = {
    initialized: false,
    socket: null,

    init() {
        if (!this.initialized) {
            this.setupSocket();
            this.setupFormHandlers();
            this.setupCopyButtons();
            this.initialized = true;
        } else {
            this.socket?.emit('getGames');
        }
        this.handleJoinParam();
    },

    setupSocket() {
        if (typeof io === 'undefined') return;

        const SOCKET_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? `http://localhost:${window.location.port || 3000}`
            : 'https://chesstwitchvoter.onrender.com';

        this.socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

        this.socket.on('connect', () => {
            this.socket.emit('subscribeBrowse');
        });

        this.socket.on('gamesList', (games) => this.renderGames(games));
        this.socket.on('gamesListUpdated', (games) => this.renderGames(games));
    },

    setupFormHandlers() {
        document.getElementById('browse-create-btn')?.addEventListener('click', () => {
            const channel = document.getElementById('browse-host-channel')?.value?.trim();
            if (!channel) { Toast.error('Entre ton channel Twitch'); return; }

            const timerDuration  = parseInt(document.getElementById('browse-timer')?.value) || 30;
            const mode           = document.getElementById('browse-mode')?.value || 'wheel';
            const followersOnly  = document.getElementById('browse-follow-toggle')?.classList.contains('is-active') || false;
            const subsOnly       = document.getElementById('browse-sub-toggle')?.classList.contains('is-active') || false;

            const gameId = window.multiplayerManager?.createGameFromBrowse(channel, {
                timerDuration,
                majorityMode: mode === 'majority',
                followersOnly,
                subsOnly
            });

            if (gameId) {
                const guestUrl = `${window.location.origin}${window.location.pathname}?join=${gameId}`;
                document.getElementById('browse-game-code').textContent   = gameId;
                document.getElementById('browse-guest-url').textContent   = guestUrl;
                document.getElementById('browse-created-info').style.display = 'block';
                document.getElementById('browse-create-btn').style.display   = 'none';
            }
        });

        document.getElementById('browse-join-btn')?.addEventListener('click', () => {
            const channel = document.getElementById('browse-guest-channel')?.value?.trim();
            const code    = document.getElementById('browse-join-code')?.value?.trim().toUpperCase();
            if (!channel || !code) { Toast.error('Remplis tous les champs'); return; }
            window.multiplayerManager?.joinGameFromBrowse(channel, code);
        });

        document.getElementById('browse-refresh-btn')?.addEventListener('click', () => {
            this.socket?.emit('getGames');
        });
    },

    setupCopyButtons() {
        document.querySelectorAll('#page-browse .btn-copy').forEach(btn => {
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
    },

    handleJoinParam() {
        const joinCode = new URLSearchParams(window.location.search).get('join');
        if (!joinCode) return;
        const codeInput = document.getElementById('browse-join-code');
        if (codeInput) {
            codeInput.value = joinCode.toUpperCase();
            document.getElementById('browse-join-btn')?.scrollIntoView({ behavior: 'smooth' });
        }
    },

    renderGames(games) {
        const container = document.getElementById('games-list');
        if (!container) return;

        const active = (games || []).filter(g => g.status !== 'ended');

        if (active.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state__icon">⚔</div>
                    <p class="empty-state__title">Aucune partie en cours</p>
                    <p class="empty-state__desc">Sois le premier à lancer une Bataille Twitch !</p>
                </div>
            `;
            return;
        }

        container.innerHTML = active.map(game => {
            const elapsed    = game.startedAt ? Math.floor((Date.now() - game.startedAt) / 60000) + ' min' : '';
            const statusClass = game.status === 'playing' ? 'game-card__status--playing' : 'game-card__status--waiting';
            const statusLabel = game.status === 'playing' ? '● En cours' : '⏳ En attente';

            return `
                <div class="game-card" data-game-id="${game.gameId}">
                    <div class="game-card__header">
                        <span class="game-card__mode">Chat vs Chat</span>
                        <span class="game-card__status ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="game-card__players">
                        <div class="game-card__player">
                            <div class="game-card__avatar">♙</div>
                            <div>
                                <div class="game-card__player-name">${game.host}</div>
                                <div class="game-card__player-rating">Blancs</div>
                            </div>
                        </div>
                        <div class="game-card__vs">⚔</div>
                        <div class="game-card__player game-card__player--right">
                            <div class="game-card__avatar">♟</div>
                            <div>
                                <div class="game-card__player-name">${game.guest || '???'}</div>
                                <div class="game-card__player-rating">Noirs</div>
                            </div>
                        </div>
                    </div>
                    <div class="game-card__footer">
                        <span>${game.moveCount || 0} coup${game.moveCount !== 1 ? 's' : ''}</span>
                        ${elapsed ? `<span>${elapsed}</span>` : ''}
                        ${game.status === 'waiting' ? `
                            <button class="btn btn--primary btn--sm game-card__join-btn"
                                    data-game-id="${game.gameId}">
                                <i class="fas fa-sign-in-alt"></i> Rejoindre
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.game-card__join-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const codeInput = document.getElementById('browse-join-code');
                if (codeInput) {
                    codeInput.value = btn.dataset.gameId;
                    codeInput.scrollIntoView({ behavior: 'smooth' });
                    document.getElementById('browse-guest-channel')?.focus();
                }
            });
        });
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
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.innerHTML = `
            <span class="toast__message">${message}</span>
            <button class="toast__close">&times;</button>
        `;

        toast.querySelector('.toast__close').addEventListener('click', () => {
            toast.remove();
        });

        this.container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast--fade-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error', 5000); },
    warning(msg) { this.show(msg, 'warning'); },
    info(msg) { this.show(msg, 'info'); }
};

// ============================================
// MODALS
// ============================================
function setupModals() {
    document.querySelectorAll('.modal__close, [data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal-overlay')?.classList.remove('is-active');
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('is-active');
            }
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
                // Toggle: si connecté → déconnecter
                if (twitch?.isConnected) {
                    await twitch.disconnect();
                    updateConnectionUI();
                    Toast.info('Twitch déconnecté');
                } else {
                    await twitch.connect();
                    updateConnectionUI();
                    Toast.success('Twitch connecté !');
                }
            } catch (e) {
                if (e.message !== 'Connexion annulée') {
                    Toast.error('Connexion Twitch échouée');
                }
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

// ============================================
// PHANTOM SPEED CONTROL
// ============================================
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

    // Exposer Toast globalement (utilisé par multi.js et d'autres scripts)
    window.AppToast = Toast;

    // Setup
    Toast.init();
    setupModals();
    setupConnectionHandlers();

    // Init router
    Router.init();

    // ?game=&role=&streamer= → connexion directe côté sandbox (URLs partagées)
    // ?join= → browse page pour rejoindre via le formulaire
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('game')) {
        Router.showPage('sandbox');
        Toast.info('🎮 Mode Bataille Twitch — connexion en cours...');
    } else if (urlParams.get('join')) {
        Router.showPage('browse');
    }

    // Naviguer vers /battle quand multi.js crée/rejoint une partie depuis browse
    window.addEventListener('multiNavigateSandbox', (e) => {
        const { role, gameId } = e.detail;
        Router.showPage('battle');

        // Afficher la bannière pre-ready avec le code de partie
        const preBanner = document.getElementById('multi-pre-ready-banner');
        const codeEl    = document.getElementById('sandbox-game-code');
        if (preBanner && codeEl) {
            codeEl.textContent      = gameId;
            preBanner.style.display = 'block';
        }

        // Changer le titre de la page
        const titleEl = document.querySelector('#page-sandbox .sandbox__title');
        if (titleEl) titleEl.textContent = '⚔ Bataille Twitch';

        // Bouton copier le code
        document.getElementById('sandbox-game-code-copy')?.addEventListener('click', () => {
            navigator.clipboard.writeText(gameId).then(() => Toast.success('Code copié !'));
        });

        const msg = role === 'host'
            ? `Partie ${gameId} créée — en attente de l'adversaire`
            : `Connexion à la partie ${gameId}...`;
        Toast.info(`🎮 ${msg}`);
    });

    // Restore connections
    await twitch?.restore();

    // Écouter les votes Twitch
    if (twitch) {
        twitch.onVote = (voteContext) => {
            // ---- Mode problèmes ----
            if (AppState.gameMode === 'problems' && problemsManager.isActive) {
                const accepted = problemsManager.receiveVote(voteContext);
                console.log(`🗳️ Vote problème: ${voteContext.move} →`, accepted ? 'accepté' : 'ignoré');
                return;
            }

            // ---- Mode Bataille Twitch multijoueur ----
            if (window.multiplayerManager?.gameId && window.playerColor) {
                const channel  = (voteContext.channel || '').toLowerCase();
                const myColor  = window.playerColor; // 'white' ou 'black'
                const myChannel = myColor === 'white'
                    ? (window.streamer1Channel || '').toLowerCase()
                    : (window.streamer2Channel || '').toLowerCase();

                // Chaque page n'accepte que les votes de son propre channel
                if (channel !== myChannel) {
                    return;
                }

                // Et seulement si c'est effectivement son tour
                if (!gameEngine.isMyTurnInMulti?.()) {
                    return;
                }
            }

            // ---- Comportement normal ----
            if (voting.isOpen) {
                voting.addVote(voteContext.username, voteContext.move);
            }
        };
    }

    // ---- Événement Bataille Twitch prête ----
    window.addEventListener('multiGameReady', (e) => {
        // Masquer la bannière d'attente (showActiveBanner prend le relais)
        const preBanner = document.getElementById('multi-pre-ready-banner');
        if (preBanner) preBanner.style.display = 'none';

        const { players, settings } = e.detail;

        // Appliquer les paramètres de la partie (browse form ou defaults)
        const timerDuration  = window._browseTimerDuration || settings?.timerDuration || AppState.config.timerDuration;
        const majorityMode   = window._browseMajorityMode  !== undefined ? window._browseMajorityMode  : AppState.config.majorityMode;
        const followersOnly  = window._browseFollowersOnly !== undefined ? window._browseFollowersOnly : AppState.config.followersOnly;
        const subsOnly       = window._browseSubsOnly      !== undefined ? window._browseSubsOnly      : AppState.config.subsOnly;
        delete window._browseTimerDuration;
        delete window._browseMajorityMode;
        delete window._browseFollowersOnly;
        delete window._browseSubsOnly;

        // Configurer l'état pour le mode ChatVsChat
        AppState.gameMode              = 'chatVsChat';
        AppState.players.chat1         = players.white;
        AppState.players.chat2         = players.black;
        AppState.config.timerEnabled   = true;
        AppState.config.timerDuration  = timerDuration;
        AppState.config.majorityMode   = majorityMode;
        AppState.config.followersOnly  = followersOnly;
        AppState.config.subsOnly       = subsOnly;

        // Orienter l'échiquier selon le rôle
        const myColor = window.playerColor;
        if (myColor === 'black' && gameEngine.board) {
            gameEngine.board.orientation('black');
        }

        // Démarrer la partie
        if (!SandboxPage.initialized) {
            gameEngine.init({
                timerEnabled:  true,
                timerDuration: timerDuration,
                wheelDuration: AppState.config.wheelDuration,
                majorityMode:  majorityMode,
                singleVote:    AppState.config.singleVote
            });
            SandboxPage.initialized = true;
        } else {
            gameEngine.config.timerEnabled  = true;
            gameEngine.config.timerDuration = timerDuration;
            gameEngine.config.majorityMode  = majorityMode;
        }

        gameEngine.startGame();

        // Rendre le Toast accessible au multiplayerManager
        window.AppToast = Toast;

        Toast.success(`⚔ Bataille lancée ! ${players.white} (⬜) vs ${players.black} (⬛)`);
        console.log(`🎮 Partie multi démarrée : ${players.white} vs ${players.black}`);
    });
    if (sessionStorage.getItem('autoStart') === '1') {
        sessionStorage.removeItem('autoStart');
        // Attendre que SandboxPage soit init via le Router
        setTimeout(() => SandboxPage.applyConfigAfterReload(), 100);
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

// Exposer les objets critiques pour les scripts non-modules (multi.js, phantom.js, etc.)
window.gameEngine       = gameEngine;
window.votingSystem     = voting;
window.appTimer         = timer;
window.AppState         = AppState;

// Exports ES module
export { AppState, Router, SandboxPage, BrowsePage, Toast, Storage, gameEngine, timer, voting, problemsManager };