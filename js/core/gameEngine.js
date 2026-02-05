/**
 * GAME ENGINE MODULE
 * Logique centrale du jeu d'échecs avec votes
 */

import timer from './timer.js';
import voting from './voting.js';

class GameEngine {
    constructor() {
        // État du jeu
        this.chess = null;           // Instance Chess.js
        this.board = null;           // Instance Chessboard.js
        this.isRunning = false;
        this.currentTurn = 'w';      // 'w' ou 'b'
        
        // Configuration
        this.config = {
            timerEnabled: false,
            timerDuration: 25,
            wheelDuration: 5,
            pauseAfterEnd: 15,
            majorityMode: true,
            singleVote: false
        };
        
        // Mode de jeu
        this.mode = 'sandbox';       // sandbox, problems, oneVsAll, oneVsOne, chatVsChat
        this.modeHandler = null;     // Handler spécifique au mode
        
        // Historique
        this.moveHistory = [];
        
        // Callbacks
        this.onMove = null;
        this.onGameEnd = null;
        this.onTurnChange = null;
        
        // Sons
        this.sounds = {
            move: new Audio('mp3/move.mp3'),
            capture: new Audio('mp3/take.mp3'),
            check: new Audio('mp3/check.mp3'),
            mate: new Audio('mp3/mate.wav')
        };
    }

    /**
     * Initialise le moteur de jeu
     */
    init(options = {}) {
        console.log('🎮 Initialisation du GameEngine...');
        
        // Appliquer la config
        Object.assign(this.config, options);
        
        // Créer l'instance Chess.js
        this.chess = new Chess();
        
        // Créer l'échiquier
        const boardConfig = {
            draggable: true,
            position: 'start',
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
            onDragStart: this.onDragStart.bind(this),
            onDrop: this.onDrop.bind(this),
            onSnapEnd: this.onSnapEnd.bind(this)
        };
        
        this.board = Chessboard('myBoard', boardConfig);
        
        // Initialiser le timer avec les callbacks
        timer.init({
            duration: this.config.timerDuration,
            onTick: (remaining) => this.onTimerTick(remaining),
            onComplete: () => this.onTimerComplete()
        });
        
        // Initialiser le système de vote
        voting.init({
            singleVote: this.config.singleVote,
            majorityMode: this.config.majorityMode,
            onVoteAdded: (vote, results) => this.onVoteAdded(vote, results)
        });
        
        // Resize handler
        window.addEventListener('resize', () => this.board?.resize());
        
        console.log('✅ GameEngine initialisé');
        return this;
    }

    /**
     * Démarre une nouvelle partie
     */
    startGame() {
        console.log('🎮 Démarrage d\'une nouvelle partie...');
        
        // Reset l'état
        this.chess.reset();
        this.board.position('start');
        this.moveHistory = [];
        this.currentTurn = 'w';
        this.isRunning = true;
        
        // Mettre à jour l'affichage des coups disponibles
        this.updateAvailableMoves();
        
        // Démarrer le premier tour
        this.startTurn();
        
        console.log('✅ Partie démarrée');
    }

    /**
     * Démarre un nouveau tour
     */
    startTurn() {
        console.log('🔄 Nouveau tour:', this.currentTurn === 'w' ? 'Blancs' : 'Noirs');
        
        // Mettre à jour l'UI
        document.body.setAttribute('data-turn', this.currentTurn);
        
        // Callback
        if (this.onTurnChange) {
            this.onTurnChange(this.currentTurn);
        }
        
        // Mettre à jour les coups disponibles
        this.updateAvailableMoves();
        
        // Si timer activé, démarrer le timer et ouvrir le vote
        if (this.config.timerEnabled) {
            voting.open();
            timer.start(this.config.timerDuration);
        } else {
            // Mode sans timer : vote continu
            voting.open();
        }
    }

    /**
     * Appelé quand le timer tick
     */
    onTimerTick(remaining) {
        // Mettre à jour l'UI si nécessaire
        // console.log('⏱️', remaining, 'secondes');
    }

    /**
     * Appelé quand le timer se termine
     */
    onTimerComplete() {
        console.log('⏱️ Temps écoulé!');
        
        // Fermer le vote
        voting.close();
        
        // Traiter le résultat
        this.processVoteResult();
    }

    /**
     * Traite le résultat du vote
     */
    processVoteResult() {
        const results = voting.getSortedResults();
        
        if (results.length === 0) {
            // Aucun vote : coup aléatoire
            console.log('❌ Aucun vote reçu');
            this.playRandomMove();
            return;
        }
        
        // Sélectionner le gagnant
        const winningMove = voting.selectWinner();
        
        if (this.config.majorityMode) {
            // Mode majorité : exécuter directement
            this.executeMove(winningMove);
        } else {
            // Mode roue : afficher l'animation puis exécuter
            this.showWheelAnimation(results, winningMove);
        }
    }

    /**
     * Affiche l'animation de la roue
     */
    showWheelAnimation(results, winningMove) {
        document.body.classList.add('randomWheel');
        
        // TODO: Intégrer l'animation de roue D3.js ici
        console.log('🎡 Animation roue...');
        
        setTimeout(() => {
            document.body.classList.remove('randomWheel');
            this.executeMove(winningMove);
        }, this.config.wheelDuration * 1000);
    }

    /**
     * Joue un coup aléatoire
     */
    playRandomMove() {
        const moves = this.chess.moves();
        if (moves.length === 0) return;
        
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        console.log('🎲 Coup aléatoire:', randomMove);
        
        this.executeMove(randomMove);
    }

    /**
     * Exécute un coup
     */
    executeMove(moveStr) {
        const move = this.chess.move(moveStr);
        
        if (!move) {
            console.error('❌ Coup invalide:', moveStr);
            return false;
        }
        
        // Mettre à jour le plateau
        this.board.position(this.chess.fen());
        
        // Ajouter à l'historique
        this.moveHistory.push(move);
        
        // Jouer le son
        this.playMoveSound(move);
        
        // Mettre à jour l'affichage de l'historique
        this.updateHistoryUI(move);
        
        // Callback
        if (this.onMove) {
            this.onMove(move, this.chess.fen());
        }
        
        // Sync Phantom si connecté
        this.syncPhantom();
        
        console.log('✅ Coup joué:', move.san);
        
        // Vérifier fin de partie
        if (this.checkGameEnd()) {
            return true;
        }
        
        // Tour suivant
        this.currentTurn = this.chess.turn();
        this.startTurn();
        
        return true;
    }

    /**
     * Vérifie si la partie est terminée
     */
    checkGameEnd() {
        if (this.chess.isGameOver()) {
            let result = null;
            
            if (this.chess.isCheckmate()) {
                const winner = this.chess.turn() === 'w' ? 'Noirs' : 'Blancs';
                result = { type: 'checkmate', winner };
                console.log('👑 Échec et mat!', winner, 'gagnent');
            } else if (this.chess.isDraw()) {
                result = { type: 'draw' };
                console.log('🤝 Partie nulle');
            } else if (this.chess.isStalemate()) {
                result = { type: 'stalemate' };
                console.log('🤝 Pat');
            }
            
            this.handleGameEnd(result);
            return true;
        }
        
        return false;
    }

    /**
     * Gère la fin de partie
     */
    handleGameEnd(result) {
        this.isRunning = false;
        timer.stop();
        voting.close();
        
        // Afficher le résultat
        if (result.type === 'checkmate') {
            document.body.classList.add('omg-win');
        }
        
        // Callback
        if (this.onGameEnd) {
            this.onGameEnd(result);
        }
        
        // Relancer une partie après la pause
        setTimeout(() => {
            document.body.classList.remove('omg-win', 'omg-lose');
            this.startGame();
        }, this.config.pauseAfterEnd * 1000);
    }

    /**
     * Appelé quand un vote est ajouté
     */
    onVoteAdded(vote, results) {
        // Mettre à jour l'affichage des votes
        this.updateVotesUI(results);
        
        // Mettre en évidence le coup le plus voté
        this.highlightLeadingMove(voting.getCurrentLeader());
    }

    /**
     * Met à jour l'affichage des coups disponibles
     */
    updateAvailableMoves() {
        const moves = this.chess.moves().sort();
        const container = document.getElementById('availableList');
        
        if (!container) return;
        
        // Grouper par première lettre (pièce)
        const groups = {};
        moves.forEach(move => {
            const key = move[0].match(/[A-Z]/) ? move[0] : 'P'; // P pour pions
            if (!groups[key]) groups[key] = [];
            groups[key].push(move.replace(/[+#]/, '')); // Retirer + et #
        });
        
        // Vider les listes
        ['P', 'R', 'N', 'B', 'Q', 'K', 'O'].forEach(piece => {
            const list = document.getElementById('availableList' + piece);
            if (list) list.innerHTML = '';
        });
        
        // Remplir les listes
        Object.entries(groups).forEach(([piece, pieceMoves]) => {
            const list = document.getElementById('availableList' + piece) || 
                         document.getElementById('availableListP');
            if (!list) return;
            
            pieceMoves.forEach(move => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.className = 'button-56';
                btn.textContent = move;
                btn.addEventListener('click', () => this.onMoveClick(move));
                li.appendChild(btn);
                list.appendChild(li);
            });
        });
    }

    /**
     * Appelé quand on clique sur un coup
     */
    onMoveClick(move) {
        if (!voting.isOpen) {
            console.log('❌ Vote fermé');
            return;
        }
        
        // Ajouter le vote (le nom du joueur sera 'click' pour les clics manuels)
        voting.addVote('click', move);
        
        // Si pas de timer, exécuter immédiatement
        if (!this.config.timerEnabled) {
            voting.close();
            this.processVoteResult();
        }
    }

    /**
     * Met en évidence le coup le plus voté
     */
    highlightLeadingMove(move) {
        // Retirer l'ancienne mise en évidence
        document.querySelectorAll('#availableList .most-voted').forEach(el => {
            el.classList.remove('most-voted');
        });
        
        // Ajouter la nouvelle
        if (move) {
            document.querySelectorAll('#availableList button').forEach(btn => {
                if (btn.textContent === move) {
                    btn.closest('li')?.classList.add('most-voted');
                }
            });
        }
    }

    /**
     * Met à jour l'UI des votes
     */
    updateVotesUI(results) {
        // TODO: Intégrer avec le graphique Chart.js
        const votesList = document.getElementById('vote-list');
        if (!votesList) return;
        
        const sortedResults = voting.getSortedResults();
        
        votesList.innerHTML = sortedResults.map(r => `
            <div class="vote-item" style="--color: ${r.color}">
                <span class="vote-move">${r.move}</span>
                <span class="vote-count">${r.count}</span>
                <div class="vote-bar" style="width: ${r.percentage}%"></div>
            </div>
        `).join('');
        
        // Total des votes
        const totalEl = document.getElementById('total-votes');
        if (totalEl) {
            totalEl.textContent = voting.getTotalVotes();
        }
    }

    /**
     * Met à jour l'historique des coups
     */
    updateHistoryUI(move) {
        const container = document.querySelector('.poll ol') || 
                         document.getElementById('history-list');
        if (!container) return;
        
        const moveNum = Math.ceil(this.moveHistory.length / 2);
        const isWhite = move.color === 'w';
        
        if (isWhite) {
            // Nouveau tour, créer une nouvelle ligne
            const li = document.createElement('li');
            li.dataset.moveNum = moveNum;
            li.innerHTML = `<span class="w" data-fen="${this.chess.fen()}">${move.san}</span>`;
            container.prepend(li);
        } else {
            // Ajouter au tour existant
            const lastLi = container.querySelector('li:first-child');
            if (lastLi) {
                lastLi.innerHTML += `<span class="b" data-fen="${this.chess.fen()}">${move.san}</span>`;
            }
        }
    }

    /**
     * Joue le son approprié
     */
    playMoveSound(move) {
        try {
            if (this.chess.isCheckmate()) {
                this.sounds.mate.play();
            } else if (this.chess.isCheck()) {
                this.sounds.check.play();
            } else if (move.captured) {
                this.sounds.capture.play();
            } else {
                this.sounds.move.play();
            }
        } catch (e) {
            // Ignorer les erreurs audio
        }
    }

    /**
     * Sync avec le Phantom si connecté
     */
    syncPhantom() {
        if (window.phantom?.isConnected) {
            window.phantom.syncPosition(this.chess.fen());
        }
    }

    // ========== HANDLERS DRAG & DROP ==========

    onDragStart(source, piece, position, orientation) {
        // Pas de drag si partie terminée
        if (this.chess.isGameOver()) return false;
        
        // Pas de drag si ce n'est pas le tour de cette couleur
        const turn = this.chess.turn();
        if ((turn === 'w' && piece.search(/^b/) !== -1) ||
            (turn === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }
        
        return true;
    }

    onDrop(source, target) {
        // Tenter le coup
        const move = this.chess.move({
            from: source,
            to: target,
            promotion: 'q'
        });
        
        if (move === null) return 'snapback';
        
        // En mode avec timer/vote, on devrait passer par le système de vote
        // Pour l'instant, on exécute directement (mode drag & drop)
        this.moveHistory.push(move);
        this.playMoveSound(move);
        this.updateHistoryUI(move);
        this.syncPhantom();
        
        if (this.checkGameEnd()) return;
        
        this.currentTurn = this.chess.turn();
        this.startTurn();
    }

    onSnapEnd() {
        this.board.position(this.chess.fen());
    }

    // ========== CONFIGURATION ==========

    /**
     * Met à jour la configuration
     */
    setConfig(config) {
        Object.assign(this.config, config);
        
        // Mettre à jour les sous-modules
        timer.setDuration(this.config.timerDuration);
        voting.setMode({
            singleVote: this.config.singleVote,
            majorityMode: this.config.majorityMode
        });
    }

    /**
     * Retourne le FEN actuel
     */
    getFen() {
        return this.chess.fen();
    }

    /**
     * Charge une position FEN
     */
    loadFen(fen) {
        const valid = this.chess.load(fen);
        if (valid) {
            this.board.position(fen);
            this.moveHistory = [];
            this.currentTurn = this.chess.turn();
        }
        return valid;
    }

    /**
     * Retourne l'échiquier
     */
    flip() {
        this.board.flip();
    }

    /**
     * Annule le dernier coup
     */
    undo() {
        const move = this.chess.undo();
        if (move) {
            this.board.position(this.chess.fen());
            this.moveHistory.pop();
            this.currentTurn = this.chess.turn();
        }
        return move;
    }

    /**
     * Reset la partie
     */
    reset() {
        timer.stop();
        voting.reset();
        this.startGame();
    }
}

// Instance singleton
const gameEngine = new GameEngine();

// Export
export { GameEngine, gameEngine };
export default gameEngine;