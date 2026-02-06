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
        <div class="moves-panel" id="moves-panel">
            <div class="moves-panel__header">
                <h3 data-i18n="voting.title">Coups disponibles</h3>
                
                <!-- Indicateur de votants -->
                <div class="voting-eligibility">
                    <div class="voting-eligibility__label" data-i18n="voting.eligible.title">Qui peut voter</div>
                    <div class="voting-eligibility__value" id="voting-indicator">
                        ${this.getEligibleVoters()}
                    </div>
                </div>
                
                <div class="voter-input">
                    <label for="voter-name" data-i18n="voter.name">Nom du votant</label>
                    <input type="text" id="voter-name" placeholder="Anonymous">
                </div>
            </div>
                    
            <!-- Liste des coups disponibles -->
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
            
            <!-- Votes en cours -->
            <div class="moves-panel__votes">
                <h4 data-i18n="voting.votesInProgress">📊 Votes en cours</h4>
                <div id="vote-list" class="vote-list"></div>
                <div class="vote-total">
                    <span data-i18n="voting.totalVotes">Total</span>: 
                    <span id="total-votes">0</span> 
                    <span data-i18n="voting.votes">votes</span>
                </div>
            </div>
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
    /**
     * Affiche l'animation de la roue
     */
    showWheelAnimation(results, winningMove) {
        document.body.classList.add('randomWheel');
        
        // Palette de couleurs (identique à chessVoterApp.js)
        const colorArray = [
            '#f2ff93','#dc90e8','#88e600','#e5c0ff','#01d04b','#ff9cc9',
            '#37ff85','#ffaca6','#08c55c','#ffa837','#85f9ff','#e5c700',
            '#a8d7ff','#84c600','#67b8c3','#fff55e','#01c2a0','#d5a517',
            '#02dbae','#df9f4d','#89ff89','#ffe7dd','#7cbc5f','#ffdfa1',
            '#97ffe0','#a9b174','#bbffa4','#79b8a3','#e6ffcf','#98b391'
        ];
        
        // Construire le poll
        const poll = [];
        const allVotes = voting.getAllVotes();
        
        if (allVotes.length > 0) {
            // Il y a des votes : les utiliser
            allVotes.forEach((vote) => {
                poll.push({
                    player: vote.player,
                    move: vote.move.replace(/[+#]/, ''),
                    color: vote.color || colorArray[Math.floor(Math.random() * colorArray.length)]
                });
            });
        } else {
            // PAS DE VOTES : créer le poll avec TOUS les coups disponibles + couleur aléatoire
            const moves = this.chess.moves();
            moves.forEach((move) => {
                const color = colorArray[Math.floor(Math.random() * colorArray.length)];
                poll.push({
                    player: 'random',
                    move: move.replace(/[+#]/, ''),
                    color: color
                });
            });
        }
        
        console.log('🎡 Lancement de la roue avec', poll.length, 'options');
        
        // Appeler randomWheel() qui retourne le coup sélectionné par la roue
        let selectedMove = null;
        try {
            selectedMove = randomWheel(poll, this.chess.turn());
            console.log('🎯 Coup sélectionné par la roue:', selectedMove);
        } catch (error) {
            console.error('❌ Erreur animation roue:', error);
            selectedMove = winningMove; // Fallback
        }
        
        // Après l'animation, exécuter LE COUP SÉLECTIONNÉ PAR LA ROUE (pas winningMove)
        const self = this;
        setTimeout(() => {
            document.body.classList.remove('randomWheel');
            $('#chart').html('');
            
            // Utiliser le coup de la roue, ou le fallback si erreur
            const moveToPlay = selectedMove || winningMove;
            console.log('▶️ Exécution du coup:', moveToPlay);
            self.executeMove(moveToPlay);
        }, this.config.wheelDuration * 1000);
    }

    /**
     * Joue un coup aléatoire
     */
     playRandomMove() {
        const moves = this.chess.moves();
        if (moves.length === 0) return;
        
        // Si mode majorité, exécuter directement un coup aléatoire
        if (this.config.majorityMode) {
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            console.log('🎲 Coup aléatoire:', randomMove);
            this.executeMove(randomMove);
        } else {
            // Mode roue : créer un poll avec TOUS les coups + couleur aléatoire
            const colorArray = [
                '#f2ff93','#dc90e8','#88e600','#e5c0ff','#01d04b','#ff9cc9',
                '#37ff85','#ffaca6','#08c55c','#ffa837','#85f9ff','#e5c700',
                '#a8d7ff','#84c600','#67b8c3','#fff55e','#01c2a0','#d5a517'
            ];
            
            const poll = [];
            moves.forEach((move) => {
                const color = colorArray[Math.floor(Math.random() * colorArray.length)];
                poll.push({
                    player: 'random',
                    move: move.replace(/[+#]/, ''),
                    color: color
                });
            });
            
            document.body.classList.add('randomWheel');
            
            // La roue fait le tirage et retourne le coup
            let selectedMove = null;
            try {
                selectedMove = randomWheel(poll, this.chess.turn());
                console.log('🎯 Coup sélectionné par la roue:', selectedMove);
            } catch (error) {
                console.error('❌ Erreur animation roue:', error);
                selectedMove = moves[Math.floor(Math.random() * moves.length)];
            }
            
            const self = this;
            setTimeout(() => {
                document.body.classList.remove('randomWheel');
                $('#chart').html('');
                console.log('▶️ Exécution du coup:', selectedMove);
                self.executeMove(selectedMove);
            }, this.config.wheelDuration * 1000);
        }
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
            
            // Roque
            if (move.startsWith('O-O')) {
                key = 'O';
            }
            // Pions (pas de lettre majuscule)
            else if (move[0] === move[0].toLowerCase()) {
                key = 'P';
            }
            // Autres pièces (première lettre)
            else {
                key = move[0];
            }
            
            if (!groups[key]) groups[key] = [];
            groups[key].push(move);
        });
        
        // Ordre des pièces
        const order = ['P', 'N', 'B', 'R', 'Q', 'K', 'O'];
        
        // Réinitialiser toutes les listes
        order.forEach(piece => {
            const list = document.getElementById(`availableList${piece}`);
            if (!list) return;
            
            // Garder l'icône de pièce
            const icon = list.querySelector('.piece-icon');
            list.innerHTML = '';
            if (icon) list.appendChild(icon);
            
            // Ajouter les coups
            if (groups[piece]) {
                groups[piece].forEach(move => {
                    const li = document.createElement('li');
                    const btn = document.createElement('button');
                    btn.textContent = move;
                    btn.onclick = () => this.handleMoveClick(move);
                    li.appendChild(btn);
                    list.appendChild(li);
                });
            }
        });
        
        console.log('📋 Coups disponibles mis à jour:', moves.length, 'coups');
    }

    /**
     * Appelé quand on clique sur un coup
     */
    onMoveClick(move) {
        console.log('👆 Coup cliqué:', move);
        
        // ========== CAS 1: PAS DE TIMER → JOUER IMMÉDIATEMENT ==========
        if (!this.config.timerEnabled) {
            console.log('⚡ Pas de timer → Exécution immédiate du coup:', move);
            this.executeMove(move);
            this.updateAvailableMoves();
            return;
        }
        
        // ========== CAS 2: AVEC TIMER → SYSTÈME DE VOTE ==========
        
        // Vérifier qu'on peut voter
        if (!voting.isOpen) {
            console.log('❌ Vote fermé');
            return;
        }
        
        // Récupérer le nom du votant
        const voterName = this.currentVoterName || 
                         document.getElementById('voter-name')?.value || 
                         'Anonymous';
        
        console.log(`🗳️ Vote de ${voterName}: ${move}`);
        
        // Ajouter le vote
        voting.addVote(voterName, move);
        
        // Le timer se chargera d'exécuter le coup gagnant à la fin
    }

    executeMove(move) {
        console.log('🎯 Exécution du coup:', move);
        
        // Faire le coup sur l'objet Chess
        const result = this.chess.move(move);
        
        if (!result) {
            console.error('❌ Coup invalide:', move);
            return false;
        }
        
        console.log('✅ Coup joué:', result.san);
        
        // Mettre à jour l'échiquier visuel
        this.board.position(this.chess.fen());
        
        // Sync avec Phantom si connecté
        if (window.phantomChessboard?.isConnected && this.config.phantomAutoSync) {
            window.phantomChessboard.syncPosition(this.chess.fen());
        }
        
        // Mettre à jour l'historique
        this.chess.updateHistoryUI();
        
        // Vérifier fin de partie
        const gameStatus = this.chess.checkGameEnd();
        if (gameStatus) {
            this.handleGameEnd(gameStatus);
            return true;
        }
        
        // Continuer le jeu
        return true;
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

        // Générer l'historique au format classique: 1. e4 - e5
        let html = '';
        const moves = [...this.moveHistory];
        
        // Grouper par paires (blancs + noirs)
        for (let i = 0; i < moves.length; i += 2) {
            const moveNum = Math.floor(i / 2) + 1;
            const whiteMove = moves[i];
            const blackMove = moves[i + 1];
            
            // Détecter échec/mat/roque
            const whiteMoveClass = this.getMoveClass(whiteMove);
            const blackMoveClass = blackMove ? this.getMoveClass(blackMove) : '';
            
            html += `
                <div class="history-row" data-move-index="${i}">
                    <span class="history-row__number">${moveNum}.</span>
                    <span class="history-row__move ${whiteMoveClass}">${whiteMove.san}</span>
                    ${blackMove ? `
                        <span class="history-row__move history-row__move--black ${blackMoveClass}">${blackMove.san}</span>
                    ` : ''}
                </div>
            `;
        }

        container.innerHTML = html;
        
        // Scroll automatique vers le dernier coup
      
        container.scrollTop = container.scrollHeight;
    }

    getMoveClass(move) {
        if (!move) return '';
        
        const classes = [];
        
        if (move.san.includes('#')) {
            classes.push('is-checkmate');
        } else if (move.san.includes('+')) {
            classes.push('is-check');
        }
        
        if (move.san === 'O-O' || move.san === 'O-O-O') {
            classes.push('is-castle');
        }
        
        return classes.join(' ');
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
        if (window.phantomChessboard ?.isConnected) {
            window.phantomChessboard .syncPosition(this.chess.fen());
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
    getEligibleVoters() {
        const mode = window.AppState?.gameMode || this.mode || 'yolo';
        
        switch(mode) {
            case 'yolo':
                return window.i18n?.t('voting.eligible.chat') || 'Chat Twitch';
            
            case 'oneVsOne':
            case 'oneVsAll':
                return window.i18n?.t('voting.eligible.opponent') || 'Adversaire uniquement';
            
            case 'problems':
                return window.i18n?.t('voting.eligible.player') || 'Joueur actif';
            
            case 'chatVsChat':
                return window.i18n?.t('voting.eligible.teams') || 'Équipes Twitch';
            
            default:
                return window.i18n?.t('voting.eligible.undefined') || 'Non défini';
        }
    }
    updateVotingIndicator() {
        const indicator = document.getElementById('voting-indicator');
        if (!indicator) return;
        
        const eligibleText = this.getEligibleVoters();
        indicator.textContent = eligibleText;
        
        const mode = window.AppState?.gameMode || this.mode || 'yolo';
        indicator.className = `voting-indicator mode-${mode}`;
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

function randomWheel(poll, turn) {

$('#chart').html('');
    var padding = {top:0, right:20, bottom:0, left:0},
        w = 400 - padding.left - padding.right,
        h = 400 - padding.top  - padding.bottom,
        r = Math.min(w, h)/2,
        rotation = 0,
        oldrotation = 0,
        picked = 100000,
        oldpick = [],
        data = [],
        col = 'black',
        colorImage = (turn === 'b') ? 'b' : 'w',
        player = poll[0].player,
        color = '#146894';

    for(var i=0; i < poll.length; i++){
        data.push({label: poll[i].move, value: poll[i].move, color: poll[i].color});
        color = poll[i].color;
    }

    var svg = d3.select('#chart')
        .append("svg")
        .data([data])
        .attr("width",  w + padding.left + padding.right)
        .attr("height", h + padding.top + padding.bottom);
    var container = svg.append("g")
        .attr("class", "chartholder")
        .attr("transform", "translate(" + (w/2 + padding.left) + "," + (h/2 + padding.top) + ")");
    var vis = container
        .append("g");
        
    var pie = d3.layout.pie().sort(null).value(function(d){return 1;});
    // declare an arc generator function
    var arc = d3.svg.arc().outerRadius(r);
    // select paths, use arc generator to draw
    var arcs = vis.selectAll("g.slice")
        .data(pie)
        .enter()
        .append("g")
        .attr("class", "slice");
        
    arcs.append("path")
        .attr("fill", function(d, i){ return d.data.color+'ee'; })
        .attr("d", function (d) { return arc(d); });
    // add the text

    arcs.append("text").attr("transform", function(d){
            d.innerRadius = 0;
            d.outerRadius = r;
            d.angle = (d.startAngle + d.endAngle)/2;
            return "rotate(" + (d.angle * 180 / Math.PI - 90) + ")translate(" + (d.outerRadius -20) +")";
        })
            .attr('x', -10)
            .attr('y', 3)
            .attr("text-anchor", "end")
        .text( function(d, i) {
            return data[i].label;
         });

    if(turn=='b') {
        colorImage = 'b'
    }
    else{
        colorImage = 'w'
    }

            arcs.append("image")
                  .attr({
                    "xlink:href": function(d) {
                        let piece = 'P';

                    if (d.data.label.slice(0, 1) == "Q" || 
                         d.data.label.slice(0, 1) == "K" || 
                         d.data.label.slice(0, 1) == "R" || 
                         d.data.label.slice(0, 1) == "B" ||
                         d.data.label.slice(0, 1) == "N" ) {
                        piece = d.data.label.slice(0, 1);
                    }
            return "./img/chesspieces/wikipedia/"+colorImage+piece+".png";
         },
                    width: 20,
                    height: 20
                  })
                  .attr("text-anchor", "end")
                  .attr('y', -15)
                  .attr("transform", function(d){
            d.innerRadius = 0;
            d.outerRadius = r;
            d.angle = (d.startAngle + d.endAngle)/2;
            return "rotate(" + (d.angle * 180 / Math.PI - 90) + ")translate(" + (d.outerRadius - 30) +")";
        })

    container.on("click", spin);
    function spin(d){
        container.on("click", null);
        //all slices have been seen, all done
        //console.log("OldPick: " + oldpick.length, "Data length: " + data.length);
        if(oldpick.length == data.length){
            console.log("done");

            return;
        }
        var  dataSize = data.length,
                    ps       = 360/dataSize,
             pieslice = Math.round(1440/dataSize),
             rng      = Math.floor((Math.random() * 1440) + 360);
        
        let rngmin = rng - ((ps / 2)-1);
        let rngmax = rng + ((ps / 2)-1);

        let random =  Math.floor(Math.random() * (rngmax - rngmin + 1) + rngmin);
//                      console.log(random);
//                      console.log(rng);
//                      console.log(rngmin);
//                      console.log(rngmax);

        rotation = random;

        picked = Math.round(dataSize - (rotation % 360)/ps);
        picked = picked >= dataSize ? (picked % dataSize) : picked;
        if(oldpick.indexOf(picked) !== -1){
            d3.select(this).call(spin);
            return;
        } else {
            oldpick.push(picked);
        }

        rotation += 90 - (Math.round(ps/2));

        //console.log(rotation);
        vis.transition()
            .duration(timerWheelAnimation * 1000)
            .attrTween("transform", rotTween)
            .each("end", function(){
                oldrotation = rotation;
                /* Get the result value from object "data" */
            });
    }

    svg.append("g")
        .attr("transform", "translate(" + (w + padding.left + padding.right) + "," + ((h/2)+padding.top) + ")")
        .append("path")
        .attr("d", "M-" + (r*.15) + ",0L0," + (r*.05) + "L0,-" + (r*.05) + "Z")
        .style({"fill":col});
    //draw spin circle
    container.append("circle")
        .attr("cx", 0)
        .attr("cy", 0)
        .attr("r", 15)
        .style({"fill":"#ffffffff","cursor":"pointer"});       

    function rotTween(to) {
      var i = d3.interpolate(oldrotation % 360, rotation);
      return function(t) {
        return "rotate(" + i(t) + ")";
      };
    }
    spin(data);
    return data[picked].value;
}

// Instance singleton
const gameEngine = new GameEngine();

// Export
export { GameEngine, gameEngine };
export default gameEngine;