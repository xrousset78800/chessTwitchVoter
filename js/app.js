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
import rushManager from './core/rushManager.js';
import twitch from './managers/twitch.js';
import twitchAuth from './core/twitchAuth.js';
import { matchLegalMove } from './utils/moveMatch.js';
import lobby, { normalizeLogin } from './core/lobby.js';

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

// Réglages d'origine : une nouvelle partie repart de là, comme après un rechargement
const APP_DEFAULTS = JSON.stringify({
    gameMode: AppState.gameMode, config: AppState.config, players: AppState.players, problems: AppState.problems
});
function resetAppStateDefaults() {
    const d = JSON.parse(APP_DEFAULTS);
    AppState.gameMode = d.gameMode;
    ['config', 'players', 'problems'].forEach(k => {
        Object.keys(AppState[k]).forEach(key => delete AppState[k][key]);
        Object.assign(AppState[k], d[k]);
    });
}

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
        // Une route préconfigurée ne remplace pas les réglages du sandbox
        if (GameSession.current) return;
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
// SESSION DE JEU (routes préconfigurées)
// ============================================
const SESSION_KEY = 'phantom_session';
const MONO_LOBBY_SECONDS = 120;

const tr = (key, params) => window.i18n.t(key, params);

/**
 * Une partie lancée vit sur #/game (ou sur le lien de son salon Multi), indépendamment
 * des pages de réglage : on peut naviguer ailleurs, elle continue, et le lien
 * "Partie en cours" de la nav y ramène. Seuls "Terminer" ou un nouveau lancement l'arrêtent.
 */
// Puzzle Rush : temps pour voter, un classement par mode ('0' = illimité, le premier coup valide est joué)
const RUSH_MODES = ['0', '30', '60', '120'];
const rushMode = () => {
    const m = String(AppState.config.rushTimer ?? '0');
    return RUSH_MODES.includes(m) ? m : '0';
};
const rushModeLabel = (m) => ({ '0': tr('rushPage.modeUnlimited'), '30': '30 s', '60': '1 min', '120': '2 min' }[m] || m);

const GameSession = {
    current: null,    // Session d'une route préconfigurée (null pour une partie libre)
    running: false,   // Une partie a été lancée dans cette page
    hash: '#/game',   // Où la retrouver
    liveMode: null,   // Mode de la partie en cours (l'écran Nouveau peut changer AppState.gameMode)

    /** Même mécanique que "Appliquer" : on repart d'un état propre */
    launch(session) {
        this.restart('#/game', { session, start: true });
    },

    /** Avant de lancer une partie par-dessus celle en cours */
    confirmReplace() {
        return !this.running || window.confirm(tr('game.replaceConfirm'));
    },

    /** Arrête la partie en cours et revient à une page de réglage */
    quit(hash) {
        this.restart(hash);
    },

    /**
     * Arrête tout ce qu'une partie a mis en route et remet les réglages tels qu'au chargement.
     * Remplace l'ancien rechargement de page : la connexion Bluetooth au Phantom, qui ne
     * peut pas être rétablie sans un clic de l'utilisateur, survit ainsi aux changements de partie.
     */
    reset() {
        SandboxPage.fullReset();
        rushManager.stop?.();
        problemsManager.reset?.();
        PresetGame.stopCountdown();
        PresetGame.setBanner(null);
        Object.assign(lobby, new lobby.constructor());
        const roster = document.getElementById('roster-panel');
        if (roster) roster.style.display = 'none';
        MultiRoom.leave();
        GameAnnouncer.stop();
        if (window.gameEngine) {
            gameEngine.session = null;
            gameEngine.onGameEnd = null;
            gameEngine.board?.orientation('white');
            gameEngine.hideWheel?.();
        }
        [...document.body.classList].forEach(c => {
            if (c.startsWith('preset-') || c.startsWith('problem-') || ['multi-active', 'randomWheel', 'showTimer', 'accepting-moves'].includes(c)) {
                document.body.classList.remove(c);
            }
        });

        this.clear();
        sessionStorage.removeItem('autoStart');
        this.running = false;
        this.liveMode = null;
        this.hash = '#/game';
        resetAppStateDefaults();
        Storage.loadConfig();
    },

    /** Équivalent d'un rechargement de page, sans recharger */
    restart(hash, { session = null, start = false } = {}) {
        this.reset();
        if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        if (start) sessionStorage.setItem('autoStart', '1');
        this.restore();
        sessionStorage.removeItem('autoStart');
        if (window.gameEngine?.config && SandboxPage.initialized) {
            const c = AppState.config;
            Object.assign(gameEngine.config, {
                timerEnabled: c.timerEnabled, timerDuration: c.timerDuration, wheelDuration: c.wheelDuration,
                pauseAfterEnd: c.pauseAfterEnd, majorityMode: c.majorityMode, singleVote: c.singleVote
            });
            timer.setDuration?.(c.timerDuration);
        }
        if (window.location.hash !== hash) history.pushState(null, '', hash);
        Router.handleRoute();
        updateConnectionUI();
        if (start) {
            SandboxPage.applyConfigAfterReload();
            GameAnnouncer.start();
        }
    },

    restore() {
        const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
        this.running = sessionStorage.getItem('autoStart') === '1';
        if (saved && this.running) {
            this.activate(saved);
        } else if (saved) {
            // F5 pendant une partie : retour à la page de réglage de la route
            sessionStorage.removeItem(SESSION_KEY);
            if (window.location.hash.startsWith('#/game')) {
                history.replaceState(null, '', `#/${saved.route}`);
            }
        }
        if (this.running) this.liveMode = AppState.gameMode;
    },

    activate(session) {
        this.current = session;
        AppState.gameMode = session.gameMode;
        Object.assign(AppState.config, session.config);
        document.body.classList.add(`preset-${session.route}`, 'preset-game');
    },

    clear() {
        sessionStorage.removeItem(SESSION_KEY);
        this.current = null;
    }
};

// ============================================
// ROUTER (SPA Navigation)
// ============================================
// Pages de réglage regroupées sous Nouveau
const NEW_TABS = ['sandbox', 'mono', 'multi', 'rush'];

const Router = {
    routes: {
        '/': 'landing',
        '/sandbox': 'sandbox',
        '/game': 'game',
        '/browse': 'browse',
        '/live': 'live',
        '/tournament': 'tournament',
        '/rush': 'rush',
        '/mono': 'mono',
        '/multi': 'multi',
    },
    started: false,

    init() {
        window.addEventListener('hashchange', () => this.handleRoute());

        document.querySelectorAll('[data-navigate]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.hash = el.dataset.navigate;
            });
        });

        this.handleRoute();
        this.started = true;
    },

    handleRoute() {
        const hash = window.location.hash.slice(1) || '/';
        const [path, query] = hash.split('?');
        const room = MultiRoom.parse(path, query);

        if (room) {
            // Retour sur le salon en cours : la partie a continué pendant ce temps
            if (MultiRoom.isSame(room)) {
                this.showPage('game');
                return;
            }
            // Entrer dans un autre salon : état propre
            if (this.started) GameSession.reset();
            MultiRoom.prepare(room);
            GameSession.running = true;
            GameSession.liveMode = AppState.gameMode;
            GameSession.hash = '#' + hash;
            this.showPage('game');
            // Au démarrage, initApp entre dans le salon après la restauration de Twitch
            if (this.started) MultiRoom.enter();
            return;
        }

        let pageName = this.routes[path] || 'landing';
        // #/game sans partie (F5, lien partagé) : écran de lancement
        if (pageName === 'game' && !GameSession.running) {
            history.replaceState(null, '', '#/sandbox');
            pageName = 'sandbox';
        }

        this.showPage(pageName);
    },

    showPage(pageName) {
        // /game réutilise page-sandbox (échiquier) : body.game-mode cache toute la configuration
        const actualPage = pageName === 'game' ? 'sandbox' : pageName;

        // Cacher toutes les pages
        document.querySelectorAll('.page').forEach(p => p.classList.remove('is-active'));

        // Activer/désactiver les variantes de la page échiquier sur le body
        document.body.classList.toggle('game-mode', pageName === 'game');
        // Nouveau affiche toujours l'écran de lancement : la partie, elle, est sur #/game
        document.body.classList.toggle('sandbox-launch', pageName === 'sandbox');
        // L'écran Nouveau a pu changer de mode entre-temps : la partie garde le sien
        if (pageName === 'game' && GameSession.liveMode && AppState.gameMode !== GameSession.liveMode) {
            AppState.gameMode = GameSession.liveMode;
            SandboxPage.syncUIFromState?.();
        }
        SandboxPage.closeSettings?.(false);
        SandboxPage.applyPageVariant(pageName);

        // Afficher la page cible
        const target = document.getElementById(`page-${actualPage}`);
        if (target) {
            target.classList.add('is-active');
            AppState.currentPage = pageName;
        }

        this.placeNewTabs(pageName, target);

        // Mettre à jour la nav
        const gameLink = document.getElementById('nav-game');
        if (gameLink) {
            gameLink.hidden = !GameSession.running;
            gameLink.dataset.navigate = GameSession.hash.slice(1);
            gameLink.classList.toggle('is-active', pageName === 'game');
        }
        document.querySelectorAll('.nav__link:not(#nav-game)').forEach(link => {
            const linkPath = link.dataset.navigate;
            // Mono, Multi et Puzzle Rush sont des onglets de Nouveau (/sandbox)
            const activePage = NEW_TABS.includes(pageName) ? 'sandbox' : pageName;
            link.classList.toggle('is-active',
                linkPath === '/' + activePage || (linkPath === '/' && pageName === 'landing')
            );
        });

        // Init spécifique à la page
        if (pageName === 'sandbox' || pageName === 'game') {
            SandboxPage.init();
        } else if (pageName === 'browse') {
            BrowsePage.init();
        } else if (pageName === 'live') {
            LivePage.init();
        } else if (pageName === 'tournament') {
            TournamentPage.init();
        } else if (pageName === 'rush') {
            RushPage.init();
        } else if (pageName === 'mono') {
            MonoPage.init();
        } else if (pageName === 'multi') {
            MultiPage.init();
        }
    },

    /** Les onglets de Nouveau suivent la page de réglage affichée */
    placeNewTabs(pageName, target) {
        const tabs = document.getElementById('new-tabs');
        if (!tabs || !target || !NEW_TABS.includes(pageName)) return;
        if (pageName === 'sandbox') target.querySelector('#sandbox-setup')?.before(tabs);
        else target.querySelector('.preset')?.prepend(tabs);
        tabs.querySelectorAll('.new-tab').forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.newTab === pageName);
        });
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
/** Modes qui s'appuient sur problemsManager (échiquier piloté par les puzzles) */
function isPuzzleMode(mode = AppState.gameMode) {
    return mode === 'problems' || mode === 'rush';
}

/**
 * body.wheel-mode : la roue n'est visible pendant le vote que dans ce cas.
 * Majorité active ou mode puzzle (toujours majorité) → pas de roue.
 */
function syncWheelModeClass() {
    const wheelMode = !AppState.config.majorityMode && !isPuzzleMode();
    document.body.classList.toggle('wheel-mode', wheelMode);
    if (!wheelMode) window.gameEngine?.hideWheel?.();
}

const SandboxPage = {
    initialized: false,
    problemsInitialized: false,
    rushUIReady: false,

    /** Titre et bouton retour selon la route (/sandbox, /game) */
    applyPageVariant(pageName) {
        const titleEl = document.querySelector('#page-sandbox .sandbox__title');
        const backBtn = document.getElementById('sandbox-back');
        if (pageName === 'game') {
            const titles = { rush: '🔥 Puzzle Rush', problems: '🧩 Problèmes', mono: '👥 Mono', multi: '⚔ Multi', sandbox: '🧪 Partie libre' };
            const route = GameSession.current?.route;
            if (titleEl) titleEl.textContent = titles[AppState.gameMode] || '♟ Partie';
            // La flèche ramène aux réglages sans arrêter la partie (lien "Partie en cours" pour revenir)
            if (backBtn) backBtn.dataset.navigate = route ? `/${route}` : '/sandbox';
        } else if (pageName === 'sandbox') {
            if (titleEl) titleEl.textContent = '🧪 Sandbox';
            if (backBtn) backBtn.dataset.navigate = '/';
        }
    },

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
    syncWheelModeClass();
    twitch.settings.subsOnly = !!AppState.config.subsOnly;

    if (gameEngine.updateVotingIndicator) gameEngine.updateVotingIndicator();

    if (AppState.gameMode === 'mono') {
        PresetGame.startMono();
        return;
    }

    if (AppState.gameMode === 'rush') {
        if (!this.problemsInitialized) {
            const success = await this.initProblemsMode();
            if (!success) { Toast.error('Erreur initialisation Puzzle Rush'); return; }
        }
        problemsManager.clearThemes();
        problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
        AppState.problems.isActive = true;
        this.setupRushUI();
        rushManager.config.mode = rushMode();
        await rushManager.fetchChannelRecord();
        rushManager.start({ startRating: AppState.config.rushStartRating || 600, mode: rushMode() });
        Toast.success('🔥 Puzzle Rush lancé ! 3 erreurs et c\'est fini.');
        return;
    }

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
            // Le suivant est enchaîné par problemsManager.startPauseTimer()
        };
        
        // Problème échoué
        problemsManager.onProblemFailed = (problem) => {
            console.log('💔 Échoué');
            this.showProblemFeedback('failed');
            // Le suivant est enchaîné par problemsManager.startPauseTimer()
        };
        
        // Changement d'état
        problemsManager.onStateChange = (state) => {
            this.updateProblemStateUI(state);
        };
    },
    
    // ========== PUZZLE RUSH : HUD + ÉCRAN DE FIN ==========

    setupRushUI() {
        if (this.rushUIReady) return;
        this.rushUIReady = true;

        rushManager.onUpdate = (state) => this.updateRushHUD(state);
        rushManager.onEnd    = (result) => this.showRushEnd(result);

        document.getElementById('rush-restart-btn')?.addEventListener('click', () => this.restartRush());
        document.getElementById('rush-end-close')?.addEventListener('click', () => {
            document.getElementById('rush-end')?.classList.remove('is-active');
        });
        document.getElementById('rush-login-btn')?.addEventListener('click', () => {
            window.twitchAuth?.login();
        });
    },

    restartRush() {
        document.getElementById('rush-end')?.classList.remove('is-active');
        rushManager.stop();
        gameEngine.hideWheel?.();
        rushManager.start({ startRating: AppState.config.rushStartRating || 600 });
        Toast.info('🔥 Nouveau run !');
    },

    updateRushHUD(state) {
        const banner = document.getElementById('rush-banner');
        if (!banner) return;

        banner.style.display = (state.active || state.ended) ? '' : 'none';
        const title = banner.querySelector('.rush-banner__title');
        if (title) title.textContent = `🔥 Puzzle Rush · ${rushModeLabel(rushManager.config.mode)}`;

        const hearts = Array.from({ length: state.maxStrikes }, (_, i) =>
            `<span class="rush-heart ${i < state.livesLeft ? '' : 'rush-heart--lost'}">${i < state.livesLeft ? '❤️' : '🖤'}</span>`
        ).join('');

        const set = (id, value) => { const el = document.getElementById(id); if (el) el.innerHTML = value; };
        set('rush-score',  state.score);
        set('rush-hearts', hearts);
        set('rush-rating', state.active ? `~${state.targetRating}` : (state.maxRating ? `max ${state.maxRating}` : '—'));

        const best = state.record?.best?.score;
        set('rush-record', best != null ? `🏆 ${best}` : '🏆 —');

        banner.classList.toggle('rush-banner--ended', state.ended);
    },

    showRushEnd(result) {
        const overlay = document.getElementById('rush-end');
        if (!overlay) return;

        const set = (id, value) => { const el = document.getElementById(id); if (el) el.innerHTML = value; };
        const mins = Math.floor(result.durationMs / 60000);
        const secs = Math.floor((result.durationMs % 60000) / 1000);

        set('rush-end-score',    result.score);
        set('rush-end-rating',   result.maxRating || '—');
        set('rush-end-duration', `${mins}:${String(secs).padStart(2, '0')}`);

        let status, cls = '';
        const loggedIn = !!window.twitchAuth?.isLoggedIn;
        if (!loggedIn) {
            status = 'Connecte-toi avec Twitch pour enregistrer le record de ta chaîne.';
            cls = 'rush-end__status--muted';
        } else if (result.error) {
            status = `Score non enregistré : ${result.error}`;
            cls = 'rush-end__status--error';
        } else if (result.score === 0) {
            status = 'Aucun puzzle résolu, rien à enregistrer.';
            cls = 'rush-end__status--muted';
        } else if (result.isNewRecord) {
            status = '🏆 Nouveau record de la chaîne !';
            cls = 'rush-end__status--record';
        } else {
            const best = result.record?.best?.score;
            status = best != null ? `Record de la chaîne : ${best}` : 'Score enregistré.';
        }
        const statusEl = document.getElementById('rush-end-status');
        if (statusEl) {
            statusEl.textContent = status;
            statusEl.className = `rush-end__status ${cls}`.trim();
        }

        const loginBtn = document.getElementById('rush-login-btn');
        if (loginBtn) loginBtn.style.display = loggedIn ? 'none' : '';

        overlay.classList.add('is-active');
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
            if (AppState.gameMode === 'mono') {
                PresetGame.rematch();
            } else if (AppState.gameMode === 'rush' && (rushManager.active || rushManager.ended)) {
                this.restartRush();
            } else if (AppState.gameMode === 'problems' && problemsManager.isActive) {
                problemsManager.loadRandomProblem();
                Toast.info('Nouveau problème chargé');
            } else {
                gameEngine.reset();
                Toast.success('Échiquier réinitialisé');
            }
        });

        document.getElementById('btn-snap-center')?.addEventListener('click', async () => {
            if (window.phantomChessboard?.isConnected) {
                await window.phantomChessboard.snapToCenter();
                Toast.success('Centrage des pièces demandé');
            }
        });

        document.getElementById('btn-calibrate')?.addEventListener('click', async () => {
            if (window.phantomChessboard?.isConnected) {
                Toast.info('Recalibration du Phantom : arrêt, calibration puis remise en place des pièces');
                const fen = gameEngine.chess?.fen();
                await window.phantomChessboard.recalibrate(() => fen);
                Toast.success('Phantom recalibré');
            }
        });

        document.getElementById('problem-pause')?.addEventListener('change', (e) => {
            AppState.config.pauseAfterEnd = parseInt(e.target.value) || 5;
            if (window.problemsManager) {
                window.problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
            }
        });

        document.getElementById('rush-pause')?.addEventListener('change', (e) => {
            AppState.config.pauseAfterEnd = parseInt(e.target.value) || 5;
            if (window.problemsManager) {
                window.problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
            }
        });

        document.getElementById('rush-start-rating')?.addEventListener('change', (e) => {
            const v = parseInt(e.target.value) || 600;
            AppState.config.rushStartRating = Math.min(3000, Math.max(400, v));
            e.target.value = AppState.config.rushStartRating;
        });
        // Undo
        document.getElementById('btn-undo')?.addEventListener('click', () => {
            if (isPuzzleMode()) {
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
        const renderWheelStyle = () => {
            document.getElementById('wheel-style-label').textContent = tr(`wheelStyle.${gameEngine.wheelStyle}`);
        };
        renderWheelStyle();
        window.addEventListener('languageChanged', renderWheelStyle);
        document.getElementById('btn-wheel-style')?.addEventListener('click', () => {
            gameEngine.setWheelStyle(gameEngine.wheelStyle === 'band' ? 'classic' : 'band');
            renderWheelStyle();
        });

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
                if (isPuzzleMode(option.dataset.mode) && !problemsManager.isLoaded()) {
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
            syncWheelModeClass();
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
        
        this.setupSetupScreen();

        // ========== INTERCEPTION DES COUPS EN MODE PROBLÈME ==========
        this.setupProblemsInterception();
    },

    /** Écran de lancement, modale ⚙ en cours de partie et menu Phantom de la barre d'outils */
    setupSetupScreen() {
        const setup = document.getElementById('sandbox-setup');
        const menu = document.getElementById('phantom-menu');
        const menuBtn = document.getElementById('btn-phantom-menu');

        document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettings());
        document.getElementById('btn-settings-close')?.addEventListener('click', () => this.closeSettings());
        setup?.addEventListener('click', (e) => {
            if (e.target === setup) this.closeSettings();
        });

        const setMenu = (open) => {
            menu?.classList.toggle('is-open', open);
            menuBtn?.setAttribute('aria-expanded', String(open));
        };
        menuBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            setMenu(!menu.classList.contains('is-open'));
        });
        // Une action lancée ou un clic ailleurs referme le menu
        menu?.querySelectorAll('.phantom-action').forEach(btn => btn.addEventListener('click', () => setMenu(false)));
        document.addEventListener('click', (e) => {
            if (menu && !menu.contains(e.target)) setMenu(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            setMenu(false);
            if (setup?.classList.contains('is-open')) this.closeSettings();
        });

        // Terminer la partie : seul moyen (avec un nouveau lancement) de l'arrêter
        document.getElementById('btn-quit-game')?.addEventListener('click', () => {
            if (!window.confirm(tr('game.quitConfirm'))) return;
            const route = GameSession.current?.route;
            GameSession.quit(route ? `#/${route}` : '#/sandbox');
        });
    },

    openSettings() {
        document.getElementById('sandbox-setup')?.classList.add('is-open');
    },

    /** Ferme la modale ⚙ et applique les réglages à la partie en cours */
    closeSettings(apply = true) {
        const setup = document.getElementById('sandbox-setup');
        if (!setup?.classList.contains('is-open')) return;
        setup.classList.remove('is-open');
        if (apply) this.applyLiveSettings();
    },

    applyLiveSettings() {
        if (['sandbox', 'game'].includes(AppState.currentPage)) {
            Object.assign(gameEngine.config, {
                timerEnabled: AppState.config.timerEnabled,
                timerDuration: AppState.config.timerDuration,
                wheelDuration: AppState.config.wheelDuration,
                majorityMode: AppState.config.majorityMode,
                singleVote: AppState.config.singleVote
            });
            twitch.settings.subsOnly = !!AppState.config.subsOnly;
            syncWheelModeClass();
            gameEngine.updateVotingIndicator?.();
            Storage.saveConfig();
        }
    },

    setupProblemsInterception() {
        const originalOnDrop = gameEngine.onDrop?.bind(gameEngine);
        
        gameEngine.onDrop = (source, target, piece, newPos, oldPos, orientation) => {
            // Si mode problèmes actif, déléguer au problemsManager
            if (isPuzzleMode() && problemsManager.isActive) {
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
    if (!GameSession.confirmReplace()) return;
    // Une partie libre remplace aussi une partie préconfigurée en cours
    GameSession.clear();
    Storage.saveConfig();
    GameSession.restart('#/game', { start: true });
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
        syncWheelModeClass();

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

        const rushRating = document.getElementById('rush-start-rating');
        if (rushRating) rushRating.value = AppState.config.rushStartRating || 600;

        ['problem-pause', 'rush-pause'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = AppState.config.pauseAfterEnd || 5;
        });

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
        // Sans temps pour voter, pas de minuteur à côté de l'échiquier
        document.body.classList.toggle('no-vote-timer', !AppState.config.timerEnabled);
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
        ['btn-sync', 'btn-reset-sync', 'btn-snap-center', 'btn-calibrate', 'btn-game-end'].forEach(id => {
            document.getElementById(id)?.toggleAttribute('disabled', !phantomConnected);
        });
        document.body.classList.toggle('phantom-connected', !!phantomConnected);
        const status = document.querySelector('.phantom-menu__status');
        if (status) {
            status.dataset.i18n = phantomConnected ? 'setup.phantomOn' : 'setup.phantomOff';
            status.textContent = tr(status.dataset.i18n);
            status.classList.toggle('phantom-menu__status--off', !phantomConnected);
        }
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

        if (config.fen && !isPuzzleMode(config.gameMode)) {
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
            document.getElementById('browse-refresh-btn')?.addEventListener('click', () => {
                this.socket?.emit('getGames');
            });
            document.getElementById('rush-records-refresh')?.addEventListener('click', () => {
                this.loadRushRecords();
            });
            this.bindRushModes(document.getElementById('page-browse'));
            this.initialized = true;
        } else {
            this.socket?.emit('getGames');
        }
        this.loadRushRecords();
    },

    // ========== PUZZLE RUSH : RECORDS ==========

    rushModes: {},   // mode affiché par tableau de records

    /** Onglets Illimité / 30 s / 1 min / 2 min au-dessus d'un tableau de records */
    bindRushModes(root, onChange) {
        root?.querySelectorAll('.rush-modes').forEach(bar => {
            const target = bar.dataset.records;
            const select = (mode) => {
                bar.querySelectorAll('[data-rush-mode]').forEach(b => {
                    const on = b.dataset.rushMode === mode;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-pressed', on);
                });
                this.rushModes[target] = mode;
            };
            select(this.rushModes[target] || '0');
            bar.addEventListener('click', (e) => {
                const b = e.target.closest('[data-rush-mode]');
                if (!b) return;
                select(b.dataset.rushMode);
                this.loadRushRecords(target);
                onChange?.(b.dataset.rushMode);
            });
        });
    },

    async loadRushRecords(containerId = 'rush-records') {
        const container = document.getElementById(containerId);
        if (!container) return;
        const mode = this.rushModes[containerId] || '0';
        try {
            const { RushManager } = await import('./core/rushManager.js');
            const records = await RushManager.fetchLeaderboard(50, mode);
            if ((this.rushModes[containerId] || '0') !== mode) return; // un autre onglet a été choisi entre-temps
            this.renderRushRecords(records, container);
        } catch (e) {
            console.warn('🔥 Records indisponibles:', e.message);
            container.textContent = '';
            const msg = document.createElement('div');
            msg.className = 'rush-records__empty';
            msg.textContent = `Records indisponibles (${e.message})`;
            container.appendChild(msg);
        }
    },

    renderRushRecords(records, container) {

        const me   = (window.twitchAuth?.user?.login || '').toLowerCase();
        const mine = me ? records.find(r => r.login === me) : null;

        // Encart "Ton record" (visible seulement si connecté à Twitch)
        const myBox = document.getElementById('rush-my-record');
        if (myBox) {
            myBox.style.display = me ? '' : 'none';
            const v = document.getElementById('rush-my-record-value');
            if (v) v.textContent = mine ? `${mine.best.score} puzzle${mine.best.score > 1 ? 's' : ''}` : 'Aucun run';
        }

        if (!records.length) {
            container.innerHTML = `
                <div class="rush-records__empty">
                    Aucun record pour l'instant.<br>
                    Lance un run pour inscrire ta chaîne !
                </div>`;
            return;
        }

        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';
        const medals = ['🥇', '🥈', '🥉'];

        container.innerHTML = records.slice(0, 20).map((r, i) => {
            const name   = r.displayName || r.login;
            const avatar = r.avatar
                ? `<img class="rush-list__avatar" src="${esc(r.avatar)}" alt="">`
                : `<span class="rush-list__avatar">${esc(name[0].toUpperCase())}</span>`;
            return `
                <div class="rush-list__row ${r.login === me ? 'rush-list__row--me' : ''}">
                    <span class="rush-list__rank">${medals[i] || i + 1}</span>
                    ${avatar}
                    <span class="rush-list__name">
                        <a href="https://twitch.tv/${esc(r.login)}" target="_blank" rel="noopener">${esc(name)}</a>
                        <span class="rush-list__meta">rating max ${r.best.maxRating || '—'} · ${fmtDate(r.best.at)}</span>
                    </span>
                    <span class="rush-list__score" title="${r.runs || 1} run(s)">${r.best.score}</span>
                </div>`;
        }).join('');
    },

    setupSocket() {
        if (typeof io === 'undefined') return;

        // Le serveur Socket.IO est servi par la même origine que la page
        this.socket = io({ transports: ['websocket', 'polling'] });

        this.socket.on('connect', () => {
            this.socket.emit('subscribeBrowse');
        });

        this.socket.on('gamesList', (games) => this.renderGames(games));
        this.socket.on('gamesListUpdated', (games) => this.renderGames(games));
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
                    <p class="empty-state__desc">${tr('browsePage.empty')}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = active.map(game => {
            const elapsed    = game.startedAt ? Math.floor((Date.now() - game.startedAt) / 60000) + ' min' : '';
            const statusClass = game.status === 'playing' ? 'game-card__status--playing' : 'game-card__status--waiting';
            const statusLabel = game.status === 'playing' ? '● En cours' : '⏳ En attente';

            const mode = game.mode || 'multi';
            if (mode !== 'multi') return this.renderSoloCard(game, mode, statusClass, statusLabel, elapsed);
            return `
                <div class="game-card" data-game-id="${game.gameId}">
                    <div class="game-card__header">
                        <span class="game-card__mode">⚔ Multi</span>
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
                    </div>
                </div>
            `;
        }).join('');
    },

    /** Partie d'une seule chaîne : Mono, Puzzle Rush, partie libre… */
    renderSoloCard(game, mode, statusClass, statusLabel, elapsed) {
        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const labels = { rush: '🔥 Puzzle Rush', problems: '🧩 Problèmes', mono: '👥 Mono' };
        const count  = game.moveCount || 0;
        const progress = mode === 'rush'
            ? `${count} puzzle${count > 1 ? 's' : ''}`
            : `${count} coup${count > 1 ? 's' : ''}`;
        const players = game.players != null ? `${game.players} ${tr('browsePage.players')}` : tr('browsePage.chat');
        const host = game.host
            ? `<a href="https://twitch.tv/${esc(game.host)}" target="_blank" rel="noopener">${esc(game.host)}</a>`
            : esc(tr('browsePage.anonymous'));
        return `
            <div class="game-card" data-game-id="${esc(game.gameId)}">
                <div class="game-card__header">
                    <span class="game-card__mode">${labels[mode] || '♟ ' + esc(tr('newTabs.free'))}</span>
                    <span class="game-card__status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="game-card__players">
                    <div class="game-card__player">
                        <div class="game-card__avatar">♙</div>
                        <div>
                            <div class="game-card__player-name">${host}</div>
                            <div class="game-card__player-rating">${esc(players)}</div>
                        </div>
                    </div>
                </div>
                <div class="game-card__footer">
                    <span>${progress}</span>
                    ${elapsed ? `<span>${elapsed}</span>` : ''}
                </div>
            </div>
        `;
    }
};

// ============================================
// ANNONCE DE LA PARTIE (liste de Parcourir)
// ============================================
/**
 * Les parties d'une seule chaîne n'existent que dans le navigateur du streamer :
 * on en publie un résumé au serveur pour qu'elles apparaissent dans Parcourir.
 * (Les salons Multi sont déjà suivis par le serveur.)
 */
const GameAnnouncer = {
    socket: null,
    last: null,

    start() {
        if (typeof io === 'undefined' || this.socket) return;
        this.socket = io({ transports: ['websocket', 'polling'] });
        this.socket.on('connect', () => { this.last = null; this.send(); });
        this.intervalId = setInterval(() => this.send(), 4000);
    },

    /** Plus de partie : le serveur la retire de Parcourir à la déconnexion */
    stop() {
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.socket?.disconnect();
        this.socket = null;
        this.last = null;
    },

    snapshot() {
        const mode = GameSession.liveMode || AppState.gameMode;
        return {
            mode,
            host: normalizeLogin(twitchAuth.user?.login || twitch.channel || ''),
            moveCount: mode === 'rush' ? rushManager.score : (gameEngine.moveHistory?.length || 0),
            players: lobby.active ? lobby.players.size : null,
            waiting: lobby.active && lobby.open
        };
    },

    send() {
        if (!this.socket?.connected) return;
        const data = this.snapshot();
        const key = JSON.stringify(data);
        if (key === this.last) return;
        this.last = key;
        this.socket.emit('game:announce', data);
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
            // Pas de session Twitch → redirection OAuth (la page change)
            if (!twitchAuth.isLoggedIn) {
                twitchAuth.login();
                return;
            }

            // Session active → déconnexion complète (chat + révocation du token)
            try {
                await twitch.logout();
                updateConnectionUI();
                Toast.info('Déconnecté de Twitch');
            } catch (e) {
                Toast.error('Déconnexion Twitch échouée');
            }
        });
    });

    // Changements de session OAuth (login, expiration, erreur)
    window.addEventListener('twitchAuthChange', async (e) => {
        const { reason, user, error } = e.detail || {};
        twitch.updateUI();
        updateConnectionUI();

        if (reason === 'login' && user) {
            // Le chat est rejoint par twitch.restore() dans initApp
            Toast.success(`Connecté en tant que ${user.displayName}`);
        } else if (reason === 'expired') {
            await twitch.disconnect();
            Toast.warning('Session Twitch expirée, reconnecte-toi');
        } else if (reason === 'error') {
            Toast.error(`Connexion Twitch refusée : ${error || 'erreur inconnue'}`);
        }
    });

    setupPhantomModal();
}

/**
 * Modale Phantom : point d'entrée unique. Le badge en haut à droite l'ouvre, et tant que
 * le Phantom n'est pas connecté, les menus « Phantom ▾ » des pages l'ouvrent au lieu
 * d'afficher leurs options.
 */
function setupPhantomModal() {
    const overlay = document.getElementById('modal-phantom');
    const btn = document.getElementById('pmConnect');
    if (!overlay || !btn) return;
    const t = (k, fb) => { const v = window.i18n?.t?.(k); return v && v !== k ? v : fb; };
    const supported = !!navigator.bluetooth;

    const render = () => {
        const on = !!window.phantomChessboard?.isConnected;
        document.getElementById('pmUnsupported').hidden = supported || on;
        const status = document.getElementById('pmStatus');
        status.textContent = on ? t('phantomModal.connected', 'Phantom connecté') : '';
        status.classList.toggle('is-on', on);
        btn.disabled = !supported && !on;
        btn.classList.toggle('btn--danger', on);
        btn.querySelector('span').textContent = on ? t('phantomModal.disconnect', 'Déconnecter') : t('phantomModal.connect', 'Connecter');
    };
    const open = () => { render(); overlay.classList.add('is-active'); };
    const close = () => overlay.classList.remove('is-active');
    window.openPhantomModal = open;

    overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.closest('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    btn.addEventListener('click', async () => {
        const phantom = window.phantomChessboard;
        if (!phantom) return;
        if (phantom.isConnected) {
            await phantom.disconnect();
            updateConnectionUI();
            render();
            return;
        }
        btn.disabled = true;
        try {
            await phantom.connect();
            if (!phantom.isConnected) throw new Error('non connecté');
            updateConnectionUI();
            Toast.success('Phantom connecté !');
            close();
        } catch (e) {
            Toast.error('Connexion Phantom échouée');
        } finally {
            render();
        }
    });

    document.querySelectorAll('[data-action="connect-phantom"]').forEach(b => b.addEventListener('click', open));

    // Menus « Phantom ▾ » : sans connexion, on passe par la modale (capture : avant leurs propres gestionnaires)
    document.addEventListener('click', e => {
        const menuBtn = e.target.closest('#btn-phantom-menu, .live-phantom-menu__btn');
        if (!menuBtn || window.phantomChessboard?.isConnected) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        document.querySelectorAll('.phantom-menu.is-open').forEach(m => m.classList.remove('is-open'));
        open();
    }, true);
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

    // Les boutons du menu Phantom de la partie doivent suivre la connexion même
    // quand elle change depuis une autre page (sinon ils restent grisés)
    SandboxPage.updateConditionalUI();
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
// ROUTES PRÉCONFIGURÉES : PAGES DE RÉGLAGE
// ============================================
const PresetForm = {
    bindToggles(prefix) {
        ['follow', 'sub'].forEach(name => {
            const toggle = document.getElementById(`${prefix}-${name}-toggle`);
            toggle?.addEventListener('click', () => toggle.classList.toggle('is-active'));
        });
    },

    read(prefix) {
        const value = (name) => document.getElementById(`${prefix}-${name}`)?.value;
        const isOn  = (name) => !!document.getElementById(`${prefix}-${name}-toggle`)?.classList.contains('is-active');
        return {
            timerEnabled:  true,
            singleVote:    true,
            timerDuration: Math.min(300, Math.max(5, parseInt(value('timer')) || 30)),
            majorityMode:  value('mode') === 'majority',
            followersOnly: isOn('follow'),
            subsOnly:      isOn('sub')
        };
    },

    /** Pas connecté, ou token antérieur à l'autorisation de lire les followers */
    needsLogin(config) {
        return !twitchAuth.isLoggedIn || (config.followersOnly && !twitchAuth.canCheckFollowers);
    }
};

const RushPage = {
    initialized: false,

    init() {
        const rating = document.getElementById('rush-page-rating');
        const pause  = document.getElementById('rush-page-pause');
        if (!this.initialized) {
            rating.value = AppState.config.rushStartRating || 600;
            pause.value  = AppState.config.pauseAfterEnd || 5;
            BrowsePage.rushModes['rush-page-records'] = rushMode();
            BrowsePage.bindRushModes(document.getElementById('page-rush'));
            document.getElementById('rush-page-start').addEventListener('click', () => {
                this.launch('rush', parseInt(rating.value), parseInt(pause.value),
                    BrowsePage.rushModes['rush-page-records']);
            });
            this.initialized = true;
        }
        BrowsePage.loadRushRecords('rush-page-records');
    },

    launch(route, rating, pause, mode = '0') {
        if (!GameSession.confirmReplace()) return;
        GameSession.clear();
        AppState.config.rushStartRating = Math.min(3000, Math.max(400, rating || 600));
        AppState.config.pauseAfterEnd   = Math.min(60, Math.max(1, pause || 5));
        AppState.config.rushTimer       = RUSH_MODES.includes(mode) ? mode : '0';
        Storage.saveConfig();
        // Le temps pour voter vient du mode choisi, pas des réglages de la partie libre
        const seconds = parseInt(AppState.config.rushTimer, 10);
        GameSession.launch({
            route, gameMode: 'rush',
            config: { rushTimer: AppState.config.rushTimer, timerEnabled: seconds > 0, timerDuration: seconds || 30 }
        });
    }
};

const MonoPage = {
    initialized: false,
    format: 'vsStreamer',

    init() {
        if (this.initialized) return;
        this.initialized = true;
        PresetForm.bindToggles('mono');
        document.querySelectorAll('#page-mono .preset-choice').forEach(choice => {
            choice.addEventListener('click', () => {
                this.format = choice.dataset.format;
                document.querySelectorAll('#page-mono .preset-choice').forEach(c => {
                    c.classList.toggle('is-active', c === choice);
                });
                document.getElementById('mono-color-group').style.display =
                    this.format === 'vsStreamer' ? '' : 'none';
            });
        });
        document.getElementById('mono-start').addEventListener('click', () => {
            const config = PresetForm.read('mono');
            if (PresetForm.needsLogin(config)) { twitchAuth.login(); return; }
            if (!GameSession.confirmReplace()) return;
            GameSession.launch({
                route: 'mono',
                gameMode: 'mono',
                format: this.format,
                streamerColor: document.getElementById('mono-color').value,
                config
            });
        });
    }
};

const MultiPage = {
    initialized: false,

    init() {
        const channel = document.getElementById('multi-channel');
        channel.value = twitchAuth.user?.login || '';
        if (this.initialized) return;
        this.initialized = true;
        PresetForm.bindToggles('multi');
        document.getElementById('multi-start').addEventListener('click', () => {
            const options = PresetForm.read('multi');
            if (PresetForm.needsLogin(options)) { twitchAuth.login(); return; }
            const me       = normalizeLogin(twitchAuth.user.login);
            const opponent = normalizeLogin(document.getElementById('multi-opponent').value);
            if (opponent.length < 2 || opponent === me) {
                Toast.error(tr('multi.invalidOpponent'));
                return;
            }
            const query = new URLSearchParams({ timer: options.timerDuration, mode: options.majorityMode ? 'majority' : 'wheel' });
            if (options.subsOnly) query.set('subs', '1');
            if (options.followersOnly) query.set('followers', '1');
            if (!GameSession.confirmReplace()) return;
            window.location.hash = `#/multi/${me}/${opponent}?${query}`;
        });
    }
};

// ============================================
// ROUTES PRÉCONFIGURÉES : SALON ET PARTIE
// ============================================
const PresetGame = {
    countdownId: null,
    endsAt: null,
    banner: null,

    /** Bandeau au-dessus de l'échiquier : { title | titleKey, params, hintKey, actions } */
    setBanner(banner) {
        this.banner = banner;
        const el = document.getElementById('lobby-banner');
        el.style.display = banner ? '' : 'none';
        if (!banner) return;
        document.getElementById('lobby-title').textContent = banner.title || tr(banner.titleKey, banner.params);
        document.getElementById('lobby-hint').textContent  = banner.hintKey ? tr(banner.hintKey) : '';
        el.querySelectorAll('[data-lobby-action]').forEach(btn => {
            btn.style.display = banner.actions?.includes(btn.dataset.lobbyAction) ? '' : 'none';
        });
        this.renderCount();
    },

    renderCount() {
        const remaining = this.endsAt ? Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000)) : null;
        document.getElementById('lobby-countdown').textContent = remaining === null ? ''
            : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
        document.getElementById('lobby-count').textContent = lobby.open
            ? tr('lobby.count', { count: lobby.players.size }) : '';
    },

    startCountdown(seconds, onEnd = null) {
        this.stopCountdown();
        this.endsAt = Date.now() + seconds * 1000;
        this.renderCount();
        this.countdownId = setInterval(() => {
            this.renderCount();
            if (onEnd && Date.now() >= this.endsAt) onEnd();
        }, 250);
    },

    stopCountdown() {
        clearInterval(this.countdownId);
        this.countdownId = null;
        this.endsAt = null;
    },

    /** Mêmes exemptions que le mode followers du chat Twitch */
    async verifyFollower(tags) {
        const badges = tags.badges || {};
        if (tags.mod || tags.subscriber || badges.broadcaster || badges.moderator || badges.vip || badges.subscriber) {
            return true;
        }
        try {
            return await twitchAuth.isFollower(tags['user-id']);
        } catch (e) {
            // Twitch indisponible : on n'empêche pas la partie, mais le streamer doit le savoir
            console.warn('Vérification follower impossible :', e.message);
            if (!this.followCheckWarned) Toast.warning(tr('lobby.followCheckFailed'));
            this.followCheckWarned = true;
            return true;
        }
    },

    followerCheck(enabled) {
        return enabled ? (tags) => this.verifyFollower(tags) : null;
    },

    lobbyHint() {
        if (twitch.settings.subsOnly) return 'lobby.hintSubs';
        return lobby.verifyJoin ? 'lobby.hintFollowers' : 'lobby.hint';
    },

    startLobby(options) {
        document.getElementById('roster-panel').style.display = '';
        gameEngine.onGameEnd = (result) => this.onGameEnd(result);
        lobby.start({
            ...options,
            isEligible: (tags) => twitch.checkVoteEligibility(tags),
            verifyJoin: this.followerCheck(AppState.config.followersOnly),
            onChange: () => {
                this.renderCount();
                this.renderRoster();
            },
            onLateJoin: (player) => Toast.info(tr('lobby.lateJoin', {
                name: player.name,
                team: tr(player.team === 'w' ? 'roster.white' : 'roster.black')
            }))
        });
    },

    // ========== MONO ==========

    startMono() {
        const login = twitchAuth.user?.login;
        if (!login) {
            GameSession.restart('#/mono');
            return;
        }
        const { format, streamerColor } = GameSession.current;
        if (format === 'vsStreamer') {
            const color = streamerColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : streamerColor;
            gameEngine.session = { humanColor: color };
            gameEngine.board.orientation(color === 'w' ? 'white' : 'black');
            this.startLobby({ format, channel: login, streamer: login, color: color === 'w' ? 'b' : 'w' });
        } else {
            gameEngine.session = { humanColor: null };
            this.startLobby({ format, channel: login, streamer: login });
        }
        this.showMonoLobby();
        this.startCountdown(MONO_LOBBY_SECONDS, () => this.closeMonoLobby());
    },

    showMonoLobby() {
        this.setBanner({
            titleKey: 'lobby.title',
            hintKey: PresetGame.lobbyHint(),
            actions: ['start-now']
        });
    },

    closeMonoLobby() {
        // Une partie sans joueur ne jouerait que des coups au hasard
        if (lobby.players.size === 0) {
            Toast.show(tr('lobby.nobody'), 'warning', 8000);
            this.startCountdown(MONO_LOBBY_SECONDS, () => this.closeMonoLobby());
            return;
        }
        this.stopCountdown();
        lobby.close();
        this.setBanner(null);
        gameEngine.startGame();
    },

    rematch() {
        if (lobby.open) return;
        this.setBanner(null);
        gameEngine.reset();
        gameEngine.startGame();
    },

    // ========== FIN DE PARTIE ==========

    onGameEnd(result) {
        timer.stop();
        voting.close();
        const isMulti = GameSession.current?.route === 'multi';
        this.setBanner({
            title: result,
            actions: isMulti ? ['revenge', 'back'] : ['rematch', 'new-lobby']
        });
    },

    // ========== ROSTER ==========

    renderRoster() {
        const groups = lobby.format === 'teams' && !lobby.open
            ? [[tr('roster.white'), lobby.getPlayers('w')], [tr('roster.black'), lobby.getPlayers('b')]]
            : [[tr('roster.players'), lobby.getPlayers()]];

        const list = document.getElementById('roster-list');
        list.textContent = '';
        groups.forEach(([title, players]) => {
            const heading = document.createElement('div');
            heading.className = 'roster__team';
            heading.textContent = `${title} (${players.length})`;
            list.appendChild(heading);

            players.forEach(player => {
                const row = document.createElement('div');
                row.className = 'roster__row';
                const name = document.createElement('span');
                name.className = 'roster__name';
                name.textContent = player.name;
                const kick = document.createElement('button');
                kick.className = 'btn btn--icon btn--sm';
                kick.title = tr('roster.kick');
                kick.innerHTML = '<i class="fas fa-times"></i>';
                kick.addEventListener('click', () => this.kick(player.login));
                row.append(name, kick);
                list.appendChild(row);
            });
        });

        document.getElementById('roster-team').style.display =
            lobby.format === 'teams' && !lobby.open ? '' : 'none';
    },

    kick(login) {
        lobby.kick(login);
        voting.removePlayer(login);
        if (voting.isOpen) {
            gameEngine.updateVotesUI(voting.getSortedResults());
            gameEngine.syncWheelFromVoting();
        }
    },

    addFromForm() {
        const input = document.getElementById('roster-add');
        const team  = document.getElementById('roster-team');
        const added = lobby.add(input.value, team.style.display === 'none' ? null : team.value);
        if (!added) { Toast.error(tr('roster.invalid')); return; }
        input.value = '';
    },

    setupControls() {
        const actions = {
            'start-now': () => {
                if (lobby.players.size === 0) { Toast.show(tr('lobby.nobodyYet'), 'warning', 8000); return; }
                this.closeMonoLobby();
            },
            'copy-link': () => {
                navigator.clipboard.writeText(window.location.href).then(() => Toast.success(tr('lobby.linkCopied')));
            },
            'login':     () => twitchAuth.login(),
            'rematch':   () => this.rematch(),
            'new-lobby': () => GameSession.launch(GameSession.current),
            'revenge':   () => GameSession.restart(window.location.hash),
            'back':      () => GameSession.quit('#/multi')
        };
        document.querySelectorAll('[data-lobby-action]').forEach(btn => {
            btn.addEventListener('click', () => actions[btn.dataset.lobbyAction]());
        });
        document.getElementById('roster-add-btn').addEventListener('click', () => this.addFromForm());
        document.getElementById('roster-add').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.addFromForm();
        });
        window.addEventListener('languageChanged', () => {
            this.setBanner(this.banner);
            if (lobby.active) this.renderRoster();
        });
    }
};

const MultiRoom = {
    room: null,

    parse(path, query) {
        const match = /^\/multi\/([^/]+)\/([^/]+)$/.exec(path);
        if (!match) return null;
        const params = new URLSearchParams(query || '');
        return {
            a: normalizeLogin(match[1]),
            b: normalizeLogin(match[2]),
            settings: {
                timerDuration: Math.min(300, Math.max(5, parseInt(params.get('timer')) || 30)),
                majorityMode:  params.get('mode') === 'majority',
                followersOnly: params.get('followers') === '1',
                subsOnly:      params.get('subs') === '1'
            }
        };
    },

    isSame(room) {
        return !!this.room && room.a === this.room.a && room.b === this.room.b;
    },

    /** Avant SandboxPage.init : le moteur démarre avec les réglages du lien */
    prepare(room) {
        this.room = room;
        GameSession.activate({
            route: 'multi',
            gameMode: 'multi',
            config: { ...room.settings, timerEnabled: true, singleVote: true }
        });
    },

    /** Après la restauration de Twitch : entrée réelle dans le salon */
    enter() {
        const { a, b, settings } = this.room;
        const login = normalizeLogin(twitchAuth.user?.login);

        if (!this.listening) {
            this.listening = true;
            window.addEventListener('multiRoomState', (e) => this.room && this.onState(e.detail));
            window.addEventListener('multiRoomDenied', (e) => this.room && this.deny(e.detail.reason));
            window.addEventListener('multiPartnerLeft', () => this.room && this.onPartnerLeft());
        }

        if (!login) {
            PresetGame.setBanner({
                title: `${a} ⚔ ${b}`,
                hintKey: 'multi.loginRequired',
                actions: ['login', 'back']
            });
            return;
        }
        if (login !== a && login !== b) {
            this.deny('notParticipant');
            return;
        }
        if (settings.followersOnly && !twitchAuth.canCheckFollowers) {
            PresetGame.setBanner({
                title: `${a} ⚔ ${b}`,
                hintKey: 'multi.followersScope',
                actions: ['login', 'back']
            });
            return;
        }

        twitch.settings.subsOnly = settings.subsOnly;
        gameEngine.session = { humanColor: null };
        PresetGame.startLobby({
            format: 'multi',
            channel: login,
            streamer: login,
            color: login === a ? 'w' : 'b'
        });
        this.opponent = login === a ? b : a;
        window.multiplayerManager.enterRoom({ a, b, login, token: twitchAuth.token, settings });
    },

    onState({ present, remainingMs, settings }) {
        // Le premier arrivé fixe les réglages de la partie
        twitch.settings.subsOnly = settings.subsOnly;
        lobby.verifyJoin = PresetGame.followerCheck(settings.followersOnly);

        if (present.length < 2) {
            PresetGame.stopCountdown();
            PresetGame.setBanner({
                titleKey: 'multi.waiting',
                params: { name: this.opponent },
                hintKey: 'multi.waitingHint',
                actions: ['copy-link', 'back']
            });
            return;
        }
        PresetGame.startCountdown(remainingMs / 1000);
        PresetGame.setBanner({
            titleKey: 'lobby.title',
            hintKey: PresetGame.lobbyHint(),
            actions: ['copy-link']
        });
    },

    deny(reason) {
        PresetGame.stopCountdown();
        lobby.open = false;
        const { a, b } = this.room;
        PresetGame.setBanner({
            titleKey: `multi.denied.${reason}`,
            params: { a, b },
            actions: reason === 'auth' ? ['login', 'back'] : ['back']
        });
    },

    /** Quitte le salon : socket fermé, gestionnaire neuf pour le prochain */
    leave() {
        const manager = window.multiplayerManager;
        if (manager?.socket) {
            manager.roomEntry = null;          // pas de "partenaire parti" pour une sortie volontaire
            manager.partnerConnected = false;
            manager.socket.disconnect();
        }
        if (manager?.gameId || manager?.socket) window.multiplayerManager = new manager.constructor();
        window.multiplayerMode = false;
        window.currentGameId = null;
        window.playerColor = null;
        window.streamer1Channel = null;
        window.streamer2Channel = null;
        ['multi-active-banner', 'multi-pre-ready-banner'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        this.room = null;
        this.opponent = null;
    },

    onGameReady() {
        PresetGame.stopCountdown();
        lobby.close();
        PresetGame.setBanner(null);
    },

    onPartnerLeft() {
        if (!gameEngine.isRunning) return;
        timer.stop();
        voting.close();
        gameEngine.isRunning = false;
        PresetGame.setBanner({ titleKey: 'multi.partnerLeft', actions: ['revenge', 'back'] });
    }
};

// ============================================
// INITIALISATION
// ============================================
async function initApp() {
    console.log('🚀 Phantom Twitchess - Initialisation...');

    // Charger la config sauvegardée
    Storage.loadConfig();
    GameSession.restore();

    // Exposer Toast globalement (utilisé par multi.js et d'autres scripts)
    window.AppToast = Toast;

    // Setup
    Toast.init();
    setupModals();
    setupConnectionHandlers();
    PresetGame.setupControls();

    // Session Twitch (traite un éventuel retour OAuth AVANT le router : le token
    // arrive dans le fragment d'URL, que le router utilise pour la navigation)
    await twitchAuth.init();

    // Init router
    Router.init();

    // Restore connections
    await twitch?.restore();

    // Écouter les votes Twitch
    if (twitch) {
        twitch.onMessage = (message) => lobby.handleMessage(message);

        twitch.onVote = (voteContext) => {
            // ---- Mode problèmes ----
            if (isPuzzleMode() && problemsManager.isActive) {
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

            // ---- Routes à inscription : seuls les inscrits du camp au trait votent ----
            if (lobby.active && !lobby.canVote(voteContext.username, gameEngine.chess.turn())) {
                return;
            }

            // ---- Comportement normal ----
            if (voting.isOpen) {
                // "kh1" → "Kh1" ; un coup illégal n'est pas compté
                const resolved = matchLegalMove(gameEngine.chess, voteContext.move);
                if (!resolved) {
                    console.log('🗳️ Vote ignoré (coup illégal) :', voteContext.move);
                    return;
                }
                voting.addVote(voteContext.username, resolved.san);
            }
        };
    }

    // ---- Événement Bataille Twitch prête ----
    window.addEventListener('multiGameReady', (e) => {
        // Masquer la bannière d'attente (showActiveBanner prend le relais)
        const preBanner = document.getElementById('multi-pre-ready-banner');
        if (preBanner) preBanner.style.display = 'none';

        const { players, settings } = e.detail;

        // Paramètres choisis à la création du salon (sinon ceux de l'app)
        const timerDuration  = settings?.timerDuration || AppState.config.timerDuration;
        const majorityMode   = settings?.majorityMode  ?? AppState.config.majorityMode;
        const followersOnly  = settings?.followersOnly ?? AppState.config.followersOnly;
        const subsOnly       = settings?.subsOnly      ?? AppState.config.subsOnly;

        // Configurer l'état pour le mode ChatVsChat
        AppState.gameMode              = 'chatVsChat';
        AppState.players.chat1         = players.white;
        AppState.players.chat2         = players.black;
        AppState.config.timerEnabled   = true;
        AppState.config.timerDuration  = timerDuration;
        AppState.config.majorityMode   = majorityMode;
        AppState.config.followersOnly  = followersOnly;
        AppState.config.subsOnly       = subsOnly;
        twitch.settings.subsOnly       = !!subsOnly;
        syncWheelModeClass();

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

        if (MultiRoom.room) MultiRoom.onGameReady();
        gameEngine.startGame();

        // Rendre le Toast accessible au multiplayerManager
        window.AppToast = Toast;

        Toast.success(`⚔ Bataille lancée ! ${players.white} (⬜) vs ${players.black} (⬛)`);
        console.log(`🎮 Partie multi démarrée : ${players.white} vs ${players.black}`);
    });
    if (MultiRoom.room) MultiRoom.enter();

    if (sessionStorage.getItem('autoStart') === '1') {
        sessionStorage.removeItem('autoStart');
        // Attendre que SandboxPage soit init via le Router
        setTimeout(() => SandboxPage.applyConfigAfterReload(), 100);
        GameAnnouncer.start();
    }
    window.addEventListener('phantomError', (e) => {
        Toast.show(`Phantom : ${String(e.detail).slice(0, 160)}`, 'warning', 10000);
    });

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
    // Connexion ou coupure du Phantom/Twitch hors des boutons de l'app (échiquier éteint, reconnexion…)
    let lastConn = '';
    setInterval(() => {
        const conn = `${!!window.phantomChessboard?.isConnected}|${!!window.twitch?.isConnected}`;
        if (conn !== lastConn) { lastConn = conn; updateConnectionUI(); }
    }, 1000);

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
export { AppState, Router, SandboxPage, BrowsePage, Toast, Storage, gameEngine, timer, voting, problemsManager, rushManager };