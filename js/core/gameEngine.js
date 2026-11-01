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
        this.session = null;         // Partie à joueurs inscrits : { humanColor: 'w' | 'b' | null }
        
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
        
        return this.canHumanPlay();
    }

    /**
     * Partie à joueurs inscrits : seul le streamer touche l'échiquier, à son tour.
     * Toujours true hors de ces parties.
     */
    canHumanPlay() {
        if (!this.session) return true;
        return this.isRunning && this.session.humanColor === this.chess.turn();
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
    // Mode problèmes : le timer est géré par problemsManager
    if (window.problemsManager?.isActive) {
        this.updateAvailableMoves();
        if (this.onTurnChange) this.onTurnChange(this.currentTurn);
        return;
    }

    // Tour du streamer : ni vote ni timer, il joue sur l'échiquier
    if (this.session && this.canHumanPlay()) {
        timer.stop();
        voting.reset();
        if (this.votingWheel) this.votingWheel.clear();
        this.updateAvailableMoves();
        if (this.onTurnChange) this.onTurnChange(this.currentTurn);
        return;
    }

    // Multi : la page qui n'a pas le trait attend le coup de l'autre chaîne.
    // Son timer jouerait sinon un coup au hasard pour le camp adverse.
    if (!this.isMyTurnInMulti()) {
        timer.stop();
        voting.reset();
        if (this.votingWheel) this.votingWheel.clear();
        window.multiplayerManager.updateTurnIndicator();
        this.updateAvailableMoves();
        if (this.onTurnChange) this.onTurnChange(this.currentTurn);
        return;
    }

    if (this.config.timerEnabled) {
        voting.reset();
        voting.open();
        timer.start(this.config.timerDuration);
        if (this.votingWheel) this.votingWheel.clear();
    }

    // Mettre à jour l'indicateur de tour multi
    if (window.multiplayerManager?.gameId) {
        window.multiplayerManager.updateTurnIndicator();
    }

    this.updateAvailableMoves();
    if (this.onTurnChange) this.onTurnChange(this.currentTurn);
}

    onTimerTick(remaining) {
        // Peut être utilisé pour des animations
    }

onTimerComplete() {
    console.log('⏱️ Timer terminé !');

    // Mode problèmes : ne pas traiter ici, c'est le problemsManager qui gère
    if (window.problemsManager?.isActive) {
        console.log('⏱️ Timer ignoré (mode problèmes actif)');
        return;
    }

    voting.close();
    this.processVoteResult();
}

    // ========== VOTES ==========

onVoteAdded(vote, results) {
    console.log('🗳️ Vote ajouté:', vote.player, '→', vote.move);
    
    // Log dans la sidebar
    if (window.VoteLog) window.VoteLog.add(vote.player || 'chat', vote.move);
    
    const sortedResults = voting.getSortedResults();
    this.updateVotesUI(sortedResults);
    
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
        // ========== MODE MULTI : jouer seulement si c'est notre tour ==========
        if (window.multiplayerManager?.gameId && window.playerColor) {
            const turn = this.chess.turn(); // 'w' ou 'b'
            const isMyTurn = (window.playerColor === 'white' && turn === 'w') ||
                             (window.playerColor === 'black' && turn === 'b');
            if (!isMyTurn) {
                voting.reset();
                console.log('⏳ Multi : timer expiré mais pas notre tour — on attend le coup adverse');
                return;
            }
        }

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
    
    // Tirer au sort le gagnant
    const randomMove = moves[Math.floor(Math.random() * moves.length)];

    // Mode majorité : coup aléatoire direct (pas d'animation)
    if (this.config.majorityMode) {
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
    this.showWheelAnimation(randomResults);
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
showWheelAnimation(results) {
    const wheelDuration = (this.config.wheelDuration || 5) * 1000;
    
    this.updateVotesUI(results);
    
    if (this.votingWheel) {
        // Synchroniser la roue
        this.votingWheel.clear();
        results.forEach((result) => {
            this.votingWheel.votes.set(result.move, { 
                count: result.count, 
                voters: new Map([['system', result.count]]) 
            });
        });
        this.votingWheel.draw();
        console.log('🎡 Roue synchronisée avec', results.length, 'coups');
        
        this.showWheel();
        document.getElementById('wheel-area')?.classList.add('is-spinning');
        console.log('🎡 Lancement de l\'animation de roue, durée:', wheelDuration, 'ms');
        document.body.classList.add('randomWheel');
        
        this.votingWheel.onSpinEnd = (winner) => {
            console.log('🎯 Roue terminée, gagnant:', winner);
            document.body.classList.remove('randomWheel');
            this.executeMove(winner);
            this.hideWheel();
        };
        
        // ✅ Passer le gagnant pré-déterminé à spin()
        const forcedWinner = results[0].move;
        this.votingWheel.spin(wheelDuration, forcedWinner);
        return;
    }
    
    // Fallback
    setTimeout(() => {
        document.body.classList.remove('randomWheel');
        this.executeMove(results[0].move);
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

    highlightLastMove(from, to) {
        // Retirer les anciens highlights
        document.querySelectorAll('.highlight-last-move')
            .forEach(el => el.classList.remove('highlight-last-move'));
        
        // Ajouter le highlight sur les cases from et to
        const fromSquare = document.querySelector(`[data-square="${from}"]`);
        const toSquare = document.querySelector(`[data-square="${to}"]`);
        
        if (fromSquare) fromSquare.classList.add('highlight-last-move');
        if (toSquare) toSquare.classList.add('highlight-last-move');
    }

    executeMove(moveStr, fromNetwork = false) {
        const move = this.chess.move(moveStr);

        if (move) {
            const fen = this.chess.fen();

            if (fromNetwork) {
                // Pas d'animation pour les coups réseau → highlight immédiat et fiable
                this.board.position(fen, false);
                this.highlightLastMove(move.from, move.to);
            } else {
                // Animation locale → re-appliquer le highlight après la fin de l'animation
                this.board.position(fen);
                // Double requestAnimationFrame : passe après le repaint de l'animation chessboard
                const from = move.from, to = move.to;
                requestAnimationFrame(() => requestAnimationFrame(() => this.highlightLastMove(from, to)));
            }

            this.moveHistory.push(move);
            this.playMoveSound(move);
            this.updateHistoryUI(move);
            this.syncPhantom();

            // Envoyer au serveur si mode multi et coup local
            if (!fromNetwork && window.multiplayerManager?.gameId) {
                window.multiplayerManager.sendMove(moveStr);
            }

            // Mettre à jour l'indicateur de tour multi
            if (window.multiplayerManager?.gameId) {
                window.multiplayerManager.updateTurnIndicator();
            }

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
    const turn = this.chess.turn(); // 'w' ou 'b'
    
    // Icônes par couleur
    const pieceIcons = {
        w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
        b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' }
    };
    
    // Grouper les coups par pièce
    const groups = { P: [], N: [], B: [], R: [], Q: [], K: [], O: [] };
    
    moves.forEach(move => {
        const cleanMove = move.replace('#', '').replace('+', '');
        const firstChar = move.charAt(0);
        
        if (move.startsWith('O-') || move.startsWith('0-')) {
            groups.O.push(cleanMove);
        } else if (['K', 'Q', 'R', 'B', 'N'].includes(firstChar)) {
            groups[firstChar].push(cleanMove);
        } else {
            groups.P.push(cleanMove);
        }
    });
    
    // En mode multi, griser le panel si ce n'est pas notre tour
    const movesPanel = document.getElementById('moves-panel');
    const isLocked = !this.isMyTurnInMulti();
    if (movesPanel) {
        movesPanel.classList.toggle('is-locked', isLocked);
        movesPanel.title = isLocked ? 'Tour de l\'adversaire — attendez...' : '';
    }

    // Mettre à jour chaque liste avec l'icône de la bonne couleur
    ['P', 'N', 'B', 'R', 'Q', 'K', 'O'].forEach(piece => {
        const list = document.getElementById(`availableList${piece}`);
        if (!list) return;
        
        // Garder l'icône existante
        const icon = list.querySelector('.piece-icon');
        list.innerHTML = '';
        
        // Recréer l'icône avec la bonne couleur
        if (piece !== 'O') {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'piece-icon';
            iconSpan.textContent = pieceIcons[turn][piece];
            list.appendChild(iconSpan);
        } else if (icon) {
            list.appendChild(icon);
        }
        
        // Ajouter les coups
        if (groups[piece]) {
            groups[piece].forEach(move => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.textContent = move;
                btn.onclick = () => this.onMoveClick(move);  // ← Correction ici
                li.appendChild(btn);
                list.appendChild(li);
            });
        }
    });
}

/**
 * Retourne true si, en mode multi, c'est le tour de cette instance.
 * Toujours true hors mode multi.
 */
isMyTurnInMulti() {
    if (!window.multiplayerManager?.gameId || !window.playerColor) return true;
    const turn = this.chess.turn(); // 'w' ou 'b'
    return (window.playerColor === 'white' && turn === 'w') ||
           (window.playerColor === 'black' && turn === 'b');
}

onMoveClick(move) {
    // Mode multi : bloquer complètement si ce n'est pas notre tour
    if (!this.isMyTurnInMulti()) {
        console.log('🚫 Multi : clic ignoré — pas votre tour');
        return;
    }

    // Mode problèmes (chessVoterApp) avec timer : passer par addMoveToPoll
    if (typeof gameMode !== 'undefined' && gameMode === 'probMode') {
        if (typeof timerMode !== 'undefined' && timerMode && typeof voteOpen !== 'undefined' && voteOpen) {
            if (typeof addMoveToPoll === 'function') {
                addMoveToPoll('local', move);
            }
        } else if (typeof voteOpen !== 'undefined' && voteOpen) {
            // Sans timer : jouer directement via chessVoterApp
            if (typeof executeMove === 'function') executeMove(move);
        }
        return;
    }

    // Mode problemsManager (gameEngine natif) avec timer
    if (window.problemsManager?.isActive) {
        if (this.config.timerEnabled) {
            window.problemsManager.receiveVote(move);
        } else {
            window.problemsManager.validateAndPlayMove(move);
        }
        return;
    }

    // Partie à joueurs inscrits : le clic ne vote pas, seul le streamer joue à son tour
    if (this.session) {
        if (this.canHumanPlay()) this.executeMove(move);
        return;
    }

    // Mode normal avec timer : voter
    if (this.config.timerEnabled) {
        if (voting.isOpen) {
            voting.addVote(this.currentVoterName, move);
        }
        return;
    }

    // Sans timer : jouer directement
    this.executeMove(move);
    this.updateAvailableMoves();
}

    // ========== VOTING INDICATOR ==========

    updateVotingIndicator() {
        const indicator = document.getElementById('voting-indicator');
        if (!indicator) return;

        // ... (garder le code existant si présent)
    }

    // ========== PANEL ==========

    createMovesPanel() {
        return;
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
        document.getElementById('vote-log-panel')?.style && (document.getElementById('vote-log-panel').style.display = '');

        this.updateAvailableMoves();
        this.startTurn();
        
        console.log('✅ Partie démarrée');
    }
}

window.VoteLog = {
    add(username, move) {
        const list = document.getElementById('vote-log-list');
        if (!list) return;
        const item = document.createElement('div');
        item.style.cssText = 'padding:2px 4px; border-bottom:1px solid rgba(255,255,255,0.05);';
        item.innerHTML = `<span style="color:#9146ff; font-weight:600;">${username}</span> <span style="color:#aaa;">vote</span> <span style="font-family:monospace; color:#fff; font-weight:bold;">${move}</span>`;
        list.prepend(item);
        // Limiter à 50 entrées
        while (list.children.length > 50) list.removeChild(list.lastChild);
    },
    clear() {
        const list = document.getElementById('vote-log-list');
        if (list) list.innerHTML = '';
    }
};

// Instance singleton
const gameEngine = new GameEngine();

// Export
export { GameEngine, gameEngine };
export default gameEngine;