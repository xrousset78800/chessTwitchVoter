/**
 * GAME ENGINE MODULE
 * Logique centrale du jeu d'échecs avec votes
 * Compatible avec Chess.js 0.10.x (ancienne API)
 * 
 * ⚠️ MODIFIÉ: Support natif du mode problèmes via window.problemsManager
 */

import timer from './timer.js';
import voting from './voting.js';
import VotingWheel from '../components/wheel.js';

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

        if (document.getElementById('wheel-area')) {
            this.votingWheel = new VotingWheel('wheel-area');
            console.log('🎡 VotingWheel initialisée');
        }

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
            
            // Reset la roue
            if (this.votingWheel) {
                this.votingWheel.clear();
            }
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
    console.log('🗳️ Vote ajouté:', vote.player, '→', vote.move);
    
    // Récupérer les résultats triés depuis VotingSystem (source de vérité)
    const sortedResults = voting.getSortedResults();
    
    // Mettre à jour l'UI des votes
    this.updateVotesUI(sortedResults);
    
    // Reconstruire la roue depuis les données de voting (pas de addVote individuel)
    if (this.votingWheel) {
        this.syncWheelFromVoting();
    }
    
    this.highlightMostVoted();
}

/**
 * Synchronise VotingWheel avec les données de VotingSystem
 */
syncWheelFromVoting() {
    if (!this.votingWheel) return;
    
    // Clear la roue
    this.votingWheel.votes.clear();
    
    // Reconstruire depuis voting.votes (le tableau brut)
    const allVotes = voting.getAllVotes();
    
    allVotes.forEach((vote, index) => {
        if (!this.votingWheel.votes.has(vote.move)) {
            this.votingWheel.votes.set(vote.move, { count: 0, voters: new Map() });
        }
        
        const voteData = this.votingWheel.votes.get(vote.move);
        voteData.count++;
        
        // Tracker le voter (pour l'affichage, pas pour bloquer)
        const voterCount = voteData.voters.get(vote.player) || 0;
        voteData.voters.set(vote.player, voterCount + 1);
    });
    
    // Redessiner
    this.votingWheel.draw();
    this.votingWheel.updateVoteList();
}
highlightMostVoted() {
    const results = voting.getSortedResults();
    if (results.length === 0) return;
    
    const topMove = results[0].move;
    
    // Retirer l'ancienne surbrillance
    document.querySelectorAll('.moves-group li').forEach(li => {
        li.classList.remove('most-voted');
    });
    
    // Ajouter la surbrillance au coup le plus voté
    document.querySelectorAll('.moves-group button').forEach(btn => {
        if (btn.textContent === topMove || btn.textContent === topMove.replace('#', '').replace('+', '')) {
            btn.parentElement.classList.add('most-voted');
        }
    });
}
    processVoteResult() {
        const results = voting.getSortedResults();
        
        // ========== CAS 1: AUCUN VOTE → COUP ALÉATOIRE ==========
        if (!results || results.length === 0) {
            console.warn('⚠️ Aucun vote reçu');
            this.playRandomMove();
            return;
        }
        
        // Récupérer le coup gagnant (le plus voté)
        const winningMove = results[0].move;
        console.log('🏆 Coup gagnant:', winningMove, 'avec', results[0].count, 'vote(s)');
        
        // ========== CAS 2: MODE MAJORITÉ → EXÉCUTION DIRECTE ==========
        if (this.config.majorityMode) {
            this.executeMove(winningMove);
            return;
        }
        
        // ========== CAS 3: MODE ROUE → ANIMATION ==========
        console.log('🎡 Mode roue - Animation...');
        this.showWheelAnimation(results, winningMove);
    }

    /**
     * Joue un coup aléatoire (quand pas de votes)
     */
playRandomMove() {
    const moves = this.chess.moves();
    
    if (moves.length === 0) {
        console.log('❌ Pas de coups disponibles');
        return;
    }
    
    console.log('🎲 Aucun vote - Tirage au sort parmi', moves.length, 'coups');
    
    // Mode majorité : coup aléatoire direct (pas d'animation)
    if (this.config.majorityMode) {
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        console.log('🎲 Coup aléatoire (direct):', randomMove);
        this.executeMove(randomMove);
        return;
    }
    
    // Mode roue : créer des "faux votes" pour tous les coups disponibles
    console.log('🎡 Mode roue - Animation avec tous les coups...');
    
    const colorPalette = [
        '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', 
        '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
        '#14b8a6', '#f97316', '#84cc16', '#a855f7'
    ];
    
    // Créer un résultat avec tous les coups (1 vote chacun = chances égales)
    const randomResults = moves.map((move, i) => ({
        move: move,
        count: 1,
        color: colorPalette[i % colorPalette.length],
        percentage: Math.round(100 / moves.length)
    }));
    
    // Tirer au sort le gagnant
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    
    // Remplir la roue avec tous les coups
    if (this.votingWheel) {
        this.votingWheel.clear();
        moves.forEach((move, i) => {
            // Ajouter chaque coup une fois
            this.votingWheel.votes.set(move, { count: 1, voters: new Map([['random', 1]]) });
        });
        this.votingWheel.draw();
    }
    
    // Activer le visuel
    document.body.classList.add('randomWheel');
    
    // Lancer l'animation
    this.showWheelAnimation(randomResults, randomMove);
}

showWheel() {
    const wheelArea = document.getElementById('wheel-area');
    if (wheelArea) {
        wheelArea.classList.add('is-visible');
    }
}

/**
 * Masque la roue
 */
hideWheel() {
    const wheelArea = document.getElementById('wheel-area');
    if (wheelArea) {
        wheelArea.classList.remove('is-visible', 'is-spinning');
    }
}

        /**
     * Affiche l'animation de la roue et exécute le coup gagnant
     * @param {Array} results - [{move, count, color, percentage}, ...]
     * @param {string} winningMove - Le coup qui sera joué
     */
showWheelAnimation(results, winningMove) {
    const wheelDuration = (this.config.wheelDuration || 5) * 1000;
    
    // Mettre à jour l'affichage des votes
    this.updateVotesUI(results);
    
    // Utiliser VotingWheel si disponible
    if (this.votingWheel) {
        this.showWheel();
        document.getElementById('wheel-area')?.classList.add('is-spinning');
        console.log('🎡 Lancement de l\'animation de roue');
        document.body.classList.add('randomWheel');
        
        // La roue a déjà les votes (via onVoteAdded)
        // Définir le callback de fin
        this.votingWheel.onSpinEnd = (winner) => {
            console.log('🎯 Roue terminée, gagnant:', winner);
            document.body.classList.remove('randomWheel');
            this.executeMove(winner);
            this.hideWheel();
        };
        
        // Lancer le spin
        this.votingWheel.spin(wheelDuration);
        return;
    }
    
    // Fallback si pas de roue : sélection directe après délai
    console.log('⚠️ Pas de VotingWheel, exécution directe après délai');
    setTimeout(() => {
        document.body.classList.remove('randomWheel');
        this.executeMove(winningMove);
    }, wheelDuration);
}



    selectRandomWeighted(results) {
        if (!results || results.length === 0) {
            return null;
        }
        
        // Calculer le total des votes
        const totalVotes = results.reduce((sum, r) => sum + (r.count || 1), 0);
        let random = Math.random() * totalVotes;
        
        for (const result of results) {
            random -= (result.count || 1);
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
    const votesList = document.getElementById('vote-list') 
                   || document.querySelector('.vote-list');
    
    if (!votesList) {
        console.warn('⚠️ Aucun conteneur #vote-list trouvé');
        return;
    }
    
    if (!results || results.length === 0) {
        votesList.innerHTML = '<div class="no-votes">Aucun vote</div>';
        return;
    }
    
    // Calculer le total depuis les résultats
    const total = results.reduce((sum, r) => sum + (r.count || 0), 0);
    
    votesList.innerHTML = results.map((r, index) => {
        const percentage = total > 0 ? Math.round((r.count / total) * 100) : 0;
        const color = r.color || this.getVoteColor(index);
        
        return `
            <div class="vote-item" data-move="${r.move}" style="--color: ${color}">
                <span class="vote-bar" style="width: ${percentage}%; background: ${color}"></span>
                <span class="vote-move">${r.move}</span>
                <span class="vote-count">${r.count} (${percentage}%)</span>
            </div>
        `;
    }).join('');
    
    // Mettre à jour le total
    const totalEl = document.getElementById('vote-total');
    if (totalEl) {
        totalEl.textContent = `Total: ${total} vote${total > 1 ? 's' : ''}`;
    }
    
    console.log('📊 UI votes mise à jour:', results.length, 'coups,', total, 'votes');
}

/**
 * Retourne une couleur pour un index de vote
 */
getVoteColor(index) {
    const colors = [
        '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', 
        '#f59e0b', '#ef4444', '#ec4899', '#6366f1'
    ];
    return colors[index % colors.length];
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