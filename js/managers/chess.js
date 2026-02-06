/**
 * PHANTOM TWITCHESS - Chess Manager
 * Gestion de l'échiquier avec Chess.js et Chessboard.js
 */

class ChessManager {
    constructor() {
        this.chess = null;  // Chess.js instance
        this.board = null;  // Chessboard.js instance
        this.boardElement = 'myBoard';
        this.initialized = false;
        this.lastFen = null;
        // History
        this.moveHistory = [];
        
        // Callbacks
        this.onMove = null;
        this.onGameEnd = null;
    }

    /**
     * Initialise l'échiquier
     */
    init(elementId = 'myBoard') {
        this.boardElement = elementId;
        
        // Créer l'instance Chess.js
        this.chess = new Chess();
        
        // Configuration Chessboard.js
        const config = {
            draggable: true,
            position: 'start',
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
            onDragStart: this.onDragStart.bind(this),
            onDrop: this.onDrop.bind(this),
            onSnapEnd: this.onSnapEnd.bind(this),
            sparePieces: false,
            moveSpeed: 'fast'
        };

        // Créer l'échiquier
        this.board = Chessboard(elementId, config);
        
        // Resize handler
        window.addEventListener('resize', () => {
            if (this.board) this.board.resize();
        });

        this.initialized = true;
        this.log('♟️ Échiquier initialisé');
        
        return this;
    }

    /**
     * Handler: début de drag
     */
    onDragStart(source, piece, position, orientation) {
        // Pas de drag si partie terminée
        if (this.chess.game_over()) return false;

        // Pas de drag si ce n'est pas le tour de cette couleur
        if ((this.chess.turn() === 'w' && piece.search(/^b/) !== -1) ||
            (this.chess.turn() === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }

        return true;
    }

    /**
     * Handler: drop d'une pièce
     */
    onDrop(source, target) {
        const move = chess.move({
            from: source,
            to: target,
            promotion: 'q'
        });
        
        if (move === null) {
            return 'snapback';
        }
        
        updateMovesList();
        updateAvailableMoves();
        checkGameStatus();
        
        // Seulement si nécessaire (prise en passant, roque, promotion)
        if (move.flags.includes('e') || move.flags.includes('k') || move.flags.includes('q')) {
            board.position(chess.fen());
        }
    }

    /**
     * Handler: fin du snap
     */
    onSnapEnd() {
        this.board.position(this.chess.fen());
    }

    /**
     * Jouer un coup programmatiquement
     */
    makeMove(moveStr) {
        const move = this.chess.move(moveStr);
        
        if (move) {
            this.board.position(this.chess.fen());
            this.moveHistory.push(move);
            this.updateHistoryUI();

            if (this.onMove) {
                this.onMove(move, this.chess.fen());
            }

            // Sync Phantom
            if (window.phantom?.isConnected && window.phantom?.settings?.autoSync) {
                window.phantom.syncPosition(this.chess.fen());
            }

            this.checkGameEnd();
            return move;
        }

        return null;
    }

    /**
     * Annuler le dernier coup
     */
    undo() {
        const move = this.chess.undo();
        
        if (move) {
            this.board.position(this.chess.fen());
            this.moveHistory.pop();
            this.updateHistoryUI();

            // Sync Phantom
            if (window.phantom?.isConnected && window.phantom?.settings?.autoSync) {
                window.phantom.syncPosition(this.chess.fen());
            }

            return move;
        }

        return null;
    }

    /**
     * Reset l'échiquier
     */
    reset() {
        this.chess.reset();
        this.board.position('start');
        this.moveHistory = [];
        this.updateHistoryUI();

        // Sync Phantom
        if (window.phantom?.isConnected && window.phantom?.settings?.autoSync) {
            window.phantom.syncPosition(this.chess.fen());
        }
    }

    /**
     * Charger une position FEN
     */
    loadFen(fen) {
        const valid = this.chess.load(fen);
        if (valid) {
            this.board.position(fen);
            this.moveHistory = [];
            this.updateHistoryUI();
        }
        return valid;
    }

    /**
     * Retourner l'échiquier
     */
    flip() {
        this.board.flip();
    }

    /**
     * Obtenir l'orientation actuelle
     */
    getOrientation() {
        return this.board.orientation();
    }

    /**
     * Définir l'orientation
     */
    setOrientation(color) {
        this.board.orientation(color);
    }

    /**
     * Obtenir le FEN actuel
     */
    fen() {
        return this.chess.fen();
    }

    /**
     * Obtenir les coups légaux
     */
    moves(options = {}) {
        return this.chess.moves(options);
    }

    /**
     * Obtenir le tour actuel ('w' ou 'b')
     */
    turn() {
        return this.chess.turn();
    }

    /**
     * Vérifier la fin de partie
     */
    checkGameEnd() {
        if (this.chess.game_over()) {
            let result = null;
            
            if (this.chess.in_checkmate()) {
                result = {
                    type: 'checkmate',
                    winner: this.chess.turn() === 'w' ? 'black' : 'white'
                };
            } else if (this.chess.in_stalemate()) {
                result = { type: 'stalemate' };
            } else if (this.chess.in_draw()) {
                result = { type: 'draw' };
            } else if (this.chess.in_threefold_repetition()) {
                result = { type: 'repetition' };
            }

            if (result && this.onGameEnd) {
                this.onGameEnd(result);
            }

            return result;
        }

        return null;
    }

    /**
     * Mettre à jour l'UI de l'historique
     */
    updateHistoryUI() {
        const container = document.getElementById('history-list');
        if (!container) return;

        if (this.moveHistory.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p data-i18n="history.noMoves">${window.i18n?.t('history.noMoves') || 'Aucun coup joué'}</p>
                </div>
            `;
            return;
        }

        // Générer les lignes de l'historique (plus récent en haut)
        let html = '';
        const moves = [...this.moveHistory];
        
        for (let i = moves.length - 1; i >= 0; i -= 2) {
            const moveNum = Math.floor(i / 2) + 1;
            const whiteMove = moves[i - 1] || moves[i];
            const blackMove = i > 0 && moves[i - 1] ? moves[i] : null;
            
            if (i % 2 === 0) {
                // Position impaire dans l'array = coup des blancs
                html += `
                    <div class="history-row">
                        <span class="history-row__number">${Math.floor(i / 2) + 1}.</span>
                        <span class="history-row__move">${moves[i].san}</span>
                        <span class="history-row__move"></span>
                    </div>
                `;
            } else {
                // Position paire = on a les deux coups
                html += `
                    <div class="history-row">
                        <span class="history-row__number">${Math.floor((i - 1) / 2) + 1}.</span>
                        <span class="history-row__move">${moves[i - 1].san}</span>
                        <span class="history-row__move">${moves[i].san}</span>
                    </div>
                `;
                i--; // Sauter car on a traité 2 coups
            }
        }

        container.innerHTML = html;
    }

    /**
     * Obtenir l'historique en notation PGN
     */
    pgn() {
        return this.chess.pgn();
    }

    /**
     * Log
     */
    log(message) {
        console.log('[Chess]', message);
    }
}

// Create global instance
window.chessManager = new ChessManager();

export default window.chessManager;
