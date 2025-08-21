/**
 * CONSTANTS.JS - Constantes globales de l'application
 */

export class Constants {
    constructor() {
        // ========== Pièces d'échecs ==========
        this.PIECES = {
            WHITE_KING: 'wK',
            WHITE_QUEEN: 'wQ',
            WHITE_ROOK: 'wR',
            WHITE_BISHOP: 'wB',
            WHITE_KNIGHT: 'wN',
            WHITE_PAWN: 'wP',
            BLACK_KING: 'bK',
            BLACK_QUEEN: 'bQ',
            BLACK_ROOK: 'bR',
            BLACK_BISHOP: 'bB',
            BLACK_KNIGHT: 'bN',
            BLACK_PAWN: 'bP'
        };

        // ========== Valeurs des pièces ==========
        this.PIECE_VALUES = {
            'p': 1,
            'n': 3,
            'b': 3,
            'r': 5,
            'q': 9,
            'k': 0
        };

        // ========== Cases de l'échiquier ==========
        this.SQUARES = [
            'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
            'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
            'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
            'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
            'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
            'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
            'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
            'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1'
        ];

        // ========== Colonnes ==========
        this.FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        
        // ========== Rangées ==========
        this.RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

        // ========== Position de départ (FEN) ==========
        this.START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

        // ========== Couleurs ==========
        this.COLORS = {
            WHITE: 'w',
            BLACK: 'b'
        };

        // ========== États de la partie ==========
        this.GAME_STATES = {
            NOT_STARTED: 'not_started',
            IN_PROGRESS: 'in_progress',
            PAUSED: 'paused',
            CHECK: 'check',
            CHECKMATE: 'checkmate',
            DRAW: 'draw',
            STALEMATE: 'stalemate',
            THREEFOLD_REPETITION: 'threefold_repetition',
            INSUFFICIENT_MATERIAL: 'insufficient_material',
            FIFTY_MOVES: 'fifty_moves',
            TIMEOUT: 'timeout',
            ABANDONED: 'abandoned'
        };

        // ========== Types de coups spéciaux ==========
        this.MOVE_TYPES = {
            NORMAL: 'normal',
            CAPTURE: 'capture',
            CASTLE_KINGSIDE: 'castle_kingside',
            CASTLE_QUEENSIDE: 'castle_queenside',
            EN_PASSANT: 'en_passant',
            PROMOTION: 'promotion',
            CHECK: 'check',
            CHECKMATE: 'checkmate'
        };

        // ========== Codes de promotion ==========
        this.PROMOTION_PIECES = {
            QUEEN: 'q',
            ROOK: 'r',
            BISHOP: 'b',
            KNIGHT: 'n'
        };

        // ========== Thèmes d'échiquier ==========
        this.BOARD_THEMES = {
            DEFAULT: 'default',
            BLUE: 'blue',
            GREEN: 'green',
            BROWN: 'brown',
            PURPLE: 'purple',
            GREY: 'grey',
            WOOD: 'wood',
            MARBLE: 'marble'
        };

        // ========== Thèmes de pièces ==========
        this.PIECE_THEMES = {
            DEFAULT: 'default',
            CLASSIC: 'classic',
            MODERN: 'modern',
            WOOD: 'wood',
            METAL: 'metal',
            GLASS: 'glass',
            PIXEL: 'pixel'
        };

        // ========== Sons ==========
        this.SOUNDS = {
            MOVE: 'move.mp3',
            CAPTURE: 'capture.mp3',
            CASTLE: 'castle.mp3',
            CHECK: 'check.mp3',
            CHECKMATE: 'checkmate.mp3',
            DRAW: 'draw.mp3',
            ILLEGAL: 'illegal.mp3',
            TICK: 'tick.mp3',
            TIMEOUT: 'timeout.mp3',
            START: 'start.mp3',
            END: 'end.mp3'
        };

        // ========== Événements ==========
        this.EVENTS = {
            // Partie
            GAME_START: 'gameStart',
            GAME_END: 'gameEnd',
            GAME_PAUSE: 'gamePause',
            GAME_RESUME: 'gameResume',
            GAME_RESET: 'gameReset',
            
            // Coups
            MOVE_START: 'moveStart',
            MOVE_END: 'moveEnd',
            MOVE_ILLEGAL: 'moveIllegal',
            MOVE_UNDO: 'moveUndo',
            MOVE_REDO: 'moveRedo',
            
            // Timer
            TIMER_START: 'timerStart',
            TIMER_STOP: 'timerStop',
            TIMER_TICK: 'timerTick',
            TIMER_EXPIRE: 'timerExpire',
            TIMER_WARNING: 'timerWarning',
            
            // Votes
            VOTE_START: 'voteStart',
            VOTE_END: 'voteEnd',
            VOTE_RECEIVED: 'voteReceived',
            VOTE_UPDATE: 'voteUpdate',
            
            // Connexion
            CONNECT: 'connect',
            DISCONNECT: 'disconnect',
            RECONNECT: 'reconnect',
            ERROR: 'error',
            
            // UI
            MODAL_OPEN: 'modalOpen',
            MODAL_CLOSE: 'modalClose',
            NOTIFICATION_SHOW: 'notificationShow',
            THEME_CHANGE: 'themeChange',
            LANGUAGE_CHANGE: 'languageChange'
        };

        // ========== Messages d'erreur ==========
        this.ERROR_MESSAGES = {
            INVALID_MOVE: 'Coup invalide',
            NOT_YOUR_TURN: 'Ce n\'est pas votre tour',
            GAME_NOT_STARTED: 'La partie n\'a pas commencé',
            GAME_OVER: 'La partie est terminée',
            CONNECTION_LOST: 'Connexion perdue',
            INVALID_FEN: 'Position FEN invalide',
            INVALID_PGN: 'PGN invalide',
            SERVER_ERROR: 'Erreur serveur',
            TIMEOUT: 'Temps écoulé'
        };

        // ========== Limites ==========
        this.LIMITS = {
            MAX_MOVES: 500,
            MAX_HISTORY: 100,
            MAX_VOTES: 1000,
            MAX_PLAYERS: 100,
            MAX_MESSAGE_LENGTH: 500,
            MIN_TIMER: 1,
            MAX_TIMER: 3600,
            MIN_USERNAME_LENGTH: 3,
            MAX_USERNAME_LENGTH: 20
        };

        // ========== Animations ==========
        this.ANIMATIONS = {
            MOVE_DURATION: 300,
            CAPTURE_DURATION: 400,
            FADE_DURATION: 200,
            SLIDE_DURATION: 300,
            BOUNCE_DURATION: 500,
            PHANTOM_DURATION: 3000
        };

        // ========== API Endpoints ==========
        this.API = {
            LICHESS_PUZZLES: 'https://lichess.org/api/puzzle/daily',
            LICHESS_ANALYSIS: 'https://lichess.org/api/cloud-eval',
            STOCKFISH_WASM: '/stockfish/stockfish.wasm',
            TABLEBASE: 'https://tablebase.lichess.ovh/standard'
        };

        // ========== Expressions régulières ==========
        this.REGEX = {
            FEN: /^([rnbqkpRNBQKP1-8]{1,8}\/){7}[rnbqkpRNBQKP1-8]{1,8}\s[wb]\s[KQkq-]{1,4}\s[a-h][36]?\s\d+\s\d+$/,
            MOVE: /^([a-h][1-8]){2}[qrbn]?$/,
            ALGEBRAIC: /^([NBRQK])?([a-h])?([1-8])?(x)?([a-h][1-8])(=[NBRQ])?(\+|#)?$/,
            SQUARE: /^[a-h][1-8]$/,
            PIECE: /^[rnbqkpRNBQKP]$/,
            COLOR: /^[wb]$/,
            CASTLE: /^(O-O|O-O-O)$/
        };

        // ========== Caractères Unicode des pièces ==========
        this.UNICODE_PIECES = {
            'wK': '♔',
            'wQ': '♕',
            'wR': '♖',
            'wB': '♗',
            'wN': '♘',
            'wP': '♙',
            'bK': '♚',
            'bQ': '♛',
            'bR': '♜',
            'bB': '♝',
            'bN': '♞',
            'bP': '♟'
        };

        // ========== Notation ==========
        this.NOTATION = {
            FILES_TO_COORDS: {
                'a': 0, 'b': 1, 'c': 2, 'd': 3,
                'e': 4, 'f': 5, 'g': 6, 'h': 7
            },
            RANKS_TO_COORDS: {
                '1': 7, '2': 6, '3': 5, '4': 4,
                '5': 3, '6': 2, '7': 1, '8': 0
            },
            COORDS_TO_FILES: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
            COORDS_TO_RANKS: ['8', '7', '6', '5', '4', '3', '2', '1']
        };

        // ========== Raccourcis clavier ==========
        this.KEYBINDINGS = {
            START_GAME: ' ',           // Espace
            PAUSE_GAME: 'p',
            RESET_GAME: 'r',
            UNDO_MOVE: 'z',
            REDO_MOVE: 'y',
            FLIP_BOARD: 'f',
            SHOW_SETTINGS: 's',
            SHOW_HELP: 'h',
            TOGGLE_ANALYSIS: 'a',
            TOGGLE_SOUND: 'm',
            ESCAPE: 'Escape'
        };

        // ========== Modes de difficulté ==========
        this.DIFFICULTY = {
            BEGINNER: {
                name: 'Débutant',
                depth: 1,
                errorRate: 0.3,
                timePerMove: 1000
            },
            EASY: {
                name: 'Facile',
                depth: 3,
                errorRate: 0.2,
                timePerMove: 2000
            },
            MEDIUM: {
                name: 'Moyen',
                depth: 5,
                errorRate: 0.1,
                timePerMove: 3000
            },
            HARD: {
                name: 'Difficile',
                depth: 10,
                errorRate: 0.05,
                timePerMove: 5000
            },
            EXPERT: {
                name: 'Expert',
                depth: 15,
                errorRate: 0,
                timePerMove: 10000
            }
        };

        // Figer toutes les propriétés
        Object.freeze(this);
        Object.keys(this).forEach(key => {
            if (typeof this[key] === 'object') {
                Object.freeze(this[key]);
            }
        });
    }

    /**
     * Obtient une constante par chemin
     */
    get(path) {
        const keys = path.split('.');
        let value = this;
        
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return undefined;
            }
        }
        
        return value;
    }

    /**
     * Vérifie si une constante existe
     */
    has(path) {
        return this.get(path) !== undefined;
    }

    /**
     * Obtient toutes les constantes d'une catégorie
     */
    getCategory(category) {
        return this[category] || null;
    }
}