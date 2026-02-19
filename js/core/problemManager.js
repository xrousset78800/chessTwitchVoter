/**
 * 🧩 PROBLEMS MANAGER v3 - CORRECTIONS COMPLÈTES
 * 
 * CORRECTIONS:
 * - Pas de modale, utilise le timer existant
 * - Pas de double timer (clearInterval correct)
 * - Reset des highlights quand on change de mode
 * - Mise à jour des coups disponibles
 */

class ProblemsManager {
    constructor() {
        // État
        this.problems = [];
        this.currentProblem = null;
        this.attemptIndex = 0;
        this.isActive = false;
        
        // Timer de pause entre problèmes
        this.pauseTimerId = null;
        this.votingTimerId = null;
        this.votingOpen = false;
        this.votesForCurrentTurn = [];
        this.onResolveWithWheel = null;

        // Filtres
        this.selectedThemes = new Set();
        this.themeStats = {};
        
        // Références externes
        this.chess = null;
        this.board = null;
        
        // Configuration
        this.config = {
            csvPath: 'js/problemsV2.csv',
            pauseAfterEnd: 5,
            botMoveDelay: 1200,
            timerEnabled: false,
            timerDuration: 25,
            majorityMode: false,
            wheelDuration: 5,
        };
        
        // Callbacks
        this.onProblemLoaded = null;
        this.onCorrectMove = null;
        this.onWrongMove = null;
        this.onProblemSolved = null;
        this.onProblemFailed = null;
        this.onBotMove = null;
        this.onStateChange = null;
        
        // Sons
        this.sounds = {};
        
        console.log('🧩 ProblemsManager v3 initialisé');
    }

    // ========== INITIALISATION ==========

    init(options = {}) {
        if (options.chess) this.chess = options.chess;
        if (options.board) this.board = options.board;
        if (options.config) Object.assign(this.config, options.config);
        
        this.loadSounds();
        console.log('🧩 ProblemsManager configuré, pauseAfterEnd:', this.config.pauseAfterEnd);
    }

    loadSounds() {
        try {
            this.sounds = {
                move: new Audio('mp3/move.mp3'),
                capture: new Audio('mp3/take.mp3'),
                check: new Audio('mp3/check.mp3'),
                success: new Audio('mp3/mate.wav'),
                fail: new Audio('mp3/check.mp3')
            };
        } catch (e) {
            console.warn('🧩 Sons non chargés');
        }
    }

    // ========== CHARGEMENT CSV ==========

    async loadProblems(csvPath = null) {
        const path = csvPath || this.config.csvPath;
        console.log('🧩 Chargement:', path);
        
        try {
            const response = await fetch(path);
            const data = await response.text();
            const lines = data.split('\n').filter(line => line.trim());
            const parsed = lines.map(line => this.parseCSVLine(line));
            
            this.problems = parsed.slice(1).filter(row => row.length >= 3);
            console.log(`✅ ${this.problems.length} problèmes chargés`);
            
            this.analyzeThemes();
            return this.problems.length;
        } catch (error) {
            console.error('❌ Erreur chargement:', error);
            throw error;
        }
    }

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }

    analyzeThemes() {
        this.themeStats = {};
        
        for (const problem of this.problems) {
            const themesStr = (problem[7] || '').replace(/^"|"$/g, '');
            const themes = themesStr.includes(',') 
                ? themesStr.split(',').map(t => t.trim())
                : themesStr.split(' ').map(t => t.trim());
            
            for (const theme of themes) {
                if (theme) {
                    this.themeStats[theme] = (this.themeStats[theme] || 0) + 1;
                }
            }
        }
    }

    // ========== FILTRAGE ==========

    getFilteredProblems() {
        if (this.selectedThemes.size === 0) return this.problems;
        
        return this.problems.filter(problem => {
            const themesStr = (problem[7] || '').replace(/^"|"$/g, '');
            const themes = themesStr.includes(',')
                ? themesStr.split(',').map(t => t.trim())
                : themesStr.split(' ').map(t => t.trim());
            
            return themes.some(t => this.selectedThemes.has(t));
        });
    }

    toggleTheme(theme) {
        if (this.selectedThemes.has(theme)) {
            this.selectedThemes.delete(theme);
        } else {
            this.selectedThemes.add(theme);
        }
    }

    selectAllThemes() {
        this.selectedThemes = new Set(Object.keys(this.themeStats));
    }

    clearThemes() {
        this.selectedThemes.clear();
    }

    // ========== CHARGEMENT PROBLÈME ==========

    loadRandomProblem() {
        // ⭐ IMPORTANT: Annuler tout timer de pause en cours
        this.cancelPauseTimer();
        
        const filtered = this.getFilteredProblems();
        
        if (filtered.length === 0) {
            console.warn('⚠️ Aucun problème disponible');
            return null;
        }
        
        const problem = filtered[Math.floor(Math.random() * filtered.length)];
        return this.loadProblem(problem);
    }

    loadProblem(problem) {
        if (!problem || problem.length < 3) {
            console.error('❌ Problème invalide');
            return null;
        }

        // ⭐ Reset les highlights avant de charger
        this.clearHighlights();

        this.currentProblem = {
            id: problem[0],
            fen: problem[1],
            solution: problem[2],
            moves: problem[2].trim().split(/\s+/),
            rating: parseInt(problem[3]) || 0,
            themes: problem[7] || '',
            url: problem[8] || ''
        };

        this.attemptIndex = 0;
        this.isActive = true;

        console.log('🧩 ═══════════════════════════════════════');
        console.log('🧩 Problème:', this.currentProblem.id);
        console.log('🧩 Rating:', this.currentProblem.rating);
        console.log('🧩 Solution:', this.currentProblem.moves.join(' → '));
        console.log('🧩 ═══════════════════════════════════════');

        // Initialiser l'échiquier
        if (this.chess) {
            this.chess.load(this.currentProblem.fen);
        }

        // Orientation
        const orientation = this.chess?.turn() === 'b' ? 'white' : 'black';
        
        if (this.board) {
            this.board.position(this.currentProblem.fen, false);
            this.board.orientation(orientation);
        }

        // Callback
        if (this.onProblemLoaded) {
            this.onProblemLoaded(this.currentProblem);
        }

        this.emitStateChange();

        // Masquer le timer (on ne l'utilise que pour la pause)
        document.body.classList.remove('showTimer');
        this.hideTimerMessage();

        // Mettre à jour les coups disponibles
        this.updateAvailableMoves();

        // Jouer le premier coup (bot) après un délai
        setTimeout(() => {
            this.playBotMove();
        }, 800);

        return this.currentProblem;
    }

    // ========== LOGIQUE DE JEU ==========

    playBotMove() {
        if (!this.isActive || !this.currentProblem) return null;
        
        if (this.attemptIndex % 2 !== 0) {
            console.warn('🧩 Ce n\'est pas le tour du bot');
            return null;
        }

        const moveUCI = this.currentProblem.moves[this.attemptIndex];
        if (!moveUCI) {
            console.log('🧩 Fin de la solution, problème résolu !');
            this.handleProblemSolved();
            return null;
        }

        console.log(`🤖 Bot joue (index ${this.attemptIndex}):`, moveUCI);

        const moveObj = this.uciToMoveObject(moveUCI);
        if (!moveObj) {
            console.error('❌ UCI invalide:', moveUCI);
            return null;
        }

        const result = this.chess?.move(moveObj);
        if (!result) {
            console.error('❌ Coup bot illégal:', moveUCI, moveObj);
            return null;
        }

        if (this.board) {
            this.board.position(this.chess.fen());
        }

        this.highlightSquares(moveObj.from, moveObj.to, 'bot');
        this.playSound(result);

        this.attemptIndex++;

        console.log(`✅ Bot a joué: ${result.san} (index maintenant: ${this.attemptIndex})`);

        if (this.onBotMove) {
            this.onBotMove(result);
        }

        // ⭐ Mettre à jour les coups disponibles après le coup du bot
        this.updateAvailableMoves();

        this.emitStateChange();

if (this.attemptIndex >= this.currentProblem.moves.length) {
    this.handleProblemSolved();
} else if (this.attemptIndex % 2 === 1) {
    // Tour du joueur : ouvrir les votes/timer
    setTimeout(() => {
        this.startPlayerTurn();
    }, 300);
}

        return result;
    }
startPlayerTurn() {
    if (!this.isActive) return;

    this.votesForCurrentTurn = [];
    this.cancelVotingTimer();

    // Reset complet de la roue
    const wheel = window.gameEngine?.votingWheel;
    if (wheel) {
        wheel.isSpinning = false;       // forcer fin de spin si encore actif
        wheel.spinVotes = null;
        wheel.spinTotalVotes = null;
        wheel.clear();                  // reset votes + currentRotation
        wheel.draw();
        window.gameEngine.hideWheel();
        document.body.classList.remove('randomWheel');
    }

    if (this.config.timerEnabled && this.config.timerDuration > 0) {
        const duration = this.config.timerDuration;
        let remaining = duration;

        document.body.classList.add('showTimer');
        const countdown = document.querySelector('.countdown');
        if (countdown) {
            countdown.style.setProperty('--q', duration);
            countdown.style.setProperty('--t', duration);
        }
        const timerValue = document.getElementById('timer-value');
        if (timerValue) timerValue.textContent = duration;

        this.votingOpen = true;
        console.log(`⏱️ Problème : timer de ${duration}s ouvert`);

        this.votingTimerId = setInterval(() => {
            remaining--;
            if (countdown) countdown.style.setProperty('--t', remaining);
            if (timerValue) timerValue.textContent = remaining;

            if (remaining <= 0) {
                this.cancelVotingTimer();
                document.body.classList.remove('showTimer');
                this.votingOpen = false;
                this.resolveVotes();
            }
        }, 1000);
    } else {
        this.votingOpen = true;
        console.log('🗳️ Problème : votes ouverts (sans timer)');
    }
}

cancelVotingTimer() {
    if (this.votingTimerId) {
        clearInterval(this.votingTimerId);
        if (window.AppState) AppState._timerIds = AppState._timerIds?.filter(id => id !== this.votingTimerId) ?? []; // ← AJOUTER
        this.votingTimerId = null;
    }
}

receiveVote(move) {
    if (!this.votingOpen) {
        console.log('🗳️ Vote rejeté : votes fermés');
        return false;
    }
    if (!this.isActive || this.attemptIndex % 2 !== 1) {
        console.log('🗳️ Vote rejeté : pas le tour du joueur');
        return false;
    }
    
    this.votesForCurrentTurn.push(move);
    console.log(`🗳️ Vote enregistré: ${move} (total: ${this.votesForCurrentTurn.length})`);
    
    // ✅ Mettre à jour la roue en temps réel
    this.syncWheelDisplay();
    
    // Sans timer : jouer directement le premier vote
    if (!this.config.timerEnabled) {
        this.votingOpen = false;
        this.validateAndPlayMove(move);
    }
    
    return true;
}
syncWheelDisplay() {
    const wheel = window.gameEngine?.votingWheel;
    if (!wheel || wheel.isSpinning) return;

    const counts = {};
    this.votesForCurrentTurn.forEach(v => counts[v] = (counts[v] || 0) + 1);

    if (Object.keys(counts).length === 0) return;

    wheel.votes.clear();
    Object.entries(counts).forEach(([move, count]) => {
        wheel.votes.set(move, { count, voters: new Map([['twitch', count]]) });
    });

    wheel.draw();
    wheel.updateVoteList();

    // Afficher la roue si pas encore visible
    const wheelArea = document.getElementById('wheel-area');
    if (wheelArea && !wheelArea.classList.contains('is-visible')) {
        window.gameEngine.showWheel();
    }
}
resolveVotes() {
    const counts = {};
    this.votesForCurrentTurn.forEach(v => counts[v] = (counts[v] || 0) + 1);
    
    if (this.config.majorityMode) {
        const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        console.log(`🏆 Résolution majorité: ${winner}`);
        this.validateAndPlayMove(winner);
    } else {
        const results = Object.entries(counts).map(([move, count]) => ({ move, count }));
        if (this.onResolveWithWheel) {
            console.log('🎡 Délégation roue au gameEngine');
            this.onResolveWithWheel(results, (winner) => {
                this.validateAndPlayMove(winner);
            });
        } else {
            // Fallback sans roue
            const total = results.reduce((s, r) => s + r.count, 0);
            let rand = Math.random() * total;
            let winner = results[0].move;
            for (const r of results) {
                rand -= r.count;
                if (rand <= 0) { winner = r.move; break; }
            }
            this.validateAndPlayMove(winner);
        }
    }
}
    validateAndPlayMove(move) {
        if (!this.isActive || !this.currentProblem) {
            return { valid: false, correct: false, reason: 'Aucun problème actif' };
        }

        if (this.attemptIndex % 2 !== 1) {
            console.warn('🧩 Ce n\'est pas le tour du joueur, index:', this.attemptIndex);
            return { valid: false, correct: false, reason: 'C\'est le tour du bot' };
        }

        const expectedUCI = this.currentProblem.moves[this.attemptIndex];
        if (!expectedUCI) {
            return { valid: false, correct: false, reason: 'Fin de la solution' };
        }

        console.log(`👤 Joueur tente (index ${this.attemptIndex}):`, move);
        console.log(`🎯 Coup attendu:`, expectedUCI);

        let playedUCI = this.normalizeToUCI(move);
        
        if (!playedUCI) {
            return { valid: false, correct: false, reason: 'Format de coup invalide' };
        }

        console.log(`📊 Comparaison: joué="${playedUCI}" vs attendu="${expectedUCI}"`);

        const isCorrect = this.compareUCI(playedUCI, expectedUCI);

        if (isCorrect) {
            const moveObj = this.uciToMoveObject(expectedUCI);
            const result = this.chess?.move(moveObj);
            
            if (!result) {
                console.error('❌ Coup devrait être légal mais échoue');
                return { valid: false, correct: false, reason: 'Erreur interne' };
            }

            if (this.board) {
                this.board.position(this.chess.fen());
            }

            this.highlightSquares(moveObj.from, moveObj.to, 'player');
            this.playSound(result);

            this.attemptIndex++;
this.votingOpen = false;
this.cancelVotingTimer();
document.body.classList.remove('showTimer');


            console.log(`✅ Correct! ${result.san} (index maintenant: ${this.attemptIndex})`);

            if (this.onCorrectMove) {
                this.onCorrectMove(result);
            }

            this.emitStateChange();

            // ⭐ Mettre à jour les coups disponibles
            this.updateAvailableMoves();

            if (this.attemptIndex >= this.currentProblem.moves.length) {
                this.handleProblemSolved();
            } else {
                setTimeout(() => {
                    this.playBotMove();
                }, this.config.botMoveDelay);
            }

            return { valid: true, correct: true, move: result };

        } else {
            console.log(`❌ Mauvais coup: ${playedUCI} ≠ ${expectedUCI}`);

            const expectedSAN = this.uciToSAN(expectedUCI);

            if (this.onWrongMove) {
                this.onWrongMove(expectedSAN, expectedUCI);
            }

            const correctMove = this.uciToMoveObject(expectedUCI);
            if (correctMove) {
                this.highlightSquares(correctMove.from, correctMove.to, 'correct');
            }

            this.handleProblemFailed();

            return { valid: true, correct: false, expected: expectedSAN };
        }
    }

    // ========== MISE À JOUR COUPS DISPONIBLES ==========

    updateAvailableMoves() {
        // Utiliser le gameEngine si disponible
        if (window.gameEngine?.updateAvailableMoves) {
            window.gameEngine.updateAvailableMoves();
            return;
        }

        // Sinon, mise à jour manuelle
        const moves = this.chess?.moves() || [];
        const groups = {};
        
        moves.forEach(move => {
            let key;
            if (move.startsWith('O-O')) {
                key = 'O';
            } else if (move[0] === move[0].toLowerCase()) {
                key = 'P';
            } else {
                key = move[0];
            }
            if (!groups[key]) groups[key] = [];
            groups[key].push(move);
        });
        
        const order = ['P', 'N', 'B', 'R', 'Q', 'K', 'O'];
        
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
                    btn.onclick = () => {
                        const result = this.validateAndPlayMove(move);
                        console.log('🧩 Clic sur coup:', move, result);
                    };
                    li.appendChild(btn);
                    list.appendChild(li);
                });
            }
        });
        
        console.log('📋 Coups disponibles mis à jour:', moves.length, 'coups');
    }

    // ========== UTILITAIRES DE CONVERSION ==========

    normalizeToUCI(move) {
        if (!move) return null;

        if (typeof move === 'object' && move.from && move.to) {
            return move.from + move.to + (move.promotion || '');
        }

        const str = String(move).trim().toLowerCase();

        const uciMatch = str.match(/^([a-h][1-8])-?([a-h][1-8])([qrbn])?$/);
        if (uciMatch) {
            return uciMatch[1] + uciMatch[2] + (uciMatch[3] || '');
        }

        if (/^(o-o-o|0-0-0)$/i.test(str)) {
            const turn = this.chess?.turn();
            return turn === 'w' ? 'e1c1' : 'e8c8';
        }
        if (/^(o-o|0-0)$/i.test(str)) {
            const turn = this.chess?.turn();
            return turn === 'w' ? 'e1g1' : 'e8g8';
        }

        try {
            const result = this.chess?.move(str);
            if (result) {
                const uci = result.from + result.to + (result.promotion || '');
                this.chess.undo();
                return uci;
            }
        } catch (e) {}

        return null;
    }

    compareUCI(played, expected) {
        played = played.toLowerCase().replace('-', '');
        expected = expected.toLowerCase().replace('-', '');

        if (played === expected) return true;

        if (played.length === 4 && expected.length === 5) {
            if (played === expected.slice(0, 4) && expected[4] === 'q') {
                return true;
            }
        }

        return false;
    }

    uciToMoveObject(uci) {
        if (!uci || uci.length < 4) return null;
        
        return {
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci.length > 4 ? uci[4] : undefined
        };
    }

    uciToSAN(uci) {
        const moveObj = this.uciToMoveObject(uci);
        if (!moveObj) return uci;
        
        try {
            const result = this.chess?.move(moveObj);
            if (result) {
                const san = result.san;
                this.chess.undo();
                return san;
            }
        } catch (e) {}
        
        return uci;
    }

    // ========== FIN DE PROBLÈME ==========

    handleProblemSolved() {
        console.log('🎉 PROBLÈME RÉSOLU !');
        
        this.isActive = false;
        
        try {
            this.sounds.success?.play();
        } catch {}
        
        if (this.onProblemSolved) {
            this.onProblemSolved(this.currentProblem);
        }
        
        this.emitStateChange();
        
        // ⭐ Utiliser le timer inline pour la pause
        this.startPauseTimer('solved');
    }

    handleProblemFailed() {
        console.log('💔 PROBLÈME ÉCHOUÉ');
        
        this.isActive = false;
        
        try {
            this.sounds.fail?.play();
        } catch {}
        
        if (this.onProblemFailed) {
            this.onProblemFailed(this.currentProblem);
        }
        
        this.emitStateChange();
        
        // ⭐ Utiliser le timer inline pour la pause
        this.startPauseTimer('failed');
    }

    // ========== TIMER DE PAUSE INLINE ==========

    startPauseTimer(status) {
        const pauseDuration = this.config.pauseAfterEnd || 5;
        let remaining = pauseDuration;
        
        // Afficher le message dans le timer
        this.showTimerMessage(status, remaining);
        
        // Afficher le timer
        document.body.classList.add('showTimer');
        
        // Mettre à jour le countdown circulaire
        const countdown = document.querySelector('.countdown');
        if (countdown) {
            countdown.style.setProperty('--q', pauseDuration);
            countdown.style.setProperty('--t', remaining);
        }
        
        // ⭐ IMPORTANT: Annuler tout timer précédent
        this.cancelPauseTimer();
        
        // Démarrer le countdown
        this.pauseTimerId = setInterval(() => {
            remaining--;
            
            // Mettre à jour l'affichage
            this.showTimerMessage(status, remaining);
            
            // Mettre à jour le cercle
            if (countdown) {
                countdown.style.setProperty('--t', remaining);
            }
            
            // Fin du timer
            if (remaining <= 0) {
                this.cancelPauseTimer();
                document.body.classList.remove('showTimer');
                this.hideTimerMessage();
                this.loadRandomProblem();
            }
        }, 1000);
        if (window.AppState) AppState._timerIds.push(this.votingTimerId);
        console.log(`⏱️ Pause de ${pauseDuration}s avant prochain problème`);
    }

    cancelPauseTimer() {
        if (this.pauseTimerId) {
            clearInterval(this.pauseTimerId);
            this.pauseTimerId = null;
            console.log('⏱️ Timer de pause annulé');
        }
    }

    skipPause() {
        this.cancelPauseTimer();
        document.body.classList.remove('showTimer');
        this.hideTimerMessage();
        this.loadRandomProblem();
    }

    showTimerMessage(status, seconds) {
        const timerValue = document.getElementById('timer-value');
        if (!timerValue) return;
        
        const icon = status === 'solved' ? '🎉' : '💔';
        const text = status === 'solved' ? 'Résolu!' : 'Raté!';
        
        timerValue.innerHTML = `
            <div class="problem-timer-message problem-timer-message--${status}">
                <span class="problem-timer-icon">${icon}</span>
                <span class="problem-timer-text">${text}</span>
                <span class="problem-timer-countdown">${seconds}s</span>
            </div>
        `;
        
        // Ajouter un bouton skip si pas déjà présent
        let skipBtn = document.getElementById('problem-skip-btn');
        if (!skipBtn) {
            skipBtn = document.createElement('button');
            skipBtn.id = 'problem-skip-btn';
            skipBtn.className = 'btn btn--sm btn--ghost problem-skip-btn';
            skipBtn.innerHTML = '<i class="fas fa-forward"></i> Suivant';
            skipBtn.onclick = () => this.skipPause();
            timerValue.parentElement?.appendChild(skipBtn);
        }
    }

    hideTimerMessage() {
        const timerValue = document.getElementById('timer-value');
        if (timerValue) {
            timerValue.innerHTML = '';
        }
        
        // Retirer le bouton skip
        document.getElementById('problem-skip-btn')?.remove();
    }

    // ========== UI HELPERS ==========

    highlightSquares(from, to, type = 'player') {
        // Retirer les anciens highlights
        this.clearHighlights();
        
        const className = `highlight-${type}`;
        
        const fromSquare = document.querySelector(`[data-square="${from}"]`);
        const toSquare = document.querySelector(`[data-square="${to}"]`);
        
        if (fromSquare) fromSquare.classList.add(className);
        if (toSquare) toSquare.classList.add(className);
    }

    clearHighlights() {
        document.querySelectorAll('.highlight-player, .highlight-bot, .highlight-correct')
            .forEach(el => el.classList.remove('highlight-player', 'highlight-bot', 'highlight-correct'));
    }

    playSound(move) {
        try {
            if (this.chess?.in_checkmate?.() || this.chess?.isCheckmate?.()) {
                this.sounds.success?.play();
            } else if (this.chess?.in_check?.() || this.chess?.inCheck?.()) {
                this.sounds.check?.play();
            } else if (move.captured) {
                this.sounds.capture?.play();
            } else {
                this.sounds.move?.play();
            }
        } catch {}
    }

    emitStateChange() {
        if (this.onStateChange) {
            this.onStateChange(this.getState());
        }
    }

    // ========== GETTERS ==========

    getState() {
        return {
            isActive: this.isActive,
            currentProblem: this.currentProblem,
            attemptIndex: this.attemptIndex,
            totalMoves: this.currentProblem?.moves.length || 0,
            isPlayerTurn: this.attemptIndex % 2 === 1,
            problemCount: this.problems.length,
            filteredCount: this.getFilteredProblems().length
        };
    }

    isLoaded() {
        return this.problems.length > 0;
    }

    reset() {
        // ⭐ Annuler le timer de pause
        this.cancelPauseTimer();
        this.cancelVotingTimer();
        this.votingOpen = false;
        this.votesForCurrentTurn = [];

        // ⭐ Reset les highlights
        this.clearHighlights();
        
        // Masquer le timer
        document.body.classList.remove('showTimer');
        this.hideTimerMessage();
        
        this.currentProblem = null;
        this.attemptIndex = 0;
        this.isActive = false;

        this.emitStateChange();
    }
}

// ========== INSTANCE GLOBALE ==========
window.problemsManager = new ProblemsManager();

export default window.problemsManager;