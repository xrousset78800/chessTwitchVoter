/**
 * 🧩 PROBLEMS MANAGER
 * 
 * Module autonome pour la gestion des puzzles d'échecs.
 * Reprend la logique de chessVoterApp.js en version propre et modulaire.
 * 
 * S'intègre avec gameEngine.js et le système de votes.
 */

class ProblemsManager {
    constructor() {
        // État
        this.problems = [];           // Tous les problèmes chargés
        this.currentProblem = null;   // Problème en cours
        this.attemptIndex = 0;        // Index du coup actuel dans la solution
        this.isActive = false;        // Mode problème actif
        
        // Filtres
        this.selectedThemes = new Set();
        this.themeStats = {};         // { theme: count }
        
        // Références externes (injectées)
        this.chess = null;            // Instance Chess.js
        this.board = null;            // Instance Chessboard.js
        
        // Configuration
        this.config = {
            csvPath: 'js/problemsV2.csv',
            pauseAfterEnd: 5,         // Secondes avant prochain problème
            botMoveDelay: 1500        // Délai avant coup du bot (ms)
        };
        
        // Callbacks
        this.onProblemLoaded = null;  // (problem) => {}
        this.onCorrectMove = null;    // () => {}
        this.onWrongMove = null;      // (correctMove) => {}
        this.onProblemSolved = null;  // (problem) => {}
        this.onProblemFailed = null;  // (problem) => {}
        this.onBotMove = null;        // (move) => {}
        this.onStateChange = null;    // (state) => {}
        
        // Sons
        this.sounds = {
            move: null,
            capture: null,
            check: null,
            success: null,
            fail: null
        };
        
        console.log('🧩 ProblemsManager initialisé');
    }
    
    // ========== INITIALISATION ==========
    
    /**
     * Initialise le manager avec les références nécessaires
     */
    init(options = {}) {
        if (options.chess) this.chess = options.chess;
        if (options.board) this.board = options.board;
        if (options.config) Object.assign(this.config, options.config);
        
        // Charger les sons
        this.loadSounds();
        
        console.log('🧩 ProblemsManager initialisé avec config:', this.config);
    }
    
    /**
     * Charge les sons
     */
    loadSounds() {
        try {
            this.sounds.move = new Audio('mp3/move.mp3');
            this.sounds.capture = new Audio('mp3/take.mp3');
            this.sounds.check = new Audio('mp3/check.mp3');
            this.sounds.success = new Audio('mp3/mate.wav');
            this.sounds.fail = new Audio('mp3/check.mp3');
        } catch (e) {
            console.warn('🧩 Sons non chargés:', e);
        }
    }
    
    // ========== CHARGEMENT DES PROBLÈMES ==========
    
    /**
     * Charge les problèmes depuis le CSV
     */
    async loadProblems(csvPath = null) {
        const path = csvPath || this.config.csvPath;
        console.log('🧩 Chargement des problèmes depuis:', path);
        
        try {
            const response = await fetch(path);
            const data = await response.text();
            
            const lines = data.split('\n').filter(line => line.trim());
            const parsed = lines.map(line => this.parseCSVLine(line));
            
            // Ignorer l'en-tête, filtrer les lignes valides
            this.problems = parsed.slice(1).filter(row => row.length >= 8);
            
            console.log(`✅ ${this.problems.length} problèmes chargés`);
            
            // Analyser les thèmes
            this.analyzeThemes();
            
            return this.problems.length;
            
        } catch (error) {
            console.error('❌ Erreur chargement problèmes:', error);
            throw error;
        }
    }
    
    /**
     * Parse une ligne CSV (gère les guillemets)
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
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
    
    /**
     * Analyse les thèmes disponibles
     */
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
        
        console.log(`🎨 ${Object.keys(this.themeStats).length} thèmes analysés`);
    }
    
    // ========== FILTRAGE ==========
    
    /**
     * Retourne les problèmes filtrés par thèmes
     */
    getFilteredProblems() {
        if (this.selectedThemes.size === 0) {
            return this.problems;
        }
        
        return this.problems.filter(problem => {
            const themesStr = (problem[7] || '').replace(/^"|"$/g, '');
            const themes = themesStr.includes(',')
                ? themesStr.split(',').map(t => t.trim())
                : themesStr.split(' ').map(t => t.trim());
            
            return themes.some(t => this.selectedThemes.has(t));
        });
    }
    
    /**
     * Sélectionne/désélectionne un thème
     */
    toggleTheme(theme) {
        if (this.selectedThemes.has(theme)) {
            this.selectedThemes.delete(theme);
        } else {
            this.selectedThemes.add(theme);
        }
    }
    
    /**
     * Sélectionne tous les thèmes
     */
    selectAllThemes() {
        this.selectedThemes = new Set(Object.keys(this.themeStats));
    }
    
    /**
     * Efface la sélection de thèmes
     */
    clearThemes() {
        this.selectedThemes.clear();
    }
    
    // ========== GESTION DES PROBLÈMES ==========
    
    /**
     * Charge un nouveau problème aléatoire
     */
    loadRandomProblem() {
        const filtered = this.getFilteredProblems();
        
        if (filtered.length === 0) {
            console.warn('⚠️ Aucun problème disponible');
            return null;
        }
        
        // Sélection aléatoire
        const problem = filtered[Math.floor(Math.random() * filtered.length)];
        return this.loadProblem(problem);
    }
    
    /**
     * Charge un problème spécifique
     * @param {Array} problem - [id, fen, moves, rating, ...]
     */
    loadProblem(problem) {
        if (!problem || problem.length < 3) {
            console.error('❌ Problème invalide:', problem);
            return null;
        }
        
        this.currentProblem = {
            id: problem[0],
            fen: problem[1],
            solution: problem[2],          // "e3g3 f7f4 e5f4 f8f4"
            moves: problem[2].split(' '),  // ["e3g3", "f7f4", "e5f4", "f8f4"]
            rating: parseInt(problem[3]) || 0,
            themes: problem[7] || '',
            url: problem[8] || ''
        };
        
        this.attemptIndex = 0;
        this.isActive = true;
        
        console.log('🧩 Problème chargé:', this.currentProblem.id, 
                    'Rating:', this.currentProblem.rating,
                    'Moves:', this.currentProblem.moves.length);
        
        // Initialiser l'échiquier
        if (this.chess) {
            this.chess.load(this.currentProblem.fen);
        }
        
        // Déterminer l'orientation
        const orientation = this.chess?.turn() === 'b' ? 'white' : 'black';
        if (this.board) {
            this.board.position(this.currentProblem.fen, false);
            this.board.orientation(orientation);
        }
        
        // Callback
        if (this.onProblemLoaded) {
            this.onProblemLoaded(this.currentProblem);
        }
        
        // Jouer le premier coup (coup du bot)
        setTimeout(() => {
            this.playBotMove();
        }, 500);
        
        return this.currentProblem;
    }
    
    // ========== LOGIQUE DE JEU ==========
    
    /**
     * Joue le coup du bot (le coup attendu à l'index actuel)
     */
    playBotMove() {
        if (!this.isActive || !this.currentProblem) return null;
        
        const moveStr = this.currentProblem.moves[this.attemptIndex];
        if (!moveStr) return null;
        
        const move = this.parseMove(moveStr);
        if (!move) return null;
        
        // Jouer le coup
        const result = this.chess?.move(move);
        if (!result) {
            console.error('❌ Coup bot invalide:', moveStr);
            return null;
        }
        
        // Mettre à jour l'échiquier
        if (this.board) {
            this.board.position(this.chess.fen());
        }
        
        // Highlight
        this.highlightSquares(moveStr.slice(0, 2), moveStr.slice(2, 4), 'bot');
        
        // Son
        this.playMoveSound(result);
        
        // Incrémenter l'index
        this.attemptIndex++;
        
        console.log('🤖 Bot joue:', result.san);
        
        // Callback
        if (this.onBotMove) {
            this.onBotMove(result);
        }
        
        // Notifier le changement d'état
        this.emitStateChange();
        
        return result;
    }
    
    /**
     * Vérifie et joue le coup du joueur
     * @param {string} move - Coup en notation SAN (ex: "Nf3") ou UCI (ex: "g1f3")
     * @returns {Object} { valid: boolean, correct: boolean, move?: ChessMove }
     */
    validateAndPlayMove(move) {
        if (!this.isActive || !this.currentProblem) {
            return { valid: false, correct: false, reason: 'Aucun problème actif' };
        }
        
        // Vérifier que c'est bien le tour du joueur (index impair)
        if (this.attemptIndex % 2 === 0) {
            return { valid: false, correct: false, reason: 'C\'est le tour du bot' };
        }
        
        // Obtenir le coup attendu
        const expectedMoveStr = this.currentProblem.moves[this.attemptIndex];
        if (!expectedMoveStr) {
            return { valid: false, correct: false, reason: 'Fin de la solution' };
        }
        
        // Essayer de jouer le coup
        let playedMove;
        try {
            playedMove = this.chess.move(move);
            if (!playedMove) {
                return { valid: false, correct: false, reason: 'Coup illégal' };
            }
        } catch (e) {
            return { valid: false, correct: false, reason: 'Coup invalide' };
        }
        
        // Vérifier si c'est le bon coup
        const playedUCI = playedMove.from + playedMove.to + (playedMove.promotion || '');
        const isCorrect = playedUCI === expectedMoveStr;
        
        if (isCorrect) {
            // ✅ Coup correct
            this.attemptIndex++;
            
            // Mettre à jour l'échiquier
            if (this.board) {
                this.board.position(this.chess.fen());
            }
            
            // Highlight
            this.highlightSquares(playedMove.from, playedMove.to, 'player');
            
            // Son
            this.playMoveSound(playedMove);
            
            console.log('✅ Coup correct:', playedMove.san);
            
            // Callback
            if (this.onCorrectMove) {
                this.onCorrectMove(playedMove);
            }
            
            // Vérifier si le problème est terminé
            if (this.attemptIndex >= this.currentProblem.moves.length) {
                this.handleProblemSolved();
            } else {
                // Jouer le prochain coup du bot après un délai
                setTimeout(() => {
                    this.playBotMove();
                }, this.config.botMoveDelay);
            }
            
            this.emitStateChange();
            
            return { valid: true, correct: true, move: playedMove };
            
        } else {
            // ❌ Mauvais coup - annuler
            this.chess.undo();
            
            const expectedMove = this.parseMove(expectedMoveStr);
            const expectedSAN = this.getMoveAsSAN(expectedMoveStr);
            
            console.log('❌ Mauvais coup:', playedMove.san, '- Attendu:', expectedSAN);
            
            // Callback
            if (this.onWrongMove) {
                this.onWrongMove(expectedSAN, expectedMoveStr);
            }
            
            // Highlight le coup correct
            this.highlightSquares(expectedMoveStr.slice(0, 2), expectedMoveStr.slice(2, 4), 'correct');
            
            // Gérer l'échec
            this.handleProblemFailed();
            
            return { valid: true, correct: false, move: playedMove, expected: expectedSAN };
        }
    }
    
    /**
     * Parse un coup UCI en objet move
     */
    parseMove(uci) {
        if (!uci || uci.length < 4) return null;
        
        return {
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci.length > 4 ? uci[4] : undefined
        };
    }
    
    /**
     * Convertit un coup UCI en SAN
     */
    getMoveAsSAN(uci) {
        const move = this.parseMove(uci);
        if (!move) return uci;
        
        // Tester le coup pour obtenir le SAN
        try {
            const result = this.chess.move(move);
            if (result) {
                this.chess.undo();
                return result.san;
            }
        } catch (e) {}
        
        return uci;
    }
    
    // ========== FIN DE PROBLÈME ==========
    
    /**
     * Gère la résolution réussie du problème
     */
    handleProblemSolved() {
        console.log('🎉 Problème résolu!');
        this.isActive = false;
        
        // Son de succès
        this.sounds.success?.play();
        
        // Callback
        if (this.onProblemSolved) {
            this.onProblemSolved(this.currentProblem);
        }
        
        this.emitStateChange();
    }
    
    /**
     * Gère l'échec du problème
     */
    handleProblemFailed() {
        console.log('💔 Problème échoué');
        this.isActive = false;
        
        // Son d'échec
        this.sounds.fail?.play();
        
        // Callback
        if (this.onProblemFailed) {
            this.onProblemFailed(this.currentProblem);
        }
        
        this.emitStateChange();
    }
    
    // ========== UI HELPERS ==========
    
    /**
     * Highlight des cases
     */
    highlightSquares(from, to, type = 'player') {
        // Retirer les anciens highlights
        document.querySelectorAll('.highlight-player, .highlight-bot, .highlight-correct')
            .forEach(el => el.classList.remove('highlight-player', 'highlight-bot', 'highlight-correct'));
        
        const className = `highlight-${type}`;
        
        const fromSquare = document.querySelector(`[data-square="${from}"]`);
        const toSquare = document.querySelector(`[data-square="${to}"]`);
        
        if (fromSquare) fromSquare.classList.add(className);
        if (toSquare) toSquare.classList.add(className);
    }
    
    /**
     * Joue le son approprié
     */
    playMoveSound(move) {
        try {
            if (this.chess.in_checkmate()) {
                this.sounds.success?.play();
            } else if (this.chess.in_check()) {
                this.sounds.check?.play();
            } else if (move.captured) {
                this.sounds.capture?.play();
            } else {
                this.sounds.move?.play();
            }
        } catch (e) {}
    }
    
    /**
     * Émet un événement de changement d'état
     */
    emitStateChange() {
        if (this.onStateChange) {
            this.onStateChange(this.getState());
        }
    }
    
    // ========== GETTERS ==========
    
    /**
     * Retourne l'état actuel
     */
    getState() {
        return {
            isActive: this.isActive,
            currentProblem: this.currentProblem,
            attemptIndex: this.attemptIndex,
            totalMoves: this.currentProblem?.moves.length || 0,
            playerMoves: Math.floor(this.attemptIndex / 2),
            isPlayerTurn: this.attemptIndex % 2 === 1,
            problemCount: this.problems.length,
            filteredCount: this.getFilteredProblems().length
        };
    }
    
    /**
     * Retourne les informations du problème actuel (pour l'UI)
     */
    getProblemInfo() {
        if (!this.currentProblem) return null;
        
        return {
            id: this.currentProblem.id,
            rating: this.currentProblem.rating,
            themes: this.currentProblem.themes,
            url: this.currentProblem.url,
            fen: this.currentProblem.fen,
            moveCount: Math.ceil(this.currentProblem.moves.length / 2),
            currentMove: Math.floor(this.attemptIndex / 2) + 1
        };
    }
    
    /**
     * Retourne le coup attendu (pour debug/hints)
     */
    getExpectedMove() {
        if (!this.isActive || !this.currentProblem) return null;
        
        const moveStr = this.currentProblem.moves[this.attemptIndex];
        return moveStr ? this.getMoveAsSAN(moveStr) : null;
    }
    
    /**
     * Vérifie si les problèmes sont chargés
     */
    isLoaded() {
        return this.problems.length > 0;
    }
    
    /**
     * Reset le manager
     */
    reset() {
        this.currentProblem = null;
        this.attemptIndex = 0;
        this.isActive = false;
        this.emitStateChange();
    }
}

// ========== EXPORT ==========

// Instance globale
window.problemsManager = new ProblemsManager();

// Export ES Module si disponible
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProblemsManager;
}

export default window.problemsManager;