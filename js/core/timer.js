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

// Export
export { Timer, timer };
export default timer;