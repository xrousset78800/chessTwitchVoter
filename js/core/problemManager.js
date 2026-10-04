/**
 * 🧩 PROBLEMS MANAGER v3 - CORRECTIONS COMPLÈTES
 * 
 * CORRECTIONS:
 * - Pas de modale, utilise le timer existant
 * - Pas de double timer (clearInterval correct)
 * - Reset des highlights quand on change de mode
 * - Mise à jour des coups disponibles
 */

import { matchLegalMove } from '../utils/moveMatch.js';

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
        this.onNoVote = null;            // timer écoulé sans aucun vote

        // Puzzle Rush : fournit le prochain puzzle (null = plus rien, false = ignorer l'appel)
        this.nextProblemProvider = null;
        
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

        if (this.nextProblemProvider) {
            const next = this.nextProblemProvider();
            if (next === false) return null;          // appel doublon, ignoré
            if (!next) {
                console.log('🧩 Plus de problème à charger (session terminée)');
                return null;
            }
            return this.loadProblem(next);
        }
        
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
    this.cancelVotingTimer();
    this._resetWheel();

    if (this.config.timerEnabled && this.config.timerDuration > 0) {
        this.votingOpen = true;
        window.timer.onTick = null;
        window.timer.onComplete = () => {
            this.votingOpen = false;
            const winner = this.resolveVotes();
            if (winner) {
                const result = this.validateAndPlayMove(winner);
                if (result && result.valid === false) {
                    this.failCurrentProblem(`Coup non jouable : ${winner}`);
                }
            } else if (this.onNoVote) {
                this.onNoVote();
            } else {
                // Personne n'a voté : on rouvre le tour
                this.startPlayerTurn();
            }
        };
        window.timer.start(this.config.timerDuration);
    } else {
        this.votingOpen = true;
    }
}

cancelVotingTimer() {
    timer.stop();
    this.votingTimerId = null; // gardé pour compatibilité mais inutilisé
}

receiveVote(voteData) {
    const rawMove = typeof voteData === 'string' ? voteData : voteData.move;
    const username = typeof voteData === 'string' ? 'anonyme' : (voteData.displayName || voteData.username || 'anonyme');
    
    if (!this.votingOpen) {
        console.log('🗳️ Vote rejeté : votes fermés');
        return false;
    }
    if (!this.isActive || this.attemptIndex % 2 !== 1) {
        console.log('🗳️ Vote rejeté : pas le tour du joueur');
        return false;
    }
    
    // "kh1" → "Kh1" : on résout contre les coups légaux (casse ignorée).
    // Un coup illégal n'est pas un vote.
    const resolved = matchLegalMove(this.chess, rawMove);
    if (!resolved) {
        console.log('🗳️ Vote rejeté : coup illégal', rawMove);
        return false;
    }
    const move = resolved.san;

    this.votesForCurrentTurn.push({ move, username });
    console.log(`🗳️ Vote enregistré: ${move} par ${username} (total: ${this.votesForCurrentTurn.length})`);
    
    // Log dans la sidebar
    if (window.VoteLog) window.VoteLog.add(username, move);
    
    this.syncWheelDisplay();
    
    if (!this.config.timerEnabled) {
        this.votingOpen = false;
        const result = this.validateAndPlayMove(move);
        if (result && result.valid === false) this.votingOpen = true; // coup non jouable : on reste ouvert
    }
    
    return true;
}

syncWheelDisplay() {
    const wheel = window.gameEngine?.votingWheel;
    if (!wheel || wheel.isSpinning) return;

    const counts = {};
    this.votesForCurrentTurn.forEach(v => {
        const mv = typeof v === 'string' ? v : v.move;
        counts[mv] = (counts[mv] || 0) + 1;
    });

    if (Object.keys(counts).length === 0) return;

    wheel.votes.clear();
    Object.entries(counts).forEach(([move, count]) => {
        wheel.votes.set(move, { count, voters: new Map([['twitch', count]]) });
    });

    wheel.draw();
    wheel.updateVoteList();
    // Mode problèmes/rush : toujours majorité, la roue reste masquée
}
resolveVotes() {
    const counts = {};
    this.votesForCurrentTurn.forEach(v => {
        const mv = typeof v === 'string' ? v : v.move;
        counts[mv] = (counts[mv] || 0) + 1;
    });

    // Mode problèmes : TOUJOURS majorité, jamais de roue
    if (Object.keys(counts).length === 0) return null;
    
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
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
            this.votesForCurrentTurn = [];

            // Reset de la roue
            const wheel = window.gameEngine?.votingWheel;
            if (wheel) {
                wheel.isSpinning = false;
                wheel.spinVotes = null;
                wheel.spinTotalVotes = null;
                wheel.clear();
                wheel.draw();
                window.gameEngine.hideWheel();
                document.body.classList.remove('randomWheel');
            }


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
                        if (this.config.timerEnabled && this.votingOpen) {
                            this.receiveVote(move);
                            console.log('🗳️ Vote ajouté via clic:', move);
                        } else {
                            const result = this.validateAndPlayMove(move);
                            console.log('🧩 Clic sur coup:', move, result);
                        }
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

        const str = String(move).trim();
        const strLower = str;

        // UCI : toujours en minuscules (ex: e2e4)
        const uciMatch = strLower.match(/^([a-h][1-8])-?([a-h][1-8])([qrbn])?$/);
        if (uciMatch) {
            return uciMatch[1] + uciMatch[2] + (uciMatch[3] || '');
        }

        // Roque
        if (/^(o-o-o|0-0-0)$/i.test(str)) {
            const turn = this.chess?.turn();
            return turn === 'w' ? 'e1c1' : 'e8c8';
        }
        if (/^(o-o|0-0)$/i.test(str)) {
            const turn = this.chess?.turn();
            return turn === 'w' ? 'e1g1' : 'e8g8';
        }

        // SAN quelle que soit la casse ("kh1", "Kh1", "KH1") : coups légaux
        const matched = matchLegalMove(this.chess, str);
        if (matched) return matched.uci;

        try {
            // SAN : conserver la casse originale (Bc3 ≠ bc3 pour chess.js)
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
_resetWheel() {
    this.votesForCurrentTurn = [];
    const wheel = window.gameEngine?.votingWheel;
    if (wheel) {
        wheel.isSpinning = false;
        wheel.spinVotes = null;
        wheel.spinTotalVotes = null;
        wheel.clear();
        wheel.draw();
        window.gameEngine.hideWheel();
        document.body.classList.remove('randomWheel');
    }
}
handleProblemSolved() {
    console.log('🎉 PROBLÈME RÉSOLU !');
    this.isActive = false;
    this._resetWheel();
    try { this.sounds.success?.play(); } catch {}
    if (this.onProblemSolved) this.onProblemSolved(this.currentProblem);
    this.emitStateChange();
    this.startPauseTimer('solved');
}

/** Déclare le problème courant échoué sans coup joué (ex: aucun vote) */
failCurrentProblem(reason = '') {
    if (!this.isActive || !this.currentProblem) return false;
    console.log('💔 Échec forcé :', reason);

    const expectedUCI = this.currentProblem.moves[this.attemptIndex];
    if (expectedUCI) {
        const expectedSAN = this.uciToSAN(expectedUCI);
        if (this.onWrongMove) this.onWrongMove(expectedSAN, expectedUCI);
        const correctMove = this.uciToMoveObject(expectedUCI);
        if (correctMove) this.highlightSquares(correctMove.from, correctMove.to, 'correct');
    }

    this.votingOpen = false;
    this.cancelVotingTimer();
    this.handleProblemFailed();
    return true;
}

handleProblemFailed() {
    console.log('💔 PROBLÈME ÉCHOUÉ');
    this.isActive = false;
    this._resetWheel();
    try { this.sounds.fail?.play(); } catch {}
    if (this.onProblemFailed) this.onProblemFailed(this.currentProblem);
    this.emitStateChange();
    this.startPauseTimer('failed');
}

    // ========== TIMER DE PAUSE INLINE ==========

startPauseTimer(status) {
    const pauseDuration = this.config.pauseAfterEnd || 5;
    this.showTimerMessage(status, pauseDuration);

    window.timer.onTick = null;
    window.timer.onComplete = () => {
        this.hideTimerMessage();
        this.loadRandomProblem();
    };
    window.timer.start(pauseDuration);
}
cancelVotingTimer() {
    if (window.timer) window.timer.stop();
    this.votingTimerId = null;
}

skipPause() {
    if (window.timer) window.timer.stop();
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

cancelPauseTimer() {
    if (window.timer) window.timer.stop();
    this.pauseTimerId = null;
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