/**
 * APP.JS - Point d'entrée principal de l'application Twitchess
 * Initialise tous les modules et coordonne l'application
 */

// ========== Imports des modules core ==========
import { Config } from './core/config.js';
import { Constants } from './core/constants.js';
import { Utils } from './core/utils.js';

// ========== Imports des modules chess ==========
import { ChessBoard } from './chess/board.js';
import { ChessEngine } from './chess/engine.js';
import { MovesManager } from './chess/moves.js';
//import { Validation } from './chess/validation.js';
//import { Notation } from './chess/notation.js';

// ========== Imports des features ==========
import { VotingSystem } from './features/voting.js';
import { Timer } from './features/timer.js';
//import { ThemesManager } from './features/themes.js';
//import { ProblemsManager } from './features/problems.js';
//import { AnalysisEngine } from './features/analysis.js';
//import { HistoryManager } from './features/history.js';

// ========== Imports UI ==========
import { DOMManager } from './ui/dom.js';
//import { EventManager } from './ui/events.js';
//import { ModalsManager } from './ui/modals.js';
//import { ChartsManager } from './ui/charts.js';
//import { AnimationsManager } from './ui/animations.js';
//import { NotificationsManager } from './ui/notifications.js';

// ========== Imports integrations ==========
import { TwitchClient } from './integrations/twitch.js';
//import { WebSocketManager } from './integrations/websocket.js';
//import { MultiplayerManager } from './integrations/multiplayer.js';
import { StorageManager } from './integrations/storage.js';

/**
 * Classe principale de l'application Twitchess
 */
class TwitchessApp {
    constructor() {
        this.config = new Config();
        this.constants = new Constants();
        this.utils = new Utils();
        
        // État de l'application
        this.state = {
            gameMode: 'solo', // solo, twitch, multiplayer
            isPlaying: false,
            isPaused: false,
            currentTurn: 'white',
            moveNumber: 1,
            timeLeft: null,
            votingActive: false
        };
        
        // Modules principaux
        this.modules = {
            chess: null,
            voting: null,
            timer: null,
            ui: null,
            twitch: null,
            multiplayer: null
        };
        
        // Données
        this.data = {
            moves: [],
            votes: new Map(),
            problems: [],
            themes: [],
            players: {}
        };
    }

    /**
     * Initialise l'application
     */
    async init() {
        try {
            console.log('🚀 Initialisation de Twitchess...');
            
            // Charger la configuration depuis le localStorage
            await this.loadConfiguration();
            
            // Initialiser les modules dans l'ordre
            await this.initializeCore();
            await this.initializeUI();
            await this.initializeChess();
            await this.initializeFeatures();
            await this.initializeIntegrations();
            
            // Attacher les événements globaux
            this.attachGlobalEvents();
            
            // Restaurer l'état précédent si disponible
            await this.restoreState();
            
            // Marquer l'application comme prête
            this.setReady();
            
            console.log('✅ Twitchess initialisé avec succès!');
        } catch (error) {
            console.error('❌ Erreur lors de l\'initialisation:', error);
            this.handleInitError(error);
        }
    }

    /**
     * Charge la configuration
     */
    async loadConfiguration() {
        const storage = new StorageManager();
        const savedConfig = await storage.get('config');
        
        if (savedConfig) {
            this.config.update(savedConfig);
            console.log('📋 Configuration chargée:', savedConfig);
        }
    }

    /**
     * Initialise les modules core
     */
    async initializeCore() {
        console.log('🎯 Initialisation du core...');
        
        // Initialiser le moteur d'échecs
        this.modules.chess = {
            engine: new ChessEngine(),
            moves: new MovesManager(),
            validation: new Validation(),
            notation: new Notation()
        };
    }

    /**
     * Initialise l'interface utilisateur
     */
    async initializeUI() {
        console.log('🎨 Initialisation de l\'interface...');
        
        this.modules.ui = {
            dom: new DOMManager(),
            events: new EventManager(this),
            modals: new ModalsManager(),
            charts: new ChartsManager(),
            animations: new AnimationsManager(),
            notifications: new NotificationsManager()
        };
        
        // Initialiser l'interface de base
        await this.modules.ui.dom.initialize();
    }

    /**
     * Initialise l'échiquier
     */
    async initializeChess() {
        console.log('♟️ Initialisation de l\'échiquier...');
        
        // Créer l'échiquier
        this.modules.board = new ChessBoard('myBoard', {
            draggable: true,
            position: 'start',
            onDragStart: this.handleDragStart.bind(this),
            onDrop: this.handleDrop.bind(this),
            onSnapEnd: this.handleSnapEnd.bind(this),
            onMoveEnd: this.handleMoveEnd.bind(this)
        });
        
        // Initialiser le moteur
        await this.modules.chess.engine.initialize();
    }

    /**
     * Initialise les fonctionnalités
     */
    async initializeFeatures() {
        console.log('⚡ Initialisation des fonctionnalités...');
        
        // Système de vote
        this.modules.voting = new VotingSystem(this);
        await this.modules.voting.initialize();
        
        // Timer
        this.modules.timer = new Timer(this.config.get('timePerMove'));
        this.modules.timer.onExpire = this.handleTimeExpired.bind(this);
        
        // Gestionnaire de thèmes
        this.modules.themes = new ThemesManager();
        await this.modules.themes.loadThemes();
        
        // Gestionnaire de problèmes
        this.modules.problems = new ProblemsManager();
        await this.modules.problems.loadProblems();
        
        // Analyse
        this.modules.analysis = new AnalysisEngine(this.modules.chess.engine);
        
        // Historique
        this.modules.history = new HistoryManager();
    }

    /**
     * Initialise les intégrations externes
     */
    async initializeIntegrations() {
        console.log('🔌 Initialisation des intégrations...');
        
        const gameMode = this.config.get('gameMode');
        
        // Twitch
        if (gameMode === 'twitch' && this.config.get('twitchEnabled')) {
            this.modules.twitch = new TwitchClient(this.config.get('twitchChannel'));
            this.modules.twitch.onMessage = this.handleTwitchMessage.bind(this);
            await this.modules.twitch.connect();
        }
        
        // Multijoueur
        if (gameMode === 'multiplayer') {
            this.modules.websocket = new WebSocketManager(this.config.get('serverUrl'));
            this.modules.multiplayer = new MultiplayerManager(this.modules.websocket);
            await this.modules.multiplayer.initialize();
        }
        
        // Storage
        this.modules.storage = new StorageManager();
    }

    /**
     * Attache les événements globaux
     */
    attachGlobalEvents() {
        // Boutons de contrôle principaux
        const startBtn = document.getElementById('startBtn');
        const pauseBtn = document.getElementById('pauseBtn');
        const resetBtn = document.getElementById('resetBtn');
        
        if (startBtn) startBtn.addEventListener('click', () => this.startGame());
        if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetGame());
        
        // Raccourcis clavier
        document.addEventListener('keydown', (e) => {
            if (e.key === ' ' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                this.togglePause();
            }
            if (e.key === 'Escape') {
                this.modules.ui.modals.closeAll();
            }
        });
        
        // Sauvegarde automatique
        setInterval(() => this.saveState(), 30000); // Toutes les 30 secondes
    }

    /**
     * Démarre une partie
     */
    async startGame() {
        console.log('🎮 Démarrage de la partie...');
        
        this.state.isPlaying = true;
        this.state.isPaused = false;
        
        // Réinitialiser l'échiquier si nécessaire
        if (this.data.moves.length === 0) {
            this.modules.board.start();
            this.modules.chess.engine.reset();
        }
        
        // Démarrer le timer
        if (this.config.get('timerEnabled')) {
            this.modules.timer.start();
        }
        
        // Activer les votes si nécessaire
        if (this.config.get('votingEnabled')) {
            this.modules.voting.startVoting();
            this.state.votingActive = true;
        }
        
        // Notifier l'UI
        this.modules.ui.dom.updateGameState(this.state);
        this.modules.ui.notifications.show('Partie démarrée!', 'success');
        
        // Émettre l'événement
        this.emit('gameStarted', this.state);
    }

    /**
     * Met en pause/reprend la partie
     */
    togglePause() {
        if (!this.state.isPlaying) return;
        
        this.state.isPaused = !this.state.isPaused;
        
        if (this.state.isPaused) {
            this.modules.timer?.pause();
            this.modules.voting?.pause();
            this.modules.ui.notifications.show('Partie en pause', 'info');
        } else {
            this.modules.timer?.resume();
            this.modules.voting?.resume();
            this.modules.ui.notifications.show('Partie reprise', 'info');
        }
        
        this.modules.ui.dom.updateGameState(this.state);
        this.emit('gamePaused', this.state.isPaused);
    }

    /**
     * Réinitialise la partie
     */
    async resetGame() {
        const confirmed = await this.modules.ui.modals.confirm(
            'Êtes-vous sûr de vouloir réinitialiser la partie?'
        );
        
        if (!confirmed) return;
        
        console.log('🔄 Réinitialisation de la partie...');
        
        // Réinitialiser l'état
        this.state = {
            gameMode: this.state.gameMode,
            isPlaying: false,
            isPaused: false,
            currentTurn: 'white',
            moveNumber: 1,
            timeLeft: null,
            votingActive: false
        };
        
        // Réinitialiser les données
        this.data.moves = [];
        this.data.votes.clear();
        
        // Réinitialiser les modules
        this.modules.board.start();
        this.modules.chess.engine.reset();
        this.modules.timer?.reset();
        this.modules.voting?.reset();
        this.modules.history.clear();
        
        // Mettre à jour l'UI
        this.modules.ui.dom.updateGameState(this.state);
        this.modules.ui.notifications.show('Partie réinitialisée', 'info');
        
        // Émettre l'événement
        this.emit('gameReset');
    }

    /**
     * Gère le début du drag d'une pièce
     */
    handleDragStart(source, piece, position, orientation) {
        // Vérifier si le jeu est actif
        if (!this.state.isPlaying || this.state.isPaused) {
            return false;
        }
        
        // Vérifier si c'est le bon tour
        const turn = this.modules.chess.engine.turn();
        if ((turn === 'w' && piece.search(/^b/) !== -1) ||
            (turn === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }
        
        // Si votes actifs, empêcher le drag manuel
        if (this.state.votingActive && this.config.get('votingOnly')) {
            this.modules.ui.notifications.show('Les coups sont décidés par vote!', 'warning');
            return false;
        }
        
        return true;
    }

    /**
     * Gère le drop d'une pièce
     */
    handleDrop(source, target, piece, newPos, oldPos, orientation) {
        // Valider le coup
        const move = this.modules.chess.engine.move({
            from: source,
            to: target,
            promotion: 'q' // TODO: Demander la promotion
        });
        
        if (move === null) {
            // Coup illégal
            return 'snapback';
        }
        
        // Enregistrer le coup
        this.recordMove(move);
        
        // Mettre à jour l'état
        this.updateGameState();
        
        return true;
    }

    /**
     * Gère la fin du snap
     */
    handleSnapEnd() {
        // Mettre à jour la position
        this.modules.board.position(this.modules.chess.engine.fen());
    }

    /**
     * Gère la fin d'un mouvement
     */
    handleMoveEnd(oldPos, newPos) {
        // Vérifier les conditions de fin de partie
        this.checkGameEnd();
        
        // Redémarrer le timer pour le prochain coup
        if (this.config.get('timerEnabled')) {
            this.modules.timer.restart();
        }
        
        // Démarrer le vote pour le prochain coup si nécessaire
        if (this.state.votingActive) {
            this.modules.voting.startNewVote();
        }
    }

    /**
     * Gère l'expiration du timer
     */
    handleTimeExpired() {
        if (this.state.votingActive) {
            // Choisir le coup le plus voté
            const bestMove = this.modules.voting.getBestMove();
            if (bestMove) {
                this.playMove(bestMove);
            }
        } else {
            // Jouer un coup aléatoire ou passer le tour
            this.playRandomMove();
        }
    }

    /**
     * Gère les messages Twitch
     */
    handleTwitchMessage(channel, tags, message, self) {
        if (self) return; // Ignorer ses propres messages
        
        // Parser le message pour un vote
        const vote = this.modules.voting.parseVote(message);
        if (vote) {
            this.modules.voting.addVote(tags.username, vote);
        }
    }

    /**
     * Joue un coup
     */
    playMove(moveStr) {
        const move = this.modules.chess.engine.move(moveStr);
        if (move) {
            this.modules.board.move(`${move.from}-${move.to}`);
            this.recordMove(move);
            this.updateGameState();
            this.checkGameEnd();
        }
    }

    /**
     * Joue un coup aléatoire
     */
    playRandomMove() {
        const moves = this.modules.chess.engine.moves();
        if (moves.length > 0) {
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            this.playMove(randomMove);
        }
    }

    /**
     * Enregistre un coup
     */
    recordMove(move) {
        this.data.moves.push(move);
        this.modules.history.add(move);
        this.state.moveNumber = Math.floor(this.data.moves.length / 2) + 1;
        
        // Mettre à jour l'UI
        this.modules.ui.dom.addMoveToHistory(move);
        
        // Émettre l'événement
        this.emit('movePlayed', move);
    }

    /**
     * Met à jour l'état du jeu
     */
    updateGameState() {
        this.state.currentTurn = this.modules.chess.engine.turn() === 'w' ? 'white' : 'black';
        this.modules.ui.dom.updateGameState(this.state);
    }

    /**
     * Vérifie la fin de partie
     */
    checkGameEnd() {
        const chess = this.modules.chess.engine;
        
        if (chess.game_over()) {
            this.state.isPlaying = false;
            
            let message = '';
            if (chess.in_checkmate()) {
                const winner = chess.turn() === 'w' ? 'Noirs' : 'Blancs';
                message = `Échec et mat! Les ${winner} gagnent!`;
            } else if (chess.in_draw()) {
                message = 'Partie nulle!';
            } else if (chess.in_stalemate()) {
                message = 'Pat!';
            } else if (chess.in_threefold_repetition()) {
                message = 'Nulle par répétition!';
            }
            
            this.modules.ui.notifications.show(message, 'info');
            this.modules.ui.modals.showGameEnd(message, this.data.moves);
            
            this.emit('gameEnded', {
                result: message,
                moves: this.data.moves
            });
        }
    }

    /**
     * Sauvegarde l'état
     */
    async saveState() {
        const stateToSave = {
            state: this.state,
            data: {
                moves: this.data.moves,
                fen: this.modules.chess.engine.fen()
            },
            config: this.config.getAll()
        };
        
        await this.modules.storage?.save('gameState', stateToSave);
    }

    /**
     * Restaure l'état
     */
    async restoreState() {
        const savedState = await this.modules.storage?.get('gameState');
        if (savedState) {
            // Restaurer la position
            if (savedState.data?.fen) {
                this.modules.chess.engine.load(savedState.data.fen);
                this.modules.board.position(savedState.data.fen);
            }
            
            // Restaurer les coups
            if (savedState.data?.moves) {
                this.data.moves = savedState.data.moves;
                this.modules.history.restore(savedState.data.moves);
            }
            
            console.log('📂 État restauré');
        }
    }

    /**
     * Émet un événement
     */
    emit(eventName, data) {
        window.dispatchEvent(new CustomEvent(`twitchess:${eventName}`, { detail: data }));
    }

    /**
     * Marque l'application comme prête
     */
    setReady() {
        document.body.classList.add('app-ready');
        this.emit('ready');
    }

    /**
     * Gère les erreurs d'initialisation
     */
    handleInitError(error) {
        console.error('Erreur fatale:', error);
        this.modules.ui?.notifications?.show(
            'Erreur lors du chargement de l\'application',
            'error'
        );
    }
}

// ========== Initialisation de l'application ==========
document.addEventListener('DOMContentLoaded', () => {
    // Créer l'instance globale
    window.twitchess = new TwitchessApp();
    
    // Initialiser l'application
    window.twitchess.init().catch(error => {
        console.error('Erreur lors de l\'initialisation:', error);
    });
});

// Export pour les modules
export { TwitchessApp };