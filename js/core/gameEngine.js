/**
 * GAME ENGINE MODULE
 * Logique centrale du jeu d'échecs avec votes
 * Compatible avec Chess.js 0.10.x (ancienne API)
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
        
        // Créer le panneau des coups disponibles
        this.createMovesPanel();
        
        // Resize handler
        window.addEventListener('resize', () => this.board?.resize());
        
        console.log('✅ GameEngine initialisé');
        return this;
    }

    /**
     * Crée le panneau latéral des coups disponibles
     */
    createMovesPanel() {
        // Vérifier si le panneau existe déjà
        if (document.getElementById('moves-panel')) return;
        
        const panel = document.createElement('div');
        panel.id = 'moves-panel';
        panel.className = 'moves-panel';
        panel.innerHTML = `
            <div class="moves-panel__header">
                <h3>♟️ Coups disponibles</h3>
                <div class="voter-input">
                    <label for="voter-name">Votant :</label>
                    <input type="text" id="voter-name" value="TestPlayer" placeholder="Nom du joueur">
                </div>
            </div>
            <div class="moves-panel__timer">
                <div id="timer-display" class="timer-display">
                    <span id="timer-value">--:--</span>
                </div>
                <div class="timer-controls">
                    <button id="btn-start-timer" class="btn btn--small btn--primary">
                        <i class="fas fa-play"></i> Démarrer Timer
                    </button>
                    <button id="btn-stop-timer" class="btn btn--small btn--danger" style="display:none;">
                        <i class="fas fa-stop"></i> Stop
                    </button>
                </div>
            </div>
            <div class="moves-panel__list">
                <div id="availableList" class="available-moves">
                    <ul id="availableListP" data-piece="P" class="moves-group"><span class="piece-icon">♙</span></ul>
                    <ul id="availableListN" data-piece="N" class="moves-group"><span class="piece-icon">♘</span></ul>
                    <ul id="availableListB" data-piece="B" class="moves-group"><span class="piece-icon">♗</span></ul>
                    <ul id="availableListR" data-piece="R" class="moves-group"><span class="piece-icon">♖</span></ul>
                    <ul id="availableListQ" data-piece="Q" class="moves-group"><span class="piece-icon">♕</span></ul>
                    <ul id="availableListK" data-piece="K" class="moves-group"><span class="piece-icon">♔</span></ul>
                    <ul id="availableListO" data-piece="O" class="moves-group"><span class="piece-icon">🏰</span></ul>
                </div>
            </div>
            <div class="moves-panel__votes">
                <h4>📊 Votes en cours</h4>
                <div id="vote-list" class="vote-list"></div>
                <div class="vote-total">Total: <span id="total-votes">0</span> votes</div>
            </div>
        `;
        
        // Ajouter les styles
        this.injectPanelStyles();
        
        // Insérer après l'échiquier
        const boardWrapper = document.getElementById('board_wrapper') || 
                            document.getElementById('myBoard')?.parentElement;
        if (boardWrapper) {
            boardWrapper.parentElement.insertBefore(panel, boardWrapper.nextSibling);
        } else {
            document.body.appendChild(panel);
        }
        
        // Event listeners
        document.getElementById('voter-name')?.addEventListener('input', (e) => {
            this.currentVoterName = e.target.value || 'Anonymous';
        });
        
        document.getElementById('btn-start-timer')?.addEventListener('click', () => {
            this.startTimerManually();
        });
        
        document.getElementById('btn-stop-timer')?.addEventListener('click', () => {
            this.stopTimerManually();
        });
    }

    /**
     * Injecte les styles CSS pour le panneau
     */
    injectPanelStyles() {
        if (document.getElementById('moves-panel-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'moves-panel-styles';
        styles.textContent = `
            .moves-panel {
                position: fixed;
                left: 20px;
                top: 100px;
                width: 280px;
                max-height: calc(100vh - 120px);
                background: linear-gradient(145deg, #1a1a2e, #16213e);
                border-radius: 12px;
                padding: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                overflow-y: auto;
                z-index: 1000;
                color: #fff;
                font-family: 'Segoe UI', sans-serif;
            }
            
            .moves-panel__header h3 {
                margin: 0 0 12px 0;
                font-size: 1.1rem;
                color: #ffd700;
            }
            
            .voter-input {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
            }
            
            .voter-input label {
                font-size: 0.85rem;
                color: #aaa;
            }
            
            .voter-input input {
                flex: 1;
                padding: 6px 10px;
                border: 1px solid #333;
                border-radius: 6px;
                background: #0d1117;
                color: #fff;
                font-size: 0.9rem;
            }
            
            .moves-panel__timer {
                background: #0d1117;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 12px;
                text-align: center;
            }
            
            .timer-display {
                font-size: 2rem;
                font-weight: bold;
                color: #4ade80;
                font-family: 'Courier New', monospace;
                margin-bottom: 8px;
            }
            
            .timer-display.timer-urgent {
                color: #ef4444;
                animation: pulse 0.5s ease-in-out infinite;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            
            .timer-controls {
                display: flex;
                gap: 8px;
                justify-content: center;
            }
            
            .timer-controls .btn {
                padding: 6px 12px;
                font-size: 0.8rem;
            }
            
            .available-moves {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            
            .moves-group {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 4px;
                padding: 4px;
                margin: 0;
                list-style: none;
                background: rgba(255,255,255,0.03);
                border-radius: 6px;
                min-height: 32px;
            }
            
            .moves-group:empty,
            .moves-group:not(:has(li)) {
                display: none;
            }
            
            .moves-group .piece-icon {
                font-size: 1.2rem;
                width: 24px;
                opacity: 0.7;
            }
            
            .moves-group li {
                list-style: none;
            }
            
            .moves-group button {
                padding: 4px 8px;
                font-size: 0.8rem;
                background: #2d3748;
                color: #fff;
                border: 1px solid #4a5568;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
                font-family: 'Courier New', monospace;
            }
            
            .moves-group button:hover {
                background: #4a5568;
                border-color: #ffd700;
                transform: translateY(-1px);
            }
            
            .moves-group li.most-voted button {
                background: #ffd700;
                color: #000;
                border-color: #ffd700;
                font-weight: bold;
            }
            
            .moves-panel__votes {
                margin-top: 16px;
                padding-top: 12px;
                border-top: 1px solid #333;
            }
            
            .moves-panel__votes h4 {
                margin: 0 0 8px 0;
                font-size: 0.95rem;
                color: #aaa;
            }
            
            .vote-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
                max-height: 150px;
                overflow-y: auto;
            }
            
            .vote-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                background: rgba(255,255,255,0.05);
                border-radius: 4px;
                position: relative;
                overflow: hidden;
            }
            
            .vote-item .vote-bar {
                position: absolute;
                left: 0;
                top: 0;
                height: 100%;
                background: var(--color, #4a5568);
                opacity: 0.2;
                z-index: 0;
            }
            
            .vote-item .vote-move {
                font-family: 'Courier New', monospace;
                font-weight: bold;
                z-index: 1;
            }
            
            .vote-item .vote-count {
                margin-left: auto;
                font-size: 0.85rem;
                color: #aaa;
                z-index: 1;
            }
            
            .vote-total {
                margin-top: 8px;
                text-align: right;
                font-size: 0.85rem;
                color: #888;
            }
            
            /* Responsive */
            @media (max-width: 1200px) {
                .moves-panel {
                    position: static;
                    width: 100%;
                    max-height: none;
                    margin-top: 20px;
                }
            }
        `;
        document.head.appendChild(styles);
    }

    /**
     * Démarre le timer manuellement
     */
    startTimerManually() {
        console.log('⏱️ Démarrage manuel du timer');
        this.config.timerEnabled = true;
        voting.open();
        timer.start(this.config.timerDuration);
        
        // Mettre à jour les boutons
        const startBtn = document.getElementById('btn-start-timer');
        const stopBtn = document.getElementById('btn-stop-timer');
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';
    }

    /**
     * Arrête le timer manuellement
     */
    stopTimerManually() {
        console.log('⏱️ Arrêt manuel du timer');
        timer.stop();
        voting.close();
        
        // Mettre à jour les boutons
        const startBtn = document.getElementById('btn-start-timer');
        const stopBtn = document.getElementById('btn-stop-timer');
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        
        // Traiter les votes si il y en a
        if (voting.getTotalVotes() > 0) {
            this.processVoteResult();
        }
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
        document.body.setAttribute('data-team', this.currentTurn);
        
        // Callback
        if (this.onTurnChange) {
            this.onTurnChange(this.currentTurn);
        }
        
        // Mettre à jour les coups disponibles
        this.updateAvailableMoves();
        
        // Reset les votes pour le nouveau tour
        voting.reset();
        this.updateVotesUI([]);
        
        // Si timer activé, démarrer le timer et ouvrir le vote
        if (this.config.timerEnabled) {
            voting.open();
            timer.start(this.config.timerDuration);
        } else {
            // Mode sans timer : vote ouvert en permanence
            voting.open();
        }
    }

    /**
     * Appelé quand le timer tick
     */
    onTimerTick(remaining) {
        // Mettre à jour l'affichage du timer
        const timerValue = document.getElementById('timer-value');
        const timerDisplay = document.getElementById('timer-display');
        
        if (timerValue) {
            const minutes = Math.floor(remaining / 60);
            const secs = remaining % 60;
            timerValue.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        
        if (timerDisplay) {
            if (remaining <= 10) {
                timerDisplay.classList.add('timer-urgent');
            } else {
                timerDisplay.classList.remove('timer-urgent');
            }
        }
    }

    /**
     * Appelé quand le timer se termine
     */
    onTimerComplete() {
        console.log('⏱️ Temps écoulé!');
        
        // Mettre à jour les boutons
        const startBtn = document.getElementById('btn-start-timer');
        const stopBtn = document.getElementById('btn-stop-timer');
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        
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
            console.log('❌ Aucun vote reçu, coup aléatoire');
            this.playRandomMove();
            return;
        }
        
        // Sélectionner le gagnant
        const winningMove = voting.selectWinner();
        console.log('🏆 Coup gagnant:', winningMove);
        
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
     * COMPATIBLE Chess.js 0.10.x (ancienne API)
     */
    checkGameEnd() {
        if (this.chess.game_over()) {
            let result = null;
            
            if (this.chess.in_checkmate()) {
                const winner = this.chess.turn() === 'w' ? 'Noirs' : 'Blancs';
                result = { type: 'checkmate', winner };
                console.log('👑 Échec et mat!', winner, 'gagnent');
            } else if (this.chess.in_draw()) {
                result = { type: 'draw' };
                console.log('🤝 Partie nulle');
            } else if (this.chess.in_stalemate()) {
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
            let key;
            if (move.startsWith('O-O')) {
                key = 'O'; // Roque
            } else if (move[0].match(/[A-Z]/)) {
                key = move[0]; // Pièce
            } else {
                key = 'P'; // Pion
            }
            if (!groups[key]) groups[key] = [];
            groups[key].push(move.replace(/[+#]/, '')); // Retirer + et #
        });
        
        // Vider les listes (garder l'icône)
        ['P', 'R', 'N', 'B', 'Q', 'K', 'O'].forEach(piece => {
            const list = document.getElementById('availableList' + piece);
            if (list) {
                // Garder seulement le span.piece-icon
                const icon = list.querySelector('.piece-icon');
                list.innerHTML = '';
                if (icon) list.appendChild(icon);
            }
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
            console.log('⚠️ Vote fermé, exécution directe du coup');
            this.executeMove(move);
            return;
        }
        
        // Récupérer le nom du votant
        const voterName = this.currentVoterName || 
                         document.getElementById('voter-name')?.value || 
                         'Anonymous';
        
        console.log(`🗳️ Vote de ${voterName}: ${move}`);
        
        // Ajouter le vote
        voting.addVote(voterName, move);
        
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
        const votesList = document.getElementById('vote-list');
        if (!votesList) return;
        
        const sortedResults = voting.getSortedResults();
        
        // Couleurs pour les votes
        const colors = ['#ffd700', '#c0c0c0', '#cd7f32', '#4a5568', '#2d3748'];
        
        votesList.innerHTML = sortedResults.map((r, i) => `
            <div class="vote-item" style="--color: ${colors[i] || colors[4]}">
                <span class="vote-move">${r.move}</span>
                <span class="vote-count">${r.count} vote${r.count > 1 ? 's' : ''}</span>
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
     * COMPATIBLE Chess.js 0.10.x (ancienne API)
     */
    playMoveSound(move) {
        try {
            if (this.chess.in_checkmate()) {
                this.sounds.mate.play();
            } else if (this.chess.in_check()) {
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

    /**
     * COMPATIBLE Chess.js 0.10.x (ancienne API)
     */
    onDragStart(source, piece, position, orientation) {
        // Pas de drag si partie terminée
        if (this.chess.game_over()) return false;
        
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
            this.currentTurn = this.chess.turn();
            this.updateAvailableMoves();
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