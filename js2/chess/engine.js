/**
 * ENGINE.JS - Wrapper pour le moteur d'échecs chess.js
 */

export class ChessEngine {
    constructor() {
        this.chess = null;
        this.history = [];
        this.moveStack = [];
        this.positionStack = [];
        this.initialized = false;
    }

    /**
     * Initialise le moteur
     */
    async initialize() {
        // Vérifier si chess.js est chargé
        if (typeof window.Chess === 'undefined') {
            console.error('chess.js n\'est pas chargé. Tentative de chargement...');
            await this.loadChessJS();
        }
        
        this.chess = new window.Chess();
        this.initialized = true;
        this.history = [];
        this.moveStack = [];
        this.positionStack = [this.chess.fen()];
        
        return true;
    }

    /**
     * Charge chess.js dynamiquement
     */
    async loadChessJS() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Vérifie que le moteur est initialisé
     */
    checkInitialized() {
        if (!this.initialized || !this.chess) {
            throw new Error('Le moteur d\'échecs n\'est pas initialisé');
        }
    }

    /**
     * Réinitialise le jeu
     */
    reset() {
        this.checkInitialized();
        this.chess.reset();
        this.history = [];
        this.moveStack = [];
        this.positionStack = [this.chess.fen()];
    }

    /**
     * Charge une position FEN
     */
    load(fen) {
        this.checkInitialized();
        const success = this.chess.load(fen);
        if (success) {
            this.positionStack.push(fen);
        }
        return success;
    }

    /**
     * Charge un PGN
     */
    loadPgn(pgn) {
        this.checkInitialized();
        const success = this.chess.load_pgn(pgn);
        if (success) {
            this.history = this.chess.history({ verbose: true });
            this.positionStack = [this.chess.fen()];
        }
        return success;
    }

    /**
     * Obtient la position FEN actuelle
     */
    fen() {
        this.checkInitialized();
        return this.chess.fen();
    }

    /**
     * Obtient le PGN
     */
    pgn(options = {}) {
        this.checkInitialized();
        return this.chess.pgn(options);
    }

    /**
     * Obtient l'en-tête PGN
     */
    header(...args) {
        this.checkInitialized();
        return this.chess.header(...args);
    }

    /**
     * Obtient le joueur actuel
     */
    turn() {
        this.checkInitialized();
        return this.chess.turn();
    }

    /**
     * Joue un coup
     */
    move(move) {
        this.checkInitialized();
        
        // Convertir la notation si nécessaire
        if (typeof move === 'string') {
            // Essayer différents formats
            let result = null;
            
            // Format objet {from: 'e2', to: 'e4'}
            if (move.includes('-')) {
                const [from, to] = move.split('-');
                result = this.chess.move({ from, to, promotion: 'q' });
            } else {
                // Format SAN (e4, Nf3, etc.)
                result = this.chess.move(move);
            }
            
            if (result) {
                this.history.push(result);
                this.moveStack.push(result);
                this.positionStack.push(this.chess.fen());
            }
            
            return result;
        } else {
            const result = this.chess.move(move);
            if (result) {
                this.history.push(result);
                this.moveStack.push(result);
                this.positionStack.push(this.chess.fen());
            }
            return result;
        }
    }

    /**
     * Annule le dernier coup
     */
    undo() {
        this.checkInitialized();
        const move = this.chess.undo();
        if (move) {
            this.moveStack.pop();
            this.positionStack.pop();
        }
        return move;
    }

    /**
     * Obtient tous les coups légaux
     */
    moves(options = {}) {
        this.checkInitialized();
        return this.chess.moves(options);
    }

    /**
     * Obtient les coups légaux détaillés
     */
    movesVerbose() {
        this.checkInitialized();
        return this.chess.moves({ verbose: true });
    }

    /**
     * Obtient les coups légaux pour une case
     */
    movesForSquare(square) {
        this.checkInitialized();
        return this.chess.moves({ square, verbose: true });
    }

    /**
     * Vérifie si un coup est légal
     */
    isLegalMove(move) {
        this.checkInitialized();
        
        const moves = this.chess.moves({ verbose: true });
        
        if (typeof move === 'string') {
            return moves.some(m => m.san === move || `${m.from}${m.to}` === move);
        } else {
            return moves.some(m => 
                m.from === move.from && 
                m.to === move.to &&
                (!move.promotion || m.promotion === move.promotion)
            );
        }
    }

    /**
     * Obtient la pièce sur une case
     */
    get(square) {
        this.checkInitialized();
        return this.chess.get(square);
    }

    /**
     * Place une pièce sur une case
     */
    put(piece, square) {
        this.checkInitialized();
        return this.chess.put(piece, square);
    }

    /**
     * Enlève une pièce d'une case
     */
    remove(square) {
        this.checkInitialized();
        return this.chess.remove(square);
    }

    /**
     * Obtient la couleur d'une case
     */
    squareColor(square) {
        this.checkInitialized();
        return this.chess.square_color(square);
    }

    /**
     * Obtient l'historique des coups
     */
    getHistory(options = {}) {
        this.checkInitialized();
        return options.verbose ? this.history : this.chess.history();
    }

    /**
     * Obtient la notation du tableau
     */
    ascii() {
        this.checkInitialized();
        return this.chess.ascii();
    }

    /**
     * Obtient le tableau sous forme d'objet
     */
    board() {
        this.checkInitialized();
        return this.chess.board();
    }

    /**
     * Validation de position
     */
    validateFen(fen) {
        this.checkInitialized();
        return this.chess.validate_fen(fen);
    }

    /**
     * États de la partie
     */
    inCheck() {
        this.checkInitialized();
        return this.chess.in_check();
    }

    inCheckmate() {
        this.checkInitialized();
        return this.chess.in_checkmate();
    }

    inStalemate() {
        this.checkInitialized();
        return this.chess.in_stalemate();
    }

    inDraw() {
        this.checkInitialized();
        return this.chess.in_draw();
    }

    inThreefoldRepetition() {
        this.checkInitialized();
        return this.chess.in_threefold_repetition();
    }

    insufficientMaterial() {
        this.checkInitialized();
        return this.chess.insufficient_material();
    }

    gameOver() {
        this.checkInitialized();
        return this.chess.game_over();
    }

    /**
     * Obtient l'état détaillé de la partie
     */
    getGameState() {
        this.checkInitialized();
        
        return {
            fen: this.chess.fen(),
            turn: this.chess.turn(),
            moveNumber: Math.floor(this.history.length / 2) + 1,
            inCheck: this.chess.in_check(),
            inCheckmate: this.chess.in_checkmate(),
            inStalemate: this.chess.in_stalemate(),
            inDraw: this.chess.in_draw(),
            inThreefoldRepetition: this.chess.in_threefold_repetition(),
            insufficientMaterial: this.chess.insufficient_material(),
            gameOver: this.chess.game_over()
        };
    }

    /**
     * Évalue la position (basique)
     */
    evaluate() {
        this.checkInitialized();
        
        let evaluation = 0;
        const board = this.chess.board();
        
        const pieceValues = {
            'p': 1, 'n': 3, 'b': 3, 'r': 5, 'q': 9, 'k': 0
        };
        
        const positionBonus = {
            'p': [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [5, 10, 10, -20, -20, 10, 10, 5],
                [5, -5, -10, 0, 0, -10, -5, 5],
                [0, 0, 0, 20, 20, 0, 0, 0],
                [5, 5, 10, 25, 25, 10, 5, 5],
                [10, 10, 20, 30, 30, 20, 10, 10],
                [50, 50, 50, 50, 50, 50, 50, 50],
                [0, 0, 0, 0, 0, 0, 0, 0]
            ],
            'n': [
                [-50, -40, -30, -30, -30, -30, -40, -50],
                [-40, -20, 0, 5, 5, 0, -20, -40],
                [-30, 5, 10, 15, 15, 10, 5, -30],
                [-30, 0, 15, 20, 20, 15, 0, -30],
                [-30, 5, 15, 20, 20, 15, 5, -30],
                [-30, 0, 10, 15, 15, 10, 0, -30],
                [-40, -20, 0, 0, 0, 0, -20, -40],
                [-50, -40, -30, -30, -30, -30, -40, -50]
            ]
        };
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (piece) {
                    const value = pieceValues[piece.type];
                    const bonus = positionBonus[piece.type]?.[row]?.[col] || 0;
                    
                    if (piece.color === 'w') {
                        evaluation += value * 100 + bonus;
                    } else {
                        evaluation -= value * 100 + bonus;
                    }
                }
            }
        }
        
        // Bonus pour la mobilité
        const currentTurn = this.chess.turn();
        const moves = this.chess.moves().length;
        
        // Changer temporairement de tour pour compter les coups adverses
        const tempFen = this.chess.fen();
        const fenParts = tempFen.split(' ');
        fenParts[1] = currentTurn === 'w' ? 'b' : 'w';
        this.chess.load(fenParts.join(' '));
        const opponentMoves = this.chess.moves().length;
        this.chess.load(tempFen); // Restaurer
        
        const mobilityBonus = (moves - opponentMoves) * 10;
        evaluation += currentTurn === 'w' ? mobilityBonus : -mobilityBonus;
        
        return evaluation;
    }

    /**
     * Trouve le meilleur coup (minimax basique)
     */
    findBestMove(depth = 3) {
        this.checkInitialized();
        
        const moves = this.chess.moves({ verbose: true });
        if (moves.length === 0) return null;
        
        let bestMove = null;
        let bestValue = this.chess.turn() === 'w' ? -Infinity : Infinity;
        
        for (const move of moves) {
            this.chess.move(move);
            const value = this.minimax(depth - 1, -Infinity, Infinity, this.chess.turn() === 'w');
            this.chess.undo();
            
            if (this.chess.turn() === 'w') {
                if (value > bestValue) {
                    bestValue = value;
                    bestMove = move;
                }
            } else {
                if (value < bestValue) {
                    bestValue = value;
                    bestMove = move;
                }
            }
        }
        
        return bestMove;
    }

    /**
     * Algorithme minimax avec alpha-beta pruning
     */
    minimax(depth, alpha, beta, maximizingPlayer) {
        if (depth === 0 || this.chess.game_over()) {
            return this.evaluate();
        }
        
        const moves = this.chess.moves({ verbose: true });
        
        if (maximizingPlayer) {
            let maxEval = -Infinity;
            for (const move of moves) {
                this.chess.move(move);
                const eval = this.minimax(depth - 1, alpha, beta, false);
                this.chess.undo();
                maxEval = Math.max(maxEval, eval);
                alpha = Math.max(alpha, eval);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of moves) {
                this.chess.move(move);
                const eval = this.minimax(depth - 1, alpha, beta, true);
                this.chess.undo();
                minEval = Math.min(minEval, eval);
                beta = Math.min(beta, eval);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    /**
     * Clone l'état actuel
     */
    clone() {
        const cloned = new ChessEngine();
        cloned.chess = new window.Chess(this.chess.fen());
        cloned.history = [...this.history];
        cloned.moveStack = [...this.moveStack];
        cloned.positionStack = [...this.positionStack];
        cloned.initialized = true;
        return cloned;
    }

    /**
     * Exporte l'état
     */
    export() {
        return {
            fen: this.chess.fen(),
            pgn: this.chess.pgn(),
            history: this.history,
            moveStack: this.moveStack,
            positionStack: this.positionStack
        };
    }

    /**
     * Importe un état
     */
    import(state) {
        this.checkInitialized();
        
        if (state.fen) {
            this.chess.load(state.fen);
        }
        
        this.history = state.history || [];
        this.moveStack = state.moveStack || [];
        this.positionStack = state.positionStack || [this.chess.fen()];
    }
}