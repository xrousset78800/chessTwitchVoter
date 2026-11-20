/**
 * 🔧 INTÉGRATION DE problemsManager.js
 * 
 * Ce fichier montre comment intégrer le ProblemsManager avec le gameEngine existant.
 * 
 * À ajouter dans app.js ou dans un fichier séparé chargé après gameEngine.js
 */

import problemsManager from './core/problemsManager.js';
import gameEngine from './core/gameEngine.js';

// ========== INITIALISATION ==========

/**
 * Initialise le mode problèmes
 */
async function initProblemsMode() {
    console.log('🧩 Initialisation du mode Problèmes...');
    
    // 1. Charger les problèmes si pas encore fait
    if (!problemsManager.isLoaded()) {
        try {
            await problemsManager.loadProblems('js/problemsV2.csv');
        } catch (error) {
            console.error('Erreur chargement problèmes:', error);
            Toast?.error('Erreur chargement des problèmes');
            return false;
        }
    }
    
    // 2. Injecter les références au chess et board
    problemsManager.init({
        chess: gameEngine.chess,
        board: gameEngine.board,
        config: {
            pauseAfterEnd: 5,
            botMoveDelay: 1500
        }
    });
    
    // 3. Configurer les callbacks
    setupProblemsCallbacks();
    
    return true;
}

/**
 * Configure les callbacks du ProblemsManager
 */
function setupProblemsCallbacks() {
    
    // Quand un problème est chargé
    problemsManager.onProblemLoaded = (problem) => {
        console.log('📋 Problème chargé:', problem.id);
        
        // Mettre à jour l'UI
        updateProblemUI(problem);
        
        // Sync Phantom si connecté
        if (window.phantomChessboard?.isConnected) {
            window.phantomChessboard.syncPosition(gameEngine.chess.fen());
        }
    };
    
    // Quand le bot joue
    problemsManager.onBotMove = (move) => {
        console.log('🤖 Bot:', move.san);
        
        // Mettre à jour l'historique
        updateMoveHistory(move, 'bot');
        
        // Sync Phantom
        if (window.phantomChessboard?.isConnected) {
            window.phantomChessboard.syncPosition(gameEngine.chess.fen());
        }
        
        // Activer les votes/input
        enablePlayerInput();
    };
    
    // Quand le joueur joue un coup correct
    problemsManager.onCorrectMove = (move) => {
        console.log('✅ Correct:', move.san);
        
        // Feedback visuel
        showFeedback('correct');
        
        // Mettre à jour l'historique
        updateMoveHistory(move, 'player');
        
        // Sync Phantom
        if (window.phantomChessboard?.isConnected) {
            window.phantomChessboard.syncPosition(gameEngine.chess.fen());
        }
        
        // Désactiver temporairement l'input (en attente du bot)
        disablePlayerInput();
    };
    
    // Quand le joueur se trompe
    problemsManager.onWrongMove = (expectedSAN, expectedUCI) => {
        console.log('❌ Erreur! Attendu:', expectedSAN);
        
        // Feedback visuel
        showFeedback('wrong', expectedSAN);
        
        Toast?.error(`Mauvais coup ! Le bon était ${expectedSAN}`);
    };
    
    // Problème résolu
    problemsManager.onProblemSolved = (problem) => {
        console.log('🎉 Résolu!');
        
        // Animation de victoire
        document.body.classList.add('problem-solved');
        Toast?.success('🎉 Problème résolu !');
        
        // Charger le prochain après un délai
        setTimeout(() => {
            document.body.classList.remove('problem-solved');
            problemsManager.loadRandomProblem();
        }, problemsManager.config.pauseAfterEnd * 1000);
    };
    
    // Problème échoué
    problemsManager.onProblemFailed = (problem) => {
        console.log('💔 Échoué');
        
        // Animation d'échec
        document.body.classList.add('problem-failed');
        
        // Charger le prochain après un délai
        setTimeout(() => {
            document.body.classList.remove('problem-failed');
            problemsManager.loadRandomProblem();
        }, problemsManager.config.pauseAfterEnd * 1000);
    };
    
    // Changement d'état
    problemsManager.onStateChange = (state) => {
        updateProblemStateUI(state);
    };
}

// ========== UI HELPERS ==========

function updateProblemUI(problem) {
    // Mettre à jour les éléments data-* si présents
    const elements = {
        'data-prob-id': problem.id,
        'data-prob-elo': problem.rating,
        'data-opening-tags': problem.themes,
        'data-fen': problem.fen,
        'data-length': Math.ceil(problem.moves.length / 2)
    };
    
    for (const [attr, value] of Object.entries(elements)) {
        const el = document.querySelector(`[${attr}]`);
        if (el) {
            el.textContent = value;
            el.setAttribute(attr, value);
        }
    }
}

function updateProblemStateUI(state) {
    // Mettre à jour le compteur de coups
    const attemptEl = document.querySelector('[data-attempt]');
    if (attemptEl) {
        attemptEl.textContent = state.playerMoves;
        attemptEl.setAttribute('data-attempt', state.attemptIndex);
    }
    
    // Indiquer le tour
    document.body.classList.toggle('player-turn', state.isPlayerTurn);
    document.body.classList.toggle('bot-turn', !state.isPlayerTurn);
}

function updateMoveHistory(move, player) {
    const historyEl = document.querySelector('.move-history, .poll ol, #move-history');
    if (!historyEl) return;
    
    const moveEl = document.createElement('span');
    moveEl.className = player === 'bot' ? 'move-bot' : 'move-player';
    moveEl.textContent = move.san;
    
    historyEl.appendChild(moveEl);
}

function showFeedback(type, message = '') {
    const feedbackEl = document.getElementById('problem-feedback');
    if (feedbackEl) {
        feedbackEl.className = `feedback feedback-${type}`;
        feedbackEl.textContent = type === 'correct' ? '✓' : `✗ ${message}`;
        feedbackEl.style.display = 'block';
        
        setTimeout(() => {
            feedbackEl.style.display = 'none';
        }, 2000);
    }
}

function enablePlayerInput() {
    // Réactiver les votes ou le drag&drop
    document.body.classList.add('accepting-moves');
    window.voteOpen = true;
}

function disablePlayerInput() {
    document.body.classList.remove('accepting-moves');
    window.voteOpen = false;
}

// ========== INTÉGRATION AVEC LE SYSTÈME DE VOTES ==========

/**
 * Hook pour le système de votes
 * Appelé quand un coup est sélectionné (par vote ou par drag&drop)
 */
function handleMoveSelected(move) {
    // Si le mode problèmes est actif
    if (problemsManager.isActive) {
        const result = problemsManager.validateAndPlayMove(move);
        return result.correct;
    }
    
    // Sinon, comportement normal
    return true;
}

// ========== MODIFICATION DE applyConfig() ==========

/**
 * Version modifiée de applyConfig pour supporter le mode problèmes
 * À intégrer dans SandboxPage.applyConfig()
 */
async function applyConfigWithProblems() {
    console.log('🎮 Application de la configuration...');
    console.log('📋 Mode:', AppState.gameMode);
    
    // Sauvegarder
    Storage.saveConfig();
    
    // ========== MODE PROBLÈMES ==========
    if (AppState.gameMode === 'problems') {
        
        // Initialiser le mode problèmes
        const success = await initProblemsMode();
        if (!success) {
            Toast?.error('Erreur initialisation mode problèmes');
            return;
        }
        
        // Appliquer les thèmes sélectionnés
        const themesSelect = document.getElementById('problem-themes');
        if (themesSelect) {
            problemsManager.clearThemes();
            Array.from(themesSelect.selectedOptions).forEach(opt => {
                problemsManager.toggleTheme(opt.value);
            });
        }
        
        // Charger le premier problème
        problemsManager.loadRandomProblem();
        
        Toast?.success('🧩 Mode Problèmes activé !');
        return;
    }
    
    // ========== AUTRES MODES ==========
    // ... (code existant pour les autres modes)
    
    gameEngine.setConfig({
        timerEnabled: AppState.config.timerEnabled,
        timerDuration: AppState.config.timerDuration,
        wheelDuration: AppState.config.wheelDuration,
        pauseAfterEnd: AppState.config.pauseAfterEnd,
        majorityMode: AppState.config.majorityMode,
        votesPerViewer: AppState.config.votesPerViewer
    });
    
    gameEngine.startGame();
    Toast?.success('✅ Configuration appliquée !');
}

// ========== EXPORTS ==========

export {
    initProblemsMode,
    handleMoveSelected,
    applyConfigWithProblems
};