/**
 * TIMER MODULE
 * Gestion du countdown pour les tours de jeu
 */

class Timer {
    constructor() {
        this.duration = 25;          // Durée initiale en secondes
        this.remaining = 0;          // Temps restant
        this.intervalId = null;      // ID de l'interval
        this.isRunning = false;
        this.isPaused = false;       // Nouveau: état de pause
        
        // Callbacks
        this.onTick = null;          // Appelé chaque seconde
        this.onComplete = null;      // Appelé quand le timer atteint 0
        this.onPause = null;         // Appelé quand le timer est mis en pause
        this.onResume = null;        // Appelé quand le timer reprend
        
        // Éléments DOM
        this.countdownEl = null;
        this.timerValueEl = null;
    }

    /**
     * Initialise le timer avec les éléments DOM
     */
    init(options = {}) {
        this.duration = options.duration || 25;
        this.countdownEl = document.querySelector('.countdown');
        this.timerValueEl = document.getElementById('timer-value');
        
        if (options.onTick) this.onTick = options.onTick;
        if (options.onComplete) this.onComplete = options.onComplete;
        if (options.onPause) this.onPause = options.onPause;
        if (options.onResume) this.onResume = options.onResume;
        
        console.log('⏱️ Timer initialisé:', this.duration, 'secondes');
        return this;
    }

    /**
     * Démarre le timer
     */
    start(duration = null) {
        // Nettoyer l'ancien timer si existant
        this.stop();
        
        if (duration !== null) {
            this.duration = duration;
        }
        
        this.remaining = this.duration;
        this.isRunning = true;
        this.isPaused = false;
        
        // Mettre à jour l'affichage initial
        this.updateDisplay();
        
        // Afficher le timer
        document.body.classList.add('showTimer');
        
        // Configurer les variables CSS pour l'animation
        if (this.countdownEl) {
            this.countdownEl.style.setProperty('--q', this.duration);
            this.countdownEl.style.setProperty('--t', this.duration);
        }
        
        // Démarrer l'interval
        this.intervalId = setInterval(() => this.tick(), 1000);
        if (window.AppState) (AppState._timerIds = AppState._timerIds || []).push(this.intervalId);

        console.log('▶️ Timer démarré:', this.duration, 'secondes');
    }

    /**
     * Appelé chaque seconde
     */
    tick() {
        // Ne pas décrémenter si en pause
        if (this.isPaused) return;
        
        this.remaining--;
        
        // Mettre à jour l'affichage
        this.updateDisplay();
        
        // Callback onTick
        if (this.onTick) {
            this.onTick(this.remaining);
        }
        
        // Timer terminé
        if (this.remaining <= 0) {
            this.complete();
        }
    }

    /**
     * Timer terminé
     */
    complete() {
        this.stop();
        
        console.log('⏱️ Timer terminé!');
        
        // Callback onComplete
        if (this.onComplete) {
            this.onComplete();
        }
    }

    /**
     * Arrête le timer
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            if (window.AppState) AppState._timerIds = AppState._timerIds?.filter(id => id !== this.intervalId) ?? []; // ← AJOUTER
            this.intervalId = null;
        }
        
        this.isRunning = false;
        this.isPaused = false;
        document.body.classList.remove('showTimer');
        
        // Retirer la classe urgence et pause
        if (this.countdownEl) {
            this.countdownEl.classList.remove('timer-critical');
            this.countdownEl.classList.remove('timer-paused');
        }
    }

    /**
     * Met en pause le timer
     */
    pause() {
        if (!this.isRunning || this.isPaused) return;
        
        this.isPaused = true;
        
        // Ajouter une indication visuelle de pause
        if (this.countdownEl) {
            this.countdownEl.classList.add('timer-paused');
        }
        
        // Callback
        if (this.onPause) {
            this.onPause(this.remaining);
        }
        
        console.log('⏸️ Timer en pause:', this.remaining, 'secondes restantes');
    }

    /**
     * Reprend le timer
     */
    resume() {
        if (!this.isRunning || !this.isPaused) return;
        
        this.isPaused = false;
        
        // Retirer l'indication visuelle de pause
        if (this.countdownEl) {
            this.countdownEl.classList.remove('timer-paused');
        }
        
        // Callback
        if (this.onResume) {
            this.onResume(this.remaining);
        }
        
        console.log('▶️ Timer repris:', this.remaining, 'secondes restantes');
    }

    /**
     * Met à jour l'affichage du timer
     */
    updateDisplay() {
        const seconds = this.remaining;
        
        // Affichage textuel (MM:SS)
        if (this.timerValueEl) {
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            this.timerValueEl.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            
            // Ajouter indicateur de pause
            if (this.isPaused) {
                this.timerValueEl.textContent += ' ⏸';
            }
        }
        
        // Affichage circulaire (variables CSS)
        if (this.countdownEl) {
            this.countdownEl.style.setProperty('--t', seconds);
            this.countdownEl.style.setProperty('--s', seconds);
            
            // Animation urgence pour les dernières secondes (sauf si en pause)
            if (seconds <= 5 && !this.isPaused) {
                this.countdownEl.classList.add('timer-critical');
            } else {
                this.countdownEl.classList.remove('timer-critical');
            }
        }
    }

    /**
     * Change la durée du timer (pour le prochain start)
     */
    setDuration(duration) {
        this.duration = duration;
    }

    /**
     * Retourne le temps restant
     */
    getRemaining() {
        return this.remaining;
    }
    
    /**
     * Retourne si le timer est en pause
     */
    getIsPaused() {
        return this.isPaused;
    }
}

// Instance singleton
const timer = new Timer();
window.timer = timer;

(function() {
    'use strict';

    // Attendre que le DOM soit prêt
    document.addEventListener('DOMContentLoaded', function() {
        initBoardTimer();
    });

    function initBoardTimer() {
        // Trouver le conteneur de l'échiquier
        const boardWrapper = document.querySelector('.board-wrapper') || 
                            document.getElementById('board_wrapper');
        
        if (!boardWrapper) {
            console.warn('⚠️ Board wrapper non trouvé, réessai dans 500ms');
            setTimeout(initBoardTimer, 500);
            return;
        }

        // Vérifier si le timer n'existe pas déjà
        if (document.querySelector('.board-timer-container')) {
            console.log('✅ Timer container déjà présent');
            return;
        }

        // Créer le conteneur du timer
        const timerContainer = document.createElement('div');
        timerContainer.className = 'board-timer-container';
        timerContainer.innerHTML = `
            <div class="countdown" id="countdown">
                <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45"></circle>
                    <circle cx="50" cy="50" r="45"></circle>
                </svg>
            </div>
            <div id="timer-value">--:--</div>
            <button class="timer-pause-btn" id="timer-pause-btn" style="display: none;">
                <i class="fas fa-pause"></i>
                <span>Pause</span>
            </button>
        `;

        // S'assurer que le parent est en position relative
        boardWrapper.style.position = 'relative';
        
        // Insérer le timer dans le board-wrapper
        boardWrapper.appendChild(timerContainer);

        console.log('✅ Timer repositionné en haut à droite de l\'échiquier');

        // Initialiser le bouton pause/reprise
        initPauseButton();
    }

    function initPauseButton() {
        const pauseBtn = document.getElementById('timer-pause-btn');
        if (!pauseBtn) return;

        pauseBtn.addEventListener('click', function() {
            // Accéder au timer global si disponible
            if (typeof timer !== 'undefined') {
                if (timer.isPaused) {
                    timer.resume();
                    updatePauseButton(false);
                } else {
                    timer.pause();
                    updatePauseButton(true);
                }
            } else {
                console.warn('⚠️ Timer global non disponible');
            }
        });

        // Écouter les changements d'état du timer
        document.addEventListener('timerStateChanged', function(e) {
            if (e.detail && e.detail.isRunning) {
                pauseBtn.style.display = 'flex';
                updatePauseButton(e.detail.isPaused);
            } else {
                pauseBtn.style.display = 'none';
            }
        });
    }

    function updatePauseButton(isPaused) {
        const pauseBtn = document.getElementById('timer-pause-btn');
        if (!pauseBtn) return;

        const icon = pauseBtn.querySelector('i');
        const text = pauseBtn.querySelector('span');

        if (isPaused) {
            icon.className = 'fas fa-play';
            text.textContent = 'Reprendre';
            pauseBtn.style.background = 'rgba(255, 152, 0, 0.2)';
            pauseBtn.style.borderColor = 'rgba(255, 152, 0, 0.4)';
        } else {
            icon.className = 'fas fa-pause';
            text.textContent = 'Pause';
            pauseBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            pauseBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        }
    }

    // Exposer une fonction pour mettre à jour l'affichage du timer
    window.updateBoardTimerDisplay = function(seconds) {
        const timerValue = document.getElementById('timer-value');
        const countdown = document.getElementById('countdown');
        
        if (!timerValue || !countdown) return;

        // Formater l'affichage MM:SS
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerValue.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        // Mettre à jour les variables CSS pour le cercle
        countdown.style.setProperty('--t', seconds);
        countdown.style.setProperty('--s', seconds);

        // Ajouter la classe urgence pour les dernières secondes
        if (seconds <= 5) {
            countdown.classList.add('timer-critical');
        } else {
            countdown.classList.remove('timer-critical');
        }
    };

})();
// Export
export { Timer, timer };
export default timer;