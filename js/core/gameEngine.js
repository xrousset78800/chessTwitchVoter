/**
 * GAME ENGINE MODULE
 * Logique centrale du jeu d'échecs avec votes
 * Compatible avec Chess.js 0.10.x (ancienne API)
 * 
 * ⚠️ MODIFIÉ: Support natif du mode problèmes via window.problemsManager
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
        
        // Nom du votant pour les tests
        this.currentVoterName = 'TestPlayer';
        
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

        window.addEventListener('phantomMoveStart', () => {
            if (this.config.timerEnabled && timer.isRunning) {
                console.log('⏸️ Pause timer - Phantom en mouvement');
                timer.pause();
            }
        });
        
        window.addEventListener('phantomMoveComplete', () => {
            if (this.config.timerEnabled && timer.isRunning && timer.isPaused) {
                console.log('▶️ Reprise timer - Phantom terminé');
                timer.resume();
            }
        });        

        // Créer le panneau des coups disponibles
        this.createMovesPanel();
        
        // Resize handler
        window.addEventListener('resize', () => this.board?.resize());
        
        console.log('✅ GameEngine initialisé');
        return this;
    }

    // ========== DRAG & DROP ==========

    /**
     * Appelé au début d'un drag
     */
    onDragStart(source, piece, position, orientation) {
        // Ne pas autoriser si partie terminée
        if (this.chess.game_over()) return false;
        
        // ========== MODE PROBLÈMES ==========
        if (window.problemsManager?.isActive) {
            // Vérifier que c'est le tour du joueur (index impair)
            if (window.problemsManager.attemptIndex % 2 !== 1) {
                console.log('🧩 [onDragStart] Pas le tour du joueur');
                return false;
            }
            
            // Vérifier la couleur de la pièce
            const turn = this.chess.turn();
            if ((turn === 'w' && piece.search(/^b/) !== -1) ||
                (turn === 'b' && piece.search(/^w/) !== -1)) {
                return false;
            }
            
            return true;
        }
        
        // ========== MODE NORMAL ==========
        // Ne pas autoriser de bouger les pièces adverses
        const turn = this.chess.turn();
        if ((turn === 'w' && piece.search(/^b/) !== -1) ||
            (turn === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }
        
        return true;
    }

    /**
     * Appelé quand une pièce est droppée
     * ⚠️ MODIFIÉ: Délègue au problemsManager si mode problèmes actif
     */
    onDrop(source, target) {
        // ========== MODE PROBLÈMES ==========
        if (window.problemsManager?.isActive) {
            console.log('🧩 [GameEngine.onDrop] Mode problèmes actif');
            console.log('🧩 [GameEngine.onDrop] Coup tenté:', source, '→', target);
            
            // Construire le coup UCI
            const moveUCI = source + target;
            
            // Déléguer la validation au problemsManager
            const result = window.problemsManager.validateAndPlayMove(moveUCI);
            
            console.log('🧩 [GameEngine.onDrop] Résultat:', result);
            
            // Si coup invalide ou incorrect → snapback
            if (!result.valid || !result.correct) {
                return 'snapback';
            }
            
            // Coup correct - le problemsManager a déjà mis à jour le board
            // Ne rien retourner (pas de snapback)
            return;
        }
        
        // ========== MODE NORMAL ==========
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

    /**
     * Appelé après l'animation de snap
     */
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
            this.updateAvailableMoves();
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
            this.updateHistoryUI();
            this.updateAvailableMoves();
            this.syncPhantom();
        }
        return move;
    }

    /**
     * Réinitialise l'échiquier
     */
    reset() {
        this.chess.reset();
        this.board.position('start');
        this.moveHistory = [];
        this.currentTurn = 'w';
        this.isRunning = false;
        this.updateAvailableMoves();
        this.updateHistoryUI();
    }

    // ========== SONS ==========

    playMoveSound(move) {
        try {
            if (this.chess.in_checkmate?.() || this.chess.game_over?.()) {
                this.sounds.mate?.play();
            } else if (this.chess.in_check?.()) {
                this.sounds.check?.play();
            } else if (move.captured) {
                this.sounds.capture?.play();
            } else {
                this.sounds.move?.play();
            }
        } catch (e) {
            // Ignorer les erreurs de son
        }
    }

    // ========== SYNCHRONISATION PHANTOM ==========

    syncPhantom() {
        if (window.phantomChessboard?.isConnected && this.config.phantomAutoSync !== false) {
            window.phantomChessboard.syncPosition(this.chess.fen());
        }
    }

    // ========== GAME STATE ==========

    checkGameEnd() {
        if (this.chess.game_over()) {
            let result = '';
            if (this.chess.in_checkmate()) {
                result = this.chess.turn() === 'w' ? 'Les Noirs gagnent !' : 'Les Blancs gagnent !';
            } else if (this.chess.in_stalemate()) {
                result = 'Pat !';
            } else if (this.chess.in_draw()) {
                result = 'Nulle !';
            }
            
            console.log('🏁 Fin de partie:', result);
            
            if (this.onGameEnd) {
                this.onGameEnd(result);
            }
            
            this.isRunning = false;
            return true;
        }
        return false;
    }

    // ========== TIMER ==========

    startTurn() {
        if (this.config.timerEnabled) {
            voting.reset();
            voting.open();
            timer.start(this.config.timerDuration);
        }
        
        this.updateAvailableMoves();
        
        if (this.onTurnChange) {
            this.onTurnChange(this.currentTurn);
        }
    }

    onTimerTick(remaining) {
        // Peut être utilisé pour des animations
    }

    onTimerComplete() {
        console.log('⏱️ Timer terminé !');
        voting.close();
        this.processVoteResult();
    }

    // ========== VOTES ==========

    onVoteAdded(vote, results) {
        console.log('🗳️ Vote ajouté:', vote);
        this.updateVotesUI(results);
    }

    processVoteResult() {
        const results = voting.getResults();
        
        if (results.length === 0) {
            console.log('❌ Aucun vote, tour sauté');
            this.currentTurn = this.currentTurn === 'w' ? 'b' : 'w';
            this.startTurn();
            return;
        }

        let selectedMove;
        
        if (this.config.majorityMode) {
            // Mode majorité : prendre le coup avec le plus de votes
            selectedMove = results[0].move;
        } else {
            // Mode roue : animation + sélection aléatoire pondérée
            // TODO: Implémenter l'animation de roue
            selectedMove = this.selectRandomWeighted(results);
        }

        console.log('🎯 Coup sélectionné:', selectedMove);
        this.executeMove(selectedMove);
    }

    selectRandomWeighted(results) {
        const totalVotes = results.reduce((sum, r) => sum + r.votes, 0);
        let random = Math.random() * totalVotes;
        
        for (const result of results) {
            random -= result.votes;
            if (random <= 0) {
                return result.move;
            }
        }
        
        return results[0].move;
    }

    executeMove(moveStr) {
        const move = this.chess.move(moveStr);
        
        if (move) {
            this.board.position(this.chess.fen());
            this.moveHistory.push(move);
            this.playMoveSound(move);
            this.updateHistoryUI(move);
            this.syncPhantom();
            
            if (!this.checkGameEnd()) {
                this.currentTurn = this.chess.turn();
                this.startTurn();
            }
        } else {
            console.error('❌ Coup invalide:', moveStr);
        }
    }

    // ========== UI UPDATES ==========

    updateHistoryUI(move) {
        const historyEl = document.getElementById('history-list') || document.querySelector('.poll ol');
        if (!historyEl) return;

        if (!move) {
            historyEl.innerHTML = '';
            return;
        }

        const moveNum = Math.ceil(this.moveHistory.length / 2);
        const isWhite = this.moveHistory.length % 2 === 1;
        
        if (isWhite) {
            const li = document.createElement('li');
            li.innerHTML = `<span class="move-number">${moveNum}.</span> <span class="move-white">${move.san}</span>`;
            historyEl.appendChild(li);
        } else {
            const lastLi = historyEl.lastElementChild;
            if (lastLi) {
                lastLi.innerHTML += ` <span class="move-black">${move.san}</span>`;
            }
        }
    }

    updateVotesUI(results) {
        const container = document.getElementById('votes-list');
        if (!container) return;

        container.innerHTML = results.map(r => `
            <div class="vote-item">
                <span class="vote-move">${r.move}</span>
                <span class="vote-count">${r.votes}</span>
                <div class="vote-bar" style="width: ${r.percentage}%"></div>
            </div>
        `).join('');
    }

    updateAvailableMoves() {
        const moves = this.chess.moves();
        
        // Grouper par pièce
        const groups = {};
        
        moves.forEach(move => {
            let key;
            
            // Roque
            if (move.startsWith('O-O')) {
                key = 'O';
            }
            // Pions
            else if (move[0] === move[0].toLowerCase()) {
                key = 'P';
            }
            // Autres pièces
            else {
                key = move[0];
            }
            
            if (!groups[key]) groups[key] = [];
            groups[key].push(move);
        });
        
        // Ordre des pièces
        const order = ['P', 'N', 'B', 'R', 'Q', 'K', 'O'];
        
        // Mettre à jour les listes
        order.forEach(piece => {
            const list = document.getElementById(`availableList${piece}`);
            if (!list) return;
            
            const icon = list.querySelector('.piece-icon');
            list.innerHTML = '';
            if (icon) list.appendChild(icon);
            
            if (groups[piece]) {
                groups[piece].forEach(move => {
                    const li = document.createElement('li');
                    const btn = document.createElement('button');
                    btn.textContent = move.replace("#", "");
                    btn.onclick = () => this.onMoveClick(move);
                    li.appendChild(btn);
                    list.appendChild(li);
                });
            }
        });
    }

    onMoveClick(move) {
        console.log('👆 Coup cliqué:', move);
        
        // ========== MODE PROBLÈMES ==========
        if (window.problemsManager?.isActive) {
            const result = window.problemsManager.validateAndPlayMove(move);
            console.log('🧩 Résultat clic:', result);
            return;
        }
        
        // ========== MODE NORMAL ==========
        if (!this.config.timerEnabled) {
            this.executeMove(move);
            this.updateAvailableMoves();
            return;
        }
        
        // Mode avec timer : ajouter un vote
        if (voting.isOpen) {
            voting.addVote(this.currentVoterName, move);
        }
    }

    // ========== VOTING INDICATOR ==========

    updateVotingIndicator() {
        const indicator = document.getElementById('voting-indicator');
        if (!indicator) return;

        // ... (garder le code existant si présent)
    }

    // ========== PANEL ==========

    createMovesPanel() {
        if (document.getElementById('moves-panel')) return;
        
        const panel = document.createElement('div');
        panel.id = 'moves-panel';
        panel.className = 'moves-panel';
        panel.innerHTML = `
            <div class="moves-panel__header">Coups disponibles</div>
            <div class="moves-panel__content">
                <ul id="availableListP" class="moves-group"><span class="piece-icon">♙</span></ul>
                <ul id="availableListN" class="moves-group"><span class="piece-icon">♞</span></ul>
                <ul id="availableListB" class="moves-group"><span class="piece-icon">♝</span></ul>
                <ul id="availableListR" class="moves-group"><span class="piece-icon">♜</span></ul>
                <ul id="availableListQ" class="moves-group"><span class="piece-icon">♛</span></ul>
                <ul id="availableListK" class="moves-group"><span class="piece-icon">♚</span></ul>
                <ul id="availableListO" class="moves-group"><span class="piece-icon">⬚</span></ul>
            </div>
        `;
        
        const sidebar = document.querySelector('.sandbox__sidebar');
        if (sidebar) {
            sidebar.insertBefore(panel, sidebar.firstChild);
        }
    }

    // ========== TIMER MANUEL ==========

    startTimerManually() {
        console.log('⏱️ Démarrage manuel du timer');
        this.config.timerEnabled = true;
        voting.open();
        timer.start(this.config.timerDuration);
        
        const startBtn = document.getElementById('btn-start-timer');
        const stopBtn = document.getElementById('btn-stop-timer');
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';
    }

    stopTimerManually() {
        console.log('⏱️ Arrêt manuel du timer');
        timer.stop();
        voting.close();
        
        const startBtn = document.getElementById('btn-start-timer');
        const stopBtn = document.getElementById('btn-stop-timer');
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        
        if (voting.getTotalVotes() > 0) {
            this.processVoteResult();
        }
    }

    // ========== START GAME ==========

    startGame() {
        console.log('🎮 Démarrage d\'une nouvelle partie...');
        
        this.chess.reset();
        this.board.position('start');
        this.moveHistory = [];
        this.currentTurn = 'w';
        this.isRunning = true;
        
        this.updateAvailableMoves();
        this.startTurn();
        
        console.log('✅ Partie démarrée');
    }
}

// Instance singleton
const gameEngine = new GameEngine();

// Export
export { GameEngine, gameEngine };
export default gameEngine;