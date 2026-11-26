/**
 * PHANTOM TWITCHESS - Main Application
 * Point d'entrée principal, Router, État global
 *
 * MISE À JOUR : Intégration du mode Problèmes via problemsManager
 * FIX: Structure corrigée - initProblemsMode intégré dans SandboxPage
 */

import gameEngine from './core/gameEngine.js';
import { routeHash, toUrl, go, cleanLegacyHash } from './core/route.js';
import timer from './core/timer.js';
import voting from './core/voting.js';
import problemsManager from './core/problemManager.js';
import rushManager from './core/rushManager.js';
import twitch from './managers/twitch.js';
import twitchAuth from './core/twitchAuth.js';
import { matchLegalMove, fmtMove } from './utils/moveMatch.js';
import lobby, { normalizeLogin } from './core/lobby.js';
import './core/viewerStats.js';
import './core/economy.js';
import './core/achievements.js';
import AchievementsPage from './pages/achievements.js';
import ShopPage from './pages/shop.js';
import RecordsPage from './pages/records.js';
import WatchPage from './pages/watch.js';
import H24Page from './pages/h24.js';
import BrowseTable from './pages/browseTable.js';
import { renderSpectatorList, spectatorsLabel } from './components/spectators.js';
import './components/infoTip.js';
import { PALETTES, PALETTE_IDS, getPaletteId, setPaletteId, paletteAvailable } from './components/votePalettes.js';
import { initAnonymity, secretVotes, getAnonymity, forceAnonymity, ANON_MODES } from './components/voteAnonymity.js';
import { initGreenScreen } from './components/greenScreen.js';
import { VoteTicker } from './components/voteViews.js';
import { showSensorAlert, showPhantomError, sensorsOk } from './components/phantomSensorAlert.js';
import './components/testTools.js';
import { snapSpin, spinId, DEFAULT_SPIN } from './core/spinSpeed.js';

// Anonymat du vote : sélecteurs (réglages, modale ⚙, formulaire Multi)
initAnonymity();
initGreenScreen();

// ============================================
// ÉTAT GLOBAL
// ============================================
const AppState = {
    currentPage: 'h24',

    // Mode de jeu
    // Mode de jeu (sandbox = partie libre, problems, rush, mono, multi…), reflété sur <body data-game-mode>
    _gameMode: 'sandbox',
    get gameMode() { return this._gameMode; },
    set gameMode(mode) {
        this._gameMode = mode;
        document.body.dataset.gameMode = mode;
    },

    // Configuration du jeu
    config: {
        // Twitch
        defaultChannel: '',

        // Timer/Vote
        timerEnabled: false,
        timerDuration: 30,       // 10 à 120 s : en dessous, le délai du stream ne laisse pas le temps de voter
        wheelDuration: DEFAULT_SPIN,
        pauseAfterEnd: 15,
        votesPerViewer: 1,       // votes par viewer et par coup (les stats n'en comptent qu'un)
        majorityMode: false,

        // Restrictions Twitch
        followersOnly: false,
        subsOnly: false,

        // Contre Stockfish : niveau, camp du chat ('w', 'b' ou 'random')
        botElo: 1320,
        botSide: 'random',

        // Affichage
        noBg: false,

        // Phantom
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
document.body.dataset.gameMode = AppState.gameMode;

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
            // « yolo » : ancien nom de la partie libre dans l'écran Nouveau
            AppState.gameMode = (saved.gameMode === 'yolo' ? 'sandbox' : saved.gameMode) || 'sandbox';
            Object.assign(AppState.config, saved.config || {});
            AppState.config.timerDuration = clampTurn(AppState.config.timerDuration);
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
// Puzzle Rush : temps pour voter, un classement par mode. L'ancien mode '0' (illimité, premier coup valide joué)
// ne se lance plus : ses records restent consultables dans Records.
const RUSH_MODES = ['30', '60', '120'];
const rushMode = () => {
    const m = String(AppState.config.rushTimer ?? '30');
    return RUSH_MODES.includes(m) ? m : '30';
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
        document.getElementById('game-recap')?.setAttribute('hidden', '');
        Object.assign(lobby, new lobby.constructor());
        const roster = document.getElementById('roster-panel');
        if (roster) roster.style.display = 'none';
        MultiRoom.leave();
        GameAnnouncer.stop();
        SpectatorsUI.render(null);
        if (window.gameEngine) {
            gameEngine.session = null;
            gameEngine.vsBot = null;
            gameEngine.engineKey = null;
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
                pauseAfterEnd: c.pauseAfterEnd, majorityMode: c.majorityMode, votesPerViewer: c.votesPerViewer || 1
            });
            timer.setDuration?.(c.timerDuration);
        }
        if (routeHash() !== hash) history.pushState(null, '', toUrl(hash));
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
            if (routeHash().startsWith('#/game')) {
                history.replaceState(null, '', `/${saved.route}`);
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
        '/sandbox': 'sandbox',
        '/game': 'game',
        '/browse': 'browse',
        '/records': 'records',
        '/watch': 'watch',
        '/24h': 'h24',
        '/live': 'live',
        '/tournament': 'tournament',
        '/rush': 'rush',
        '/mono': 'mono',
        '/multi': 'multi',
        '/achievements': 'achievements',
        '/shop': 'shop',
    },
    started: false,

    init() {
        // Adresses propres : /24h plutôt que /#/24h (les anciens liens en #/ sont nettoyés)
        cleanLegacyHash();
        window.addEventListener('popstate', () => this.handleRoute());
        window.addEventListener('routechange', () => this.handleRoute());
        window.addEventListener('hashchange', () => {
            if (!location.hash.startsWith('#/')) return;
            cleanLegacyHash();
            this.handleRoute();
        });

        document.querySelectorAll('[data-navigate]').forEach(el => {
            el.setAttribute('href', langUrl(el.dataset.navigate));
            el.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
                e.preventDefault();
                go(el.dataset.navigate);
            });
        });
        // Liens internes (/records?c=x, ou anciens #/…) : navigation sans recharger la page
        document.addEventListener('click', (e) => {
            if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
            const a = e.target.closest('a[href]');
            if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.navigate) return;
            const href = a.getAttribute('href');
            const path = href.startsWith('#/') ? href.slice(1) : href.startsWith('/') && !href.startsWith('//') ? href : null;
            if (!path) return;
            const first = '/' + (path.split(/[/?#]/)[1] || '');
            if (!this.routes[first] && first !== '/') return;
            e.preventDefault();
            go(path);
        });

        this.handleRoute();
        this.started = true;
    },

    handleRoute() {
        const hash = routeHash().slice(1) || '/';
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
            GameSession.hash = routeHash();
            this.showPage('game');
            // Au démarrage, initApp entre dans le salon après la restauration de Twitch
            if (this.started) MultiRoom.enter();
            return;
        }

        // Accueil (et adresse inconnue) : la station 24/24
        if (!this.routes[path]) {
            history.replaceState(null, '', '/24h');
            return this.showPage('h24');
        }
        let pageName = this.routes[path];
        // #/game sans partie (F5, lien partagé) : écran de lancement
        if (pageName === 'game' && !GameSession.running) {
            history.replaceState(null, '', '/sandbox');
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
            const linkPath = (link.dataset.navigate || '').split('?')[0];
            // Mono, Multi et Puzzle Rush sont des onglets de Nouveau (/sandbox)
            const group = p => NEW_TABS.includes(p) ? 'sandbox' : p;
            link.classList.toggle('is-active', group(Router.routes[linkPath]) === group(pageName));
        });
        moveNavCursor();
        window.dispatchEvent(new CustomEvent('cg:page', { detail: { page: pageName } }));

        // Quitter la page spectateur coupe son flux
        if (pageName !== 'watch') WatchPage.stop();
        if (pageName !== 'h24') H24Page.stop();

        // Init spécifique à la page
        if (pageName === 'sandbox' || pageName === 'game') {
            SandboxPage.init();
        } else if (pageName === 'browse') {
            BrowsePage.init();
        } else if (pageName === 'records') {
            RecordsPage.init();
        } else if (pageName === 'watch') {
            WatchPage.init();
        } else if (pageName === 'h24') {
            H24Page.init();
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
        } else if (pageName === 'achievements') {
            AchievementsPage.init();
        } else if (pageName === 'shop') {
            ShopPage.init();
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
            const hash = routeHash();
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
/** Durée du tour : 10 à 120 s (30 par défaut) */
function clampTurn(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(120, Math.max(10, n)) : 30;
}

/** Curseur du menu : glisse sous le lien actif (et suit le survol) */
function moveNavCursor(target) {
    const cursor = document.querySelector('.nav__cursor');
    const links = cursor?.parentElement;
    if (!links) return;
    const el = target || links.querySelector('.nav__link.is-active:not([hidden])');
    if (!el || !el.offsetWidth) { cursor.classList.remove('is-on'); return; }
    cursor.style.width = `${el.offsetWidth}px`;
    cursor.style.transform = `translateX(${el.offsetLeft}px)`;
    cursor.classList.toggle('is-hover', !!target && !target.classList.contains('is-active'));
    cursor.classList.add('is-on');
}
document.addEventListener('DOMContentLoaded', () => {
    const links = document.querySelector('.nav__links');
    links?.addEventListener('mouseover', (e) => { const l = e.target.closest('.nav__link'); if (l) moveNavCursor(l); });
    links?.addEventListener('mouseleave', () => moveNavCursor());
    window.addEventListener('resize', () => moveNavCursor());
    window.addEventListener('languageChanged', () => setTimeout(() => moveNavCursor(), 0));
    document.fonts?.ready?.then(() => moveNavCursor());
});

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Configurations suggérées de l'écran Nouveau (textes dans suggested.<id>) */
const SETUP_PRESETS = [
    // Personnaliser : garde le mode choisi et affiche toutes les options (le minuteur les fait apparaître)
    { id: 'custom',    icon: '🎛️', mode: null,       config: { timerEnabled: true }, custom: true },
    { id: 'democracy', icon: '🗳️', mode: 'sandbox',  config: { timerEnabled: true, timerDuration: 30, majorityMode: true,  votesPerViewer: 1 } },
    { id: 'wheel',     icon: '🎡', mode: 'sandbox',  config: { timerEnabled: true, timerDuration: 30, majorityMode: false, votesPerViewer: 3 } },
    { id: 'vsChat',    icon: '👤', mode: 'oneVsAll', config: { timerEnabled: true, timerDuration: 45, majorityMode: true,  votesPerViewer: 1 } },
    { id: 'vsBot',     icon: '🤖', mode: 'vsBot',    config: { timerEnabled: true, timerDuration: 30, majorityMode: true,  votesPerViewer: 1 } },
    { id: 'puzzles',   icon: '🧩', mode: 'problems', config: { timerEnabled: true, timerDuration: 30, majorityMode: true,  votesPerViewer: 1 } }
];

/** Le gestionnaire de puzzles n'est configuré qu'une fois : chaque lancement lui redonne le minuteur de la partie */
function syncProblemsTimer() {
    Object.assign(problemsManager.config, {
        timerEnabled:  !!AppState.config.timerEnabled,
        timerDuration: AppState.config.timerDuration,
        majorityMode:  AppState.config.majorityMode,
        wheelDuration: AppState.config.wheelDuration
    });
}

function syncWheelModeClass() {
    const wheelMode = !AppState.config.majorityMode && !isPuzzleMode();
    document.body.classList.toggle('wheel-mode', wheelMode);
    // Sans temps pour voter, pas de minuteur ni de tirage (roue / bande)
    document.body.classList.toggle('no-vote-timer', !AppState.config.timerEnabled);
    document.body.classList.toggle('has-draw', wheelMode && !!AppState.config.timerEnabled);
    if (!wheelMode) window.gameEngine?.hideWheel?.();
}

const SandboxPage = {
    initialized: false,
    problemsInitialized: false,
    rushUIReady: false,

    /** Titre et bouton retour selon la route (/sandbox, /game) */
    applyPageVariant(pageName) {
        const titleEl = document.getElementById('nav-page-title');
        const backBtn = document.getElementById('sandbox-back');
        if (pageName === 'game') {
            const titles = { rush: '🔥 ' + tr('browsePage.modeRush'), problems: '🧩 ' + tr('browsePage.modeProblems'), mono: '👥 ' + tr('browsePage.modeMono'), multi: '⚔ ' + tr('browsePage.modeMulti'), sandbox: '🧪 ' + tr('browsePage.modeSandbox'), vsBot: '🤖 Stockfish' };
            const route = GameSession.current?.route;
            if (titleEl) titleEl.textContent = titles[AppState.gameMode] || '♟ ' + tr('ui.game');
            // La flèche ramène aux réglages sans arrêter la partie (lien "Partie en cours" pour revenir)
            if (backBtn) backBtn.dataset.navigate = route ? `/${route}` : '/sandbox';
        } else if (pageName === 'sandbox') {
            if (titleEl) titleEl.textContent = '';
            if (backBtn) backBtn.dataset.navigate = '/24h';
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
                votesPerViewer: AppState.config.votesPerViewer
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

/** Lance la partie avec la config, puis met à jour le récap de la colonne de gauche */
async applyConfigAfterReload() {
    try { await this.startConfiguredGame(); } finally { GameRecap.render(); }
},

async startConfiguredGame() {
    document.body.classList.toggle('no-bg', AppState.config.noBg);
    syncWheelModeClass();
    twitch.settings.subsOnly = !!AppState.config.subsOnly;

    if (gameEngine.updateVotingIndicator) gameEngine.updateVotingIndicator();
    window.dispatchEvent(new CustomEvent('cg:gameStart', { detail: { mode: AppState.gameMode } }));

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
        syncProblemsTimer();
        problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
        problemsManager.config.votesPerViewer = 1;
        AppState.problems.isActive = true;
        this.setupRushUI();
        rushManager.config.mode = rushMode();
        await rushManager.fetchChannelRecord();
        rushManager.start({ startRating: AppState.config.rushStartRating || 100, mode: rushMode() });
        return;
    }

    if (AppState.gameMode === 'problems') {
        if (!this.problemsInitialized) {
            const success = await this.initProblemsMode();
            if (!success) { Toast.error(tr('ui.toast.problemsInit')); return; }
        }
        problemsManager.clearThemes();
        AppState.problems.selectedThemes.forEach(t => problemsManager.toggleTheme(t));
        syncProblemsTimer();
        problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
        problemsManager.config.votesPerViewer = AppState.config.votesPerViewer;
        AppState.problems.isActive = true;
        problemsManager.loadRandomProblem();
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
    gameEngine.config.votesPerViewer = AppState.config.votesPerViewer;

    gameEngine.mode = AppState.gameMode;
    // Contre Stockfish : le chat joue un camp (choisi ou tiré au sort), Stockfish l'autre
    gameEngine.vsBot = null;
    gameEngine.engineKey = null;
    if (AppState.gameMode === 'vsBot') {
        const side = AppState.config.botSide;
        const chat = side === 'w' || side === 'b' ? side : (Math.random() < 0.5 ? 'w' : 'b');
        gameEngine.vsBot = { color: chat === 'w' ? 'b' : 'w', elo: window.BotEngine?.snapLevel(AppState.config.botElo || 1320) ?? 1320 };
        gameEngine.board?.orientation(chat === 'w' ? 'white' : 'black');
    }
    gameEngine.startGame();

    if (gameEngine.updateVotingIndicator) gameEngine.updateVotingIndicator();
},

    async initProblemsMode() {
        console.log('🧩 Initialisation du mode Problèmes...');

        // 1. Charger les problèmes si nécessaire
        if (!problemsManager.isLoaded()) {
            try {
                await problemsManager.loadProblems(AppState.gameMode === 'rush'
                    ? { around: AppState.config.rushStartRating || 100 } : {});
            } catch (error) {
                console.error('Erreur chargement problèmes:', error);
                Toast.error(tr('ui.toast.problemsLoad'));
                return false;
            }
        }

        // 2. Injecter les références chess et board
        problemsManager.init({
            chess: gameEngine.chess,
            board: gameEngine.board,
            config: {
                pauseAfterEnd: AppState.config.pauseAfterEnd || 15,
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

problemsManager.onResolveWithWheel = (results, callback, seconds) => {
    // Durée imposée (égalité en problèmes : version lente), sinon le réglage du streamer
    const wheelDuration = (seconds ?? snapSpin(AppState.config.wheelDuration)) * 1000;
    // Pas de roue, ou « aucune animation » : tirage pondéré direct
    if (!gameEngine.votingWheel || wheelDuration <= 0) {
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
            this.showProblemFeedback('correct', move.to);
            this.addMoveToHistory(move, 'player');
            this.syncPhantom();
        };

        // Joueur erreur
        problemsManager.onWrongMove = (expectedSAN, expectedUCI, playedUCI) => {
            console.log('❌ Erreur! Attendu:', expectedSAN);
            // ✗ sur la case visée (sans coup joué : sur celle de la solution), puis la solution en flèche
            this.showProblemFeedback('wrong', (playedUCI || expectedUCI || '').slice(2, 4), expectedUCI);
        };

        // Problème résolu
        problemsManager.onProblemSolved = (problem) => {
            console.log('🎉 Résolu!');
            this.showProblemFeedback('solved');
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
        rushManager.start({ startRating: AppState.config.rushStartRating || 100 });
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
            status = tr('ui.rushEnd.loginToSave');
            cls = 'rush-end__status--muted';
        } else if (result.error) {
            status = tr('ui.rushEnd.notSaved', { error: result.error });
            cls = 'rush-end__status--error';
        } else if (result.score === 0) {
            status = tr('ui.rushEnd.nothing');
            cls = 'rush-end__status--muted';
        } else if (result.isNewRecord) {
            status = tr('ui.rushEnd.newRecord');
            cls = 'rush-end__status--record';
        } else {
            const best = result.record?.best?.score;
            status = best != null ? tr('ui.rushEnd.best', { n: best }) : tr('ui.rushEnd.saved');
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
        moveEl.textContent = fmtMove(move.san) + ' ';
        historyEl.appendChild(moveEl);
    },

    /**
     * Statut d'un coup de problème : pastille discrète dans le coin de la case d'arrivée
     * ✓ bon coup, ✗ mauvais coup (+ flèche verte de la solution), ★ problème résolu.
     * « Résolu » / « raté » reprennent la case du dernier coup ; « raté » garde le ✗ déjà posé.
     */
    showProblemFeedback(type, square = '', solutionUCI = '') {
        document.body.classList.remove('problem-correct', 'problem-wrong', 'problem-solved', 'problem-failed');
        document.body.classList.add(`problem-${type}`);
        clearTimeout(this.feedbackBodyTimer);
        this.feedbackBodyTimer = setTimeout(() => document.body.classList.remove(`problem-${type}`), 1200);

        if (type === 'failed') return;
        const sq = square || this.feedbackSquare;
        const boardEl = document.getElementById('myBoard');
        const cell = sq && boardEl?.querySelector(`[data-square="${sq}"]`);
        const host = boardEl?.parentElement;
        document.getElementById('problem-feedback')?.remove();
        clearTimeout(this.feedbackTimer);
        if (!cell || !host) return;
        this.feedbackSquare = sq;

        const badge = document.createElement('div');
        badge.id = 'problem-feedback';
        badge.className = `problem-badge problem-badge--${type}`;
        badge.textContent = type === 'correct' ? '✓' : type === 'wrong' ? '✗' : '★';
        const hb = host.getBoundingClientRect();
        const r = cell.getBoundingClientRect();
        badge.style.left = `${r.right - hb.left}px`;
        badge.style.top = `${r.top - hb.top}px`;
        host.appendChild(badge);
        // Bon coup : bref ; erreur / résolu : reste pendant la pause avant le problème suivant
        this.feedbackTimer = setTimeout(() => {
            badge.classList.add('is-leaving');
            setTimeout(() => badge.remove(), 300);
        }, type === 'correct' ? 1400 : 5000);

        // Erreur : la solution en flèche verte (après le retour de la pièce, sinon effacée avec la position)
        if (type === 'wrong' && /^[a-h][1-8][a-h][1-8]/.test(solutionUCI)) {
            setTimeout(() => {
                const ann = gameEngine.annotations;
                if (!ann) return;
                ann.arrows.set(solutionUCI.slice(0, 4), 'shift');
                ann.render();
            }, 450);
        }
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

        // Réinitialiser : partie libre uniquement (bouton masqué dans les autres modes, cf. sandbox.css)
        document.getElementById('btn-reset')?.addEventListener('click', () => {
            if (AppState.gameMode !== 'sandbox') return;
            gameEngine.reset();
            Toast.success(tr('ui.toast.boardReset'));
        });

        document.getElementById('btn-snap-center')?.addEventListener('click', async () => {
            if (window.phantomChessboard?.isConnected) {
                await window.phantomChessboard.snapToCenter();
                Toast.success(tr('ui.toast.snapCenter'));
            }
        });

        document.getElementById('btn-repair-centering')?.addEventListener('click', () => window.repairPhantomCentering());

        document.getElementById('btn-calibrate')?.addEventListener('click', async () => {
            if (window.phantomChessboard?.isConnected) {
                Toast.info(tr('ui.toast.recalibrating'));
                const fen = gameEngine.chess?.fen();
                await window.phantomChessboard.recalibrate(() => fen);
                Toast.success(tr('ui.toast.recalibrated'));
            }
        });

        document.getElementById('problem-pause')?.addEventListener('change', (e) => {
            AppState.config.pauseAfterEnd = parseInt(e.target.value) || 15;
            if (window.problemsManager) {
                window.problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
            }
        });

        document.getElementById('rush-pause')?.addEventListener('change', (e) => {
            AppState.config.pauseAfterEnd = parseInt(e.target.value) || 15;
            if (window.problemsManager) {
                window.problemsManager.config.pauseAfterEnd = AppState.config.pauseAfterEnd;
            }
        });

        document.getElementById('rush-start-rating')?.addEventListener('change', (e) => {
            const v = parseInt(e.target.value) || 100;
            AppState.config.rushStartRating = Math.min(3000, Math.max(100, v));
            e.target.value = AppState.config.rushStartRating;
        });
        // Flip

        // Couleurs du tirage : roue, bande et podium (transmises aux spectateurs)
        const paletteSelect = document.getElementById('palette-select');
        const paletteSwatches = document.getElementById('palette-swatches');
        const renderPalettes = () => {
            if (!paletteSelect) return;
            const current = getPaletteId();
            paletteSelect.innerHTML = PALETTE_IDS.filter(paletteAvailable).map(id => `<option value="${id}"${id === current ? ' selected' : ''}>${tr(`palette.${id}`)}</option>`).join('');
            if (paletteSwatches) paletteSwatches.innerHTML = PALETTES[current].slice(0, 6).map(c => `<span style="background:${c}"></span>`).join('');
        };
        renderPalettes();
        window.addEventListener('languageChanged', renderPalettes);
        paletteSelect?.addEventListener('change', () => setPaletteId(paletteSelect.value));
        // Anonymat du vote : sélecteurs (réglages + modale ⚙), appliqué tout de suite à la partie en cours
        document.addEventListener('voteAnonymityChanged', () => {
            VoteTicker.repaint();
            try {
                if (problemsManager?.isActive) {
                    problemsManager.syncWheelDisplay();
                } else {
                    gameEngine.updateVotesUI(voting.getSortedResults());
                    gameEngine.highlightMostVoted();
                }
            } catch {}
        });
        document.addEventListener('votePaletteChanged', () => {
            renderPalettes();
            const wheel = gameEngine.votingWheel;
            if (wheel && !wheel.isSpinning) wheel.draw?.();
            try { gameEngine.updateVotesUI(voting.getSortedResults()); } catch {}
        });
        // Modale ⚙ : style du tirage (bande / roue) et couleurs
        const drawMenu = document.getElementById('draw-menu');
        const renderStyles = () => drawMenu?.querySelectorAll('[data-wheel-style]').forEach(b => {
            b.classList.toggle('is-active', b.dataset.wheelStyle === gameEngine.wheelStyle);
        });
        renderStyles();
        drawMenu?.querySelectorAll('[data-wheel-style]').forEach(b => b.addEventListener('click', () => {
            gameEngine.setWheelStyle(b.dataset.wheelStyle);
            renderStyles();
        }));

        // Sync Phantom
        document.getElementById('btn-sync')?.addEventListener('click', () => {
            if (window.phantomChessboard?.isConnected) {
                window.phantomChessboard.syncPosition(gameEngine.getFen());
                Toast.info(tr('ui.toast.syncSent'));
            }
        });

        // Reset + Sync Phantom
        document.getElementById('btn-reset-sync')?.addEventListener('click', () => {
            if (AppState.gameMode !== 'sandbox') return;
            gameEngine.reset();
            if (window.phantomChessboard?.isConnected) {
                window.phantomChessboard.syncPosition(gameEngine.getFen());
                Toast.success(tr('ui.toast.resetSynced'));
            } else {
                Toast.success(tr('ui.toast.boardReset'));
            }
        });

        // Game End Phantom
        document.getElementById('btn-game-end')?.addEventListener('click', async () => {
            if (window.phantomChessboard?.isConnected) {
                await window.phantomChessboard.sendGameEnd();
                Toast.success(tr('ui.toast.gameEndSent'));
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
                    problemsManager.loadProblems().then(() => {
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

        const votesInput = document.getElementById('votes-per-viewer');
        votesInput?.addEventListener('change', () => {
            AppState.config.votesPerViewer = Math.min(10, Math.max(1, parseInt(votesInput.value) || 1));
            votesInput.value = AppState.config.votesPerViewer;
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


        // ========== INPUTS NUMÉRIQUES ==========
        document.getElementById('timer-duration')?.addEventListener('change', (e) => {
            AppState.config.timerDuration = clampTurn(e.target.value);
            e.target.value = AppState.config.timerDuration;
        });

        // Configurations suggérées
        document.getElementById('presets-list')?.addEventListener('click', (e) => {
            const card = e.target.closest('[data-preset]');
            if (card) this.applyPreset(card.dataset.preset);
        });
        // La carte suggérée reste surlignée tant que les réglages lui correspondent
        const setup = document.getElementById('sandbox-setup');
        ['click', 'change'].forEach(type => setup?.addEventListener(type, () => setTimeout(() => this.markPreset(), 0)));
        window.addEventListener('languageChanged', () => this.renderPresets());

        document.getElementById('wheel-duration')?.addEventListener('change', (e) => {
            AppState.config.wheelDuration = snapSpin(e.target.value);
        });

        // ========== CONTRE STOCKFISH ==========
        document.getElementById('bot-elo')?.addEventListener('change', (e) => {
            AppState.config.botElo = Number(e.target.value) || 1320;
        });
        document.getElementById('bot-side')?.addEventListener('change', (e) => {
            AppState.config.botSide = e.target.value;
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
            if (countEl) countEl.textContent = tr('ui.problemsCount', { n: count });
        });

        // ========== MODAL SAUVEGARDE ==========
        document.getElementById('btn-confirm-save')?.addEventListener('click', () => {
            const name = document.getElementById('config-name')?.value?.trim();
            if (name) {
                Storage.saveNamedConfig(name);
                this.renderConfigs();
                Toast.success(tr('ui.toast.configSaved', { name }));
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
        this.renderSettingsSummary();
        document.getElementById('sandbox-setup')?.classList.add('is-open');
    },

    /** Ferme la modale ⚙ (en cours de partie, les réglages sont en lecture seule) */
    closeSettings() {
        document.getElementById('sandbox-setup')?.classList.remove('is-open');
    },

    /** Réglages réellement appliqués à la partie en cours, en lecture seule */
    renderSettingsSummary() {
        const el = document.getElementById('settings-summary');
        if (!el) return;
        el.innerHTML = this.settingsRows().map(([icon, k, v]) => `<div class="settings-summary__row"><dt><i class="fas ${icon}"></i> ${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
    },

    /** Réglages appliqués à la partie en cours : [icône, intitulé, valeur] */
    settingsRows() {
        const c = gameEngine.config || {};
        const yes = tr('settingsSummary.on'), no = tr('settingsSummary.off');
        const restrictions = [twitch.settings?.followersOnly && 'Followers', twitch.settings?.subsOnly && 'Subs'].filter(Boolean).join(' + ') || tr('settingsSummary.none');
        const vs = gameEngine.vsBot;
        const rows = [
            ...(vs ? [['fa-robot', 'Stockfish', `${window.BotEngine?.levelLabel(vs.elo) || vs.elo} (${tr(vs.color === 'w' ? 'gameMode.vsBot.white' : 'gameMode.vsBot.black')})`]] : []),
            ['fa-stopwatch', tr('settingsSummary.timer'), c.timerEnabled ? `${c.timerDuration} s` : tr('timerOff.badge')],
            ['fa-scale-balanced', tr('gameMode.voteOptions.voteMajority'), c.majorityMode ? yes : no],
            ...(c.timerEnabled && !c.majorityMode ? [['fa-dharmachakra', tr('gameMode.voteOptions.wheelAnimation'), tr(`presets.spinSpeed.${spinId(c.wheelDuration)}`)]] : []),
            ['fa-user-check', tr('gameMode.voteOptions.votesPerViewer'), String(c.votesPerViewer || 1)],
            ['fa-lock', tr('gameMode.twitchOptions.restrictions'), restrictions]
        ];
        return rows;
    },

    applyLiveSettings() {
        if (['sandbox', 'game'].includes(AppState.currentPage)) {
            Object.assign(gameEngine.config, {
                timerEnabled: AppState.config.timerEnabled,
                timerDuration: AppState.config.timerDuration,
                wheelDuration: AppState.config.wheelDuration,
                majorityMode: AppState.config.majorityMode,
                votesPerViewer: AppState.config.votesPerViewer
            });
            twitch.settings.subsOnly = !!AppState.config.subsOnly;
            syncWheelModeClass();
            gameEngine.updateVotingIndicator?.();
            Storage.saveConfig();
            GameRecap.render();
        }
    },

    setupProblemsInterception() {
        const originalOnDrop = gameEngine.onDrop?.bind(gameEngine);

        gameEngine.onDrop = (source, target, piece, newPos, oldPos, orientation) => {
            // Si mode problèmes actif, déléguer au problemsManager
            if (isPuzzleMode() && problemsManager.isActive) {
                const move = source + target;
                // Vote en cours : le coup posé compte comme un vote, il n'est pas joué
                if (gameEngine.dropIsVote?.()) { problemsManager.receiveVote(move); return 'snapback'; }
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
        const votesInput = document.getElementById('votes-per-viewer');
        if (votesInput) votesInput.value = AppState.config.votesPerViewer || 1;
        this.setToggleState('toggle-majority', AppState.config.majorityMode);
        this.setToggleState('toggle-followers', AppState.config.followersOnly);
        this.setToggleState('toggle-subs', AppState.config.subsOnly);

        // Inputs numériques
        const timerDuration = document.getElementById('timer-duration');
        if (timerDuration) timerDuration.value = AppState.config.timerDuration;

        const wheelDuration = document.getElementById('wheel-duration');
        if (wheelDuration) wheelDuration.value = String(snapSpin(AppState.config.wheelDuration));

        const rushRating = document.getElementById('rush-start-rating');
        if (rushRating) rushRating.value = AppState.config.rushStartRating || 100;

        ['problem-pause', 'rush-pause'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = AppState.config.pauseAfterEnd || 15;
        });

        // Contre Stockfish
        const botElo = document.getElementById('bot-elo');
        if (botElo) {
            if (!botElo.options.length) {
                botElo.innerHTML = (window.BotEngine?.LEVELS || [300, 600, 900, 1320, 1500, 1800, 2100, 2400])
                    .map(v => `<option value="${v}">${window.BotEngine?.levelOption(v) || v}</option>`).join('');
            }
            botElo.value = String(window.BotEngine?.snapLevel(AppState.config.botElo || 1320) ?? 1320);
        }
        const botSide = document.getElementById('bot-side');
        if (botSide) botSide.value = AppState.config.botSide || 'random';

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
        syncWheelModeClass();
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
        ['btn-sync', 'btn-reset-sync', 'btn-snap-center', 'btn-calibrate', 'btn-repair-centering', 'btn-game-end'].forEach(id => {
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

    /** Libellé court d'une config : ⚡ instantané, ou durée + majorité/roue (+ votes par viewer) */
    presetChips(mode, c) {
        const label = document.querySelector(`.mode-option[data-mode="${mode}"] .mode-option__label`)?.textContent.trim() || mode;
        const chips = [label];
        if (!c.timerEnabled) chips.push(`⚡ ${tr('suggested.chipInstant')}`);
        else {
            chips.push(tr('suggested.chipSeconds', { n: c.timerDuration }));
            const majority = c.majorityMode || isPuzzleMode(mode);
            chips.push(tr(majority ? 'suggested.chipMajority' : 'suggested.chipWheel'));
            if (!majority && c.votesPerViewer > 1) chips.push(tr('suggested.chipVotes', { n: c.votesPerViewer }));
        }
        return chips;
    },

    renderPresets() {
        const list = document.getElementById('presets-list');
        if (!list) return;
        list.innerHTML = SETUP_PRESETS.map(p => `
            <button type="button" class="preset-card" data-preset="${p.id}">
                <span class="preset-card__icon" aria-hidden="true">${p.icon}</span>
                <span class="preset-card__body">
                    <span class="preset-card__name">${escapeHtml(tr(`suggested.${p.id}.name`))}</span>
                    <span class="preset-card__desc">${escapeHtml(tr(`suggested.${p.id}.desc`))}</span>
                    <span class="preset-card__chips">${(p.custom ? [tr('suggested.custom.chip')] : this.presetChips(p.mode, { votesPerViewer: 1, ...p.config })).map(c => `<span>${escapeHtml(c)}</span>`).join('')}</span>
                </span>
            </button>`).join('');
        this.markPreset();
    },

    markPreset() {
        const c = AppState.config;
        const matches = (p) => p.mode === AppState.gameMode && Object.entries(p.config).every(([k, v]) => c[k] === v);
        // « Personnaliser » est surligné dès que les réglages ne correspondent à aucune suggestion
        // (ou tant qu'on l'a choisi, jusqu'au clic sur une autre suggestion)
        const anyMatch = !this.customPicked && SETUP_PRESETS.some(p => !p.custom && matches(p));
        document.querySelectorAll('#presets-list [data-preset]').forEach(card => {
            const p = SETUP_PRESETS.find(x => x.id === card.dataset.preset);
            const on = !!p && (p.custom ? !anyMatch : !this.customPicked && matches(p));
            card.classList.toggle('is-active', on);
            card.setAttribute('aria-pressed', on);
        });
        // Le choix du mode de jeu n'apparaît qu'avec « Personnaliser » (une suggestion fixe déjà le mode)
        const modePanel = document.querySelector('#sandbox-setup .mode-selector')?.closest('.panel');
        // Les options du mode (niveau de Stockfish, pseudos…) sont dans leur propre panneau, toujours visibles
        if (modePanel) modePanel.hidden = anyMatch;
    },

    /** Remplit l'écran avec une configuration suggérée (sans lancer : on peut encore ajuster) */
    applyPreset(id) {
        const p = SETUP_PRESETS.find(x => x.id === id);
        if (!p) return;
        // Même chemin qu'un clic sur le mode (chargement des puzzles compris)
        this.customPicked = !!p.custom;
        if (p.mode) document.querySelector(`.mode-option[data-mode="${p.mode}"]`)?.click();
        Object.assign(AppState.config, p.config);
        this.syncUIFromState();
        Storage.saveConfig();
        this.markPreset();
        if (p.custom) {
            // Sur petit écran, les options sont sous les suggestions : on y descend
            const col = document.querySelector('#sandbox-setup .sandbox-setup__col:not(.launch-only)');
            if (col && col.getBoundingClientRect().top > window.innerHeight * 0.6) col.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
    },

    renderConfigs() {
        this.renderPresets();
        const container = document.getElementById('configs-list');
        if (!container) return;

        if (AppState.savedConfigs.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>${escapeHtml(tr('game.configuration.no-config'))}</p></div>`;
            return;
        }

        container.innerHTML = AppState.savedConfigs.map(config => `
            <div class="config-card" data-id="${escapeHtml(config.id)}">
                <div class="config-card__header">
                    <span class="config-card__name">${escapeHtml(config.name)}</span>
                    <button class="btn btn--icon btn--sm" data-delete="${config.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <span class="badge badge--purple">${escapeHtml(config.gameMode)}</span>
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
                Toast.info(tr('ui.toast.configDeleted'));
            });
        });
    },

    loadConfig(id) {
        const config = AppState.savedConfigs.find(c => c.id === id);
        if (!config) return;

        AppState.gameMode = config.gameMode === 'yolo' ? 'sandbox' : config.gameMode;
        Object.assign(AppState.config, config.config);
        AppState.config.timerDuration = clampTurn(AppState.config.timerDuration);
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
            this.initialized = true;
        } else {
            this.socket?.emit('getGames');
        }
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

        // Tableau, filtres et aperçu : js/pages/browseTable.js
        BrowseTable.setup(this.socket, (game) =>
            MultiRoom.buildHash(normalizeLogin(game.join.host), normalizeLogin(game.join.code), game.settings || {}, true));
        this.socket.on('gamesList', (games) => this.renderGames(games));
        this.socket.on('gamesListUpdated', (games) => this.renderGames(games));
    },

    renderGames(games) {
        BrowseTable.setGames(games);
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
        // Envoi seulement quand quelque chose change : la position suit presque en direct
        this.intervalId = setInterval(() => this.send(), 1000);
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
            waiting: lobby.active && lobby.open,
            ...this.position(),
            detail: SpectatorFeed.detail(mode),
            history: SpectatorFeed.history()
        };
    },

    /** Position, dernier coup et sens de l'échiquier, pour les spectateurs */
    position() {
        try {
            const chess = gameEngine.chess;
            if (!chess) return {};
            const last = chess.history({ verbose: true }).slice(-1)[0];
            return {
                fen: chess.fen(),
                lastMove: last ? { from: last.from, to: last.to } : null,
                orientation: gameEngine.board?.orientation?.() || 'white'
            };
        } catch {
            return {};
        }
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

/**
 * Ce que les spectateurs voient en plus de la position : votes en cours,
 * minuteur, historique et Puzzle Rush. Partie d'une chaîne : envoyé avec
 * l'annonce ; Multi : envoyé par la chaîne dont c'est le tour (game:detail).
 */
const SpectatorFeed = {
    lastMulti: null,

    detail(mode) {
        const d = { votes: [], timer: null, rush: null };
        try {
            d.votes = voting.getSortedResults().slice(0, 12).map(r => ({ m: r.move, n: r.count }));
            // Vote secret : les spectateurs n'ont que le nombre de votes
            if (secretVotes()) {
                d.sec = voting.getSortedResults().reduce((n, r) => n + (r.count || 0), 0);
                d.votes = [];
            }
        } catch {}
        if (timer.isRunning || timer.isPaused) {
            d.timer = { left: timer.remaining, total: timer.duration, paused: !!timer.isPaused };
        }
        // Mode roue : les spectateurs voient la même roue / bande, et le tirage
        try {
            if (document.body.classList.contains('has-draw')) d.wheel = gameEngine.wheelStyle;
            const spin = gameEngine.votingWheel?.spinInfo;
            // Tirage en cours ou gagnant encore affiché (2 s après l'arrêt)
            if (spin && Date.now() < spin.startedAt + spin.duration + 2000) {
                d.wheel = gameEngine.wheelStyle;
                d.draw = { votes: spin.votes, winner: spin.winner, duration: spin.duration, stop: spin.stop,
                    endsIn: Math.max(0, spin.startedAt + spin.duration - Date.now()) };
            }
        } catch {}
        // Couleurs du tirage, et score du vote de chaque coup pour la feuille de partie
        d.pal = getPaletteId();
        d.hv = (gameEngine.moveHistory || []).filter(m => m?.san).map(m => m.vote ?? null).slice(-400);
        if (mode === 'rush') {
            const s = rushManager.getState();
            d.rush = { score: s.score, strikes: s.strikes, maxStrikes: s.maxStrikes,
                rating: s.active ? s.targetRating : s.maxRating, mode: rushManager.config.mode };
        }
        return d;
    },

    history() {
        return (gameEngine.moveHistory || []).map(m => m?.san).filter(Boolean).slice(-400);
    },

    /** Toutes les secondes : écoute des spectateurs sur les sockets de jeu, détail Multi */
    start() {
        setInterval(() => {
            SpectatorsUI.bind(GameAnnouncer.socket);
            const manager = window.multiplayerManager;
            SpectatorsUI.bind(manager?.socket);
            if (!manager?.gameId || !manager.socket?.connected) { this.lastMulti = null; return; }
            const data = this.detail('chatVsChat');
            const key = JSON.stringify(data);
            if (key === this.lastMulti) return;
            this.lastMulti = key;
            manager.socket.emit('game:detail', data);
        }, 1000);
    }
};

/** Côté joueurs : badge 👁 dans la barre de la partie et panneau Spectateurs */
const SpectatorsUI = {
    data: null,

    bind(socket) {
        if (!socket || socket.__spectatorsBound) return;
        socket.__spectatorsBound = true;
        socket.on('spectators', (data) => this.render(data));
    },

    render(data) {
        this.data = data && data.count ? data : null;
        const count = this.data?.count || 0;
        const badge = document.getElementById('spectators-badge');
        if (badge) {
            badge.hidden = !count;
            badge.title = count ? spectatorsLabel(count) : '';
            const n = document.getElementById('spectators-count');
            if (n) n.textContent = String(count);
        }
        const panel = document.getElementById('spectators-panel');
        if (panel) {
            panel.hidden = !count;
            const c = document.getElementById('spectators-panel-count');
            if (c) c.textContent = count ? String(count) : '';
            renderSpectatorList(document.getElementById('spectators-list'), this.data, null);
        }
    }
};
window.addEventListener('languageChanged', () => SpectatorsUI.render(SpectatorsUI.data));

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

    ICONS: { success: 'fa-check', error: 'fa-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' },

    /** Carte sombre avec liseré de couleur ; la barre du bas montre le temps restant, le survol met en pause */
    show(message, type = 'info', duration = 6500) {
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.style.setProperty('--toast-life', `${duration}ms`);
        toast.innerHTML = `
            <span class="toast__icon"><i class="fas ${this.ICONS[type] || this.ICONS.info}"></i></span>
            <span class="toast__message">${message}</span>
            <button class="toast__close" aria-label="Fermer">&times;</button>
            <span class="toast__life"></span>
        `;
        // Pas plus de 4 à la fois : le plus ancien laisse sa place
        while (this.container.children.length >= 4) this.container.firstElementChild.remove();
        const leave = () => {
            if (toast.classList.contains('is-leaving')) return;
            toast.classList.add('is-leaving');
            setTimeout(() => toast.remove(), 250);
        };
        toast.querySelector('.toast__close').addEventListener('click', leave);
        toast.querySelector('.toast__life').addEventListener('animationend', leave);
        this.container.appendChild(toast);
        return toast;
    },

    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error', 9000); },
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
                Toast.info(tr('ui.toast.twitchOut'));
            } catch (e) {
                Toast.error(tr('ui.toast.twitchOutFailed'));
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
            Toast.success(tr('ui.toast.twitchIn', { name: user.displayName }));
        } else if (reason === 'expired') {
            await twitch.disconnect();
            Toast.warning(tr('ui.toast.twitchExpired'));
        } else if (reason === 'error') {
            Toast.error(tr('ui.toast.twitchRefused', { error: error || tr('ui.toast.unknownError') }));
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
        document.getElementById('pmRepair').hidden = !on;
        btn.disabled = !supported && !on;
        btn.classList.toggle('btn--danger', on);
        btn.querySelector('span').textContent = on ? t('phantomModal.disconnect', 'Déconnecter') : t('phantomModal.connect', 'Connecter');
    };
    // Vidéo chargée seulement à l'ouverture, et coupée à la fermeture
    const video = document.getElementById('pmVideo');
    const open = () => { render(); if (video && !video.src) video.src = video.dataset.src; overlay.classList.add('is-active'); };
    const close = () => { overlay.classList.remove('is-active'); video?.removeAttribute('src'); };
    window.openPhantomModal = open;

    overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.closest('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    document.getElementById('pmFactoryReset')?.addEventListener('click', () => {
        close();
        window.repairPhantomCentering?.();
    });

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
            Toast.success(tr('ui.toast.phantomOn'));
            close();
        } catch (e) {
            Toast.error(tr('ui.toast.phantomFailed'));
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

// Le statut Twitch de l'en-tête (pseudo ou « Non connecté ») est écrit par le gestionnaire, pas par data-i18n
window.addEventListener('languageChanged', () => twitch.updateUI());

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
            votesPerViewer: 1,
            timerDuration: Math.min(300, Math.max(5, parseInt(value('timer')) || 30)),
            majorityMode:  value('mode') === 'majority',
            wheelDuration: snapSpin(value('spin')),
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
        if (!this.initialized) {
            BrowsePage.rushModes['rush-page-records'] = rushMode();
            BrowsePage.bindRushModes(document.getElementById('page-rush'));
            document.getElementById('rush-page-start').addEventListener('click', () => {
                this.launch('rush', BrowsePage.rushModes['rush-page-records']);
            });
            this.initialized = true;
        }
        BrowsePage.loadRushRecords('rush-page-records');
    },

    launch(route, mode = '0') {
        if (!GameSession.confirmReplace()) return;
        GameSession.clear();
        AppState.config.rushTimer = RUSH_MODES.includes(mode) ? mode : '30';
        Storage.saveConfig();
        // Règles figées pour que les records restent comparables : rating de départ 100, pause 15 s.
        // Le temps pour voter vient du mode choisi. Rien de tout ça ne touche aux réglages de la partie libre.
        const seconds = parseInt(AppState.config.rushTimer, 10);
        GameSession.launch({
            route, gameMode: 'rush',
            config: { rushTimer: AppState.config.rushTimer, timerEnabled: seconds > 0, timerDuration: seconds || 30,
                      rushStartRating: 100, pauseAfterEnd: 15 }
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
                document.getElementById('mono-bot-group').style.display =
                    this.format === 'vsBot' ? '' : 'none';
            });
        });
        // Stockfish contre les inscrits : niveaux
        const elo = document.getElementById('mono-bot-elo');
        elo.innerHTML = (window.BotEngine?.LEVELS || [300, 600, 900, 1320, 1500, 1800, 2100, 2400])
            .map(v => `<option value="${v}"${v === 1320 ? ' selected' : ''}>${window.BotEngine?.levelOption(v) || v}</option>`).join('');
        document.getElementById('mono-start').addEventListener('click', () => {
            const config = PresetForm.read('mono');
            if (PresetForm.needsLogin(config)) { twitchAuth.login(); return; }
            if (!GameSession.confirmReplace()) return;
            GameSession.launch({
                route: 'mono',
                gameMode: 'mono',
                format: this.format,
                streamerColor: document.getElementById('mono-color').value,
                botElo: Number(document.getElementById('mono-bot-elo').value) || 1320,
                botSide: document.getElementById('mono-bot-side').value,
                config
            });
        });
    }
};

const MultiPage = {
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;
        PresetForm.bindToggles('multi');
        const isPublic = document.getElementById('multi-public');
        try { isPublic.checked = localStorage.getItem('multi_public') !== '0'; } catch {}
        const syncVisibility = () => {
            document.getElementById('multi-visibility').dataset.visibility = isPublic.checked ? 'public' : 'private';
            try { localStorage.setItem('multi_public', isPublic.checked ? '1' : '0'); } catch {}
        };
        isPublic.addEventListener('change', syncVisibility);
        syncVisibility();
        document.getElementById('multi-start').addEventListener('click', () => {
            const options = PresetForm.read('multi');
            options.anonymity = getAnonymity(); // imposé à l'adversaire
            if (PresetForm.needsLogin(options)) { twitchAuth.login(); return; }
            if (!GameSession.confirmReplace()) return;
            MultiRoom.open(normalizeLogin(twitchAuth.user.login), MultiRoom.newCode(), options, isPublic.checked);
            window.dispatchEvent(new CustomEvent('cg:gameStart', { detail: { mode: 'multi' } }));
        });
    }
};

// ============================================
// ROUTES PRÉCONFIGURÉES : SALON ET PARTIE
// ============================================
/** Récap en tête de la colonne de gauche : mode de la partie et ses réglages (même présentation qu'au 24/24) */
const GameRecap = {
    title() {
        const route = GameSession.current?.route;
        if (route === 'mono') {
            const format = GameSession.current?.format;
            return `Mono · ${tr(`mono.${format === 'teams' || format === 'vsBot' ? format : 'vsStreamer'}`)}`;
        }
        if (route === 'multi') return `⚔ ${tr('nav.multi')}`;
        const mode = GameSession.liveMode || AppState.gameMode;
        const names = {
            sandbox: '🎲 YOLO',
            problems: `🧩 ${tr('gameMode.problems.label')}`,
            oneVsAll: '👤 1 vs All',
            oneVsOne: '⚔️ 1 vs 1',
            chatVsChat: '🎭 Chat vs Chat',
            vsBot: `🤖 ${tr('gameMode.vsBot.label')}`
        };
        return names[mode] || null;
    },

    render() {
        const el = document.getElementById('game-recap');
        if (!el) return;
        const mode = GameSession.liveMode || AppState.gameMode;
        // Le Puzzle Rush a déjà son bloc (score, vies, rating)
        const title = GameSession.running && mode !== 'rush' ? this.title() : null;
        el.hidden = !title;
        if (!title) return;
        document.getElementById('game-recap-title').textContent = title;
        const none = tr('settingsSummary.none');
        const rows = SandboxPage.settingsRows().filter(([icon, , v]) => !(icon === 'fa-lock' && v === none));
        document.getElementById('game-recap-opts').innerHTML = rows.map(([icon, k, v]) =>
            `<div class="h24-opt"><i class="fas ${icon}"></i><span class="h24-opt__label">${escapeHtml(k)}</span><span class="h24-opt__value">${escapeHtml(v)}</span></div>`).join('');
    }
};
window.addEventListener('languageChanged', () => GameRecap.render());

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
                this.renderChatStatus();
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
        const { format, streamerColor, botElo, botSide } = GameSession.current;
        if (format === 'vsBot') {
            // Stockfish contre les inscrits : ils votent pour un camp, Stockfish joue l'autre
            const chat = botSide === 'w' || botSide === 'b' ? botSide : (Math.random() < 0.5 ? 'w' : 'b');
            gameEngine.session = { humanColor: null };
            gameEngine.vsBot = { color: chat === 'w' ? 'b' : 'w', elo: window.BotEngine?.snapLevel(botElo || 1320) ?? 1320 };
            gameEngine.board.orientation(chat === 'w' ? 'white' : 'black');
            this.startLobby({ format, channel: login, streamer: login, color: chat });
        } else if (format === 'vsStreamer') {
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

    /** Le chat du streamer doit être lu pour que ses viewers s'inscrivent et votent */
    renderChatStatus() {
        const el = document.getElementById('roster-chat');
        if (!el) return;
        const login = normalizeLogin(twitchAuth.user?.login);
        if (!lobby.active || !login) { el.hidden = true; return; }
        const state = twitch.connectionState;
        const ok = twitch.isConnected && twitch.channel === login;
        el.hidden = false;
        el.className = 'roster__chat' + (ok ? ' is-ok' : state === 'connecting' ? ' is-pending' : ' is-off');
        el.textContent = '';
        const text = document.createElement('span');
        text.textContent = tr(ok ? 'roster.chatOk' : state === 'connecting' ? 'roster.chatConnecting' : 'roster.chatOff', { channel: login });
        el.appendChild(text);
        if (!ok && state !== 'connecting') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn--sm';
            btn.textContent = tr('roster.chatRetry');
            btn.addEventListener('click', () => twitch.connect(login).catch(() => Toast.error(tr('roster.chatFailed'))));
            el.appendChild(btn);
        }
    },

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
                // Salon Multi : le lien contient le code, il n'est jamais affiché (anti stream-hack)
                const link = MultiRoom.room ? MultiRoom.inviteLink() : window.location.href;
                navigator.clipboard.writeText(link).then(() => {
                    Toast.success(tr(MultiRoom.room ? 'multi.linkCopied' : 'lobby.linkCopied'));
                    window.dispatchEvent(new CustomEvent('cg:linkCopied', { detail: {} }));
                });
            },
            'login':     () => twitchAuth.login(),
            'rematch':   () => this.rematch(),
            'new-lobby': () => GameSession.launch(GameSession.current),
            'revenge':   () => GameSession.restart(routeHash()),
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
            this.renderChatStatus();
        });
        window.addEventListener('twitchStateChange', () => this.renderChatStatus());
    }
};

const MultiRoom = {
    room: null,
    STORE: 'multiInvite',

    /** Code secret du salon : seul le lien d'invitation le contient */
    newCode() {
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        return [...bytes].map(b => (b % 36).toString(36)).join('');
    },

    buildHash(host, code, settings, isPublic) {
        const query = new URLSearchParams({ timer: settings.timerDuration, mode: settings.majorityMode ? 'majority' : 'wheel', spin: snapSpin(settings.wheelDuration) });
        if (settings.subsOnly) query.set('subs', '1');
        if (settings.followersOnly) query.set('followers', '1');
        if (settings.anonymity && settings.anonymity !== 'none') query.set('anon', settings.anonymity);
        if (isPublic) query.set('public', '1');
        return `#/multi/${host}/${code}?${query}`;
    },

    /** Entre dans un nouveau salon sans jamais afficher son code dans la barre d'adresse */
    open(host, code, settings, isPublic) {
        const room = { a: host, code, isPublic: !!isPublic, settings: { ...settings } };
        try { sessionStorage.setItem(this.STORE, JSON.stringify(room)); } catch {}
        go(`/multi/${host}`);
    },

    inviteLink() {
        const r = this.room;
        return `${location.origin}${toUrl(this.buildHash(r.a, r.code, r.settings, r.isPublic))}`;
    },

    /**
     * #/multi/<hôte>/<code> : lien d'invitation. Le code part en sessionStorage et
     * la barre d'adresse redevient #/multi/<hôte> pour qu'il n'apparaisse pas en stream.
     * #/multi/<hôte> : reprise (F5, retour à la partie) grâce à la session.
     */
    parse(path, query) {
        const match = /^\/multi\/([^/?]+)(?:\/([^/?]+))?$/.exec(path);
        if (!match) return null;
        const host = normalizeLogin(match[1]);
        if (match[2]) {
            const params = new URLSearchParams(query || '');
            const room = {
                a: host,
                code: normalizeLogin(match[2]),
                isPublic: params.get('public') === '1',
                settings: {
                    timerDuration: Math.min(300, Math.max(5, parseInt(params.get('timer')) || 30)),
                    majorityMode:  params.get('mode') === 'majority',
                    wheelDuration: snapSpin(params.get('spin')),
                    followersOnly: params.get('followers') === '1',
                    subsOnly:      params.get('subs') === '1',
                    anonymity:     ANON_MODES.includes(params.get('anon')) ? params.get('anon') : 'none'
                }
            };
            try { sessionStorage.setItem(this.STORE, JSON.stringify(room)); } catch {}
            history.replaceState(null, '', `#/multi/${host}`);
            return room;
        }
        let saved = null;
        try { saved = JSON.parse(sessionStorage.getItem(this.STORE) || 'null'); } catch {}
        if (saved?.a === host && saved.code) return saved;
        return { a: host, code: null, isPublic: false, settings: { timerDuration: 30, majorityMode: false, followersOnly: false, subsOnly: false } };
    },

    isSame(room) {
        return !!this.room && room.a === this.room.a && room.code === this.room.code;
    },

    /** Avant SandboxPage.init : le moteur démarre avec les réglages du lien */
    prepare(room) {
        this.room = room;
        forceAnonymity(room.settings?.anonymity || 'none');
        GameSession.activate({
            route: 'multi',
            gameMode: 'multi',
            config: { ...room.settings, timerEnabled: true, votesPerViewer: 1 }
        });
    },

    /** Après la restauration de Twitch : entrée réelle dans le salon */
    enter() {
        const { a, code, settings, isPublic } = this.room;
        const login = normalizeLogin(twitchAuth.user?.login);
        const title = tr('multi.roomTitle', { host: a });

        if (!this.listening) {
            this.listening = true;
            window.addEventListener('multiRoomState', (e) => this.room && this.onState(e.detail));
            window.addEventListener('multiRoomDenied', (e) => this.room && this.deny(e.detail.reason));
            window.addEventListener('multiPartnerLeft', () => this.room && this.onPartnerLeft());
        }

        if (!code) {
            this.deny('invalid');
            return;
        }
        if (!login) {
            PresetGame.setBanner({
                title,
                hintKey: 'multi.loginRequired',
                actions: ['login', 'back']
            });
            return;
        }
        if (settings.followersOnly && !twitchAuth.canCheckFollowers) {
            PresetGame.setBanner({
                title,
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
        this.opponent = login === a ? null : a;
        if (!(twitch.isConnected && twitch.channel === login)) {
            twitch.connect(login).catch(() => Toast.error(tr('roster.chatFailed')));
        }
        window.multiplayerManager.enterRoom({ host: a, code, login, token: twitchAuth.token, settings, isPublic });
    },

    onState({ a, b, present, remainingMs, settings, isPublic }) {
        // L'hôte fixe les réglages de la partie
        twitch.settings.subsOnly = settings.subsOnly;
        lobby.verifyJoin = PresetGame.followerCheck(settings.followersOnly);
        forceAnonymity(settings.anonymity || 'none');
        Object.assign(this.room, { settings, isPublic: !!isPublic });
        const login = normalizeLogin(twitchAuth.user?.login);
        this.opponent = login === a ? b : a;

        if (present.length < 2) {
            PresetGame.stopCountdown();
            PresetGame.setBanner(this.opponent ? {
                titleKey: 'multi.waiting',
                params: { name: this.opponent },
                hintKey: 'multi.waitingHint',
                actions: ['copy-link', 'back']
            } : {
                titleKey: 'multi.waitingAny',
                hintKey: isPublic ? 'multi.waitingPublicHint' : 'multi.waitingPrivateHint',
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
        PresetGame.setBanner({
            titleKey: `multi.denied.${reason}`,
            params: { host: this.room?.a || '' },
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
        forceAnonymity(null);
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
    SpectatorFeed.start();
    console.log('🚀 Crowd Gambit - Initialisation...');

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
    // Session restaurée sans événement twitchAuthChange : on charge le compte (niveau, pions, succès, objets)
    window.economy?.refresh();

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

            // ---- Sans minuteur (⚡ instantané) : le premier coup légal du chat est joué ----
            if (!gameEngine.config.timerEnabled && !voting.isOpen) {
                if (!['sandbox', 'game'].includes(AppState.currentPage) || gameEngine.chess.game_over()) return;
                if (gameEngine.session && gameEngine.canHumanPlay()) return; // tour du streamer
                if (gameEngine.engineToMove()) return;                         // tour de Stockfish
                // Une rafale de messages ne joue pas deux coups d'affilée
                if (Date.now() < (twitch.instantCooldownUntil || 0)) return;
                const resolved = matchLegalMove(gameEngine.chess, voteContext.move);
                if (!resolved) return;
                twitch.instantCooldownUntil = Date.now() + 1000;
                window.ViewerStats?.recordTurn('game',
                    [{ login: voteContext.username, name: voteContext.displayName, move: resolved.san }],
                    (m) => m === resolved.san);
                gameEngine.executeMove(resolved.san);
                gameEngine.updateAvailableMoves();
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
                voting.addVote(voteContext.username, resolved.san, { twitch: true, name: voteContext.displayName });
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
                votesPerViewer: AppState.config.votesPerViewer
            });
            SandboxPage.initialized = true;
        } else {
            gameEngine.config.timerEnabled  = true;
            gameEngine.config.timerDuration = timerDuration;
            gameEngine.config.majorityMode  = majorityMode;
        }

        if (MultiRoom.room) MultiRoom.onGameReady();
        gameEngine.startGame();
        GameRecap.render();

        // Rendre le Toast accessible au multiplayerManager
        window.AppToast = Toast;

        Toast.success(tr('ui.toast.battle', { white: players.white, black: players.black }));
        console.log(`🎮 Partie multi démarrée : ${players.white} vs ${players.black}`);
    });
    if (MultiRoom.room) MultiRoom.enter();

    if (sessionStorage.getItem('autoStart') === '1') {
        sessionStorage.removeItem('autoStart');
        // Attendre que SandboxPage soit init via le Router
        setTimeout(() => SandboxPage.applyConfigAfterReload(), 100);
        GameAnnouncer.start();
    }
    // Réparation du centrage, commune aux menus Phantom et à la fenêtre Phantom.
    // Position à reposer : partie suivie par la page (Live, Tournoi) ou partie de l'app.
    window.repairPhantomCentering = async () => {
        const phantom = window.phantomChessboard;
        if (!phantom?.isConnected || !phantom.confirmRepair()) return;
        const route = (routeHash().split('/')[1] || '').split('?')[0];
        const provider = window.phantomPositionProviders?.[route];
        const fen = provider ? provider() : (gameEngine.isRunning ? gameEngine.chess?.fen() : null);
        Toast.show(tr('ui.toast.repairStart'), 'info', 8000);
        const ok = await phantom.repairCentering(() => fen);
        updateConnectionUI();
        if (ok) Toast.success(tr('ui.toast.repairOk'));
        else Toast.show(tr('ui.toast.repairFail'), 'error', 10000);
    };

    window.addEventListener('phantomError', (e) => showPhantomError(e.detail));
    // Capteurs en désaccord avec la position : fenêtre avec la position souhaitée et les cases fautives
    window.addEventListener('phantomSensorMismatch', (e) => showSensorAlert(e.detail));
    window.addEventListener('phantomSensorsOk', () => sensorsOk());

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

    console.log('✅ Crowd Gambit prêt !');
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