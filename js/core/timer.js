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
        
        // Callbacks
        this.onTick = null;          // Appelé chaque seconde
        this.onComplete = null;      // Appelé quand le timer atteint 0
        
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
        document.body.classList.remove('showTimer');
        
        // Retirer la classe urgence
        if (this.countdownEl) {
            this.countdownEl.classList.remove('timer-critical');
        }
    }

    /**
     * Met en pause le timer
     */
    pause() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('⏸️ Timer en pause:', this.remaining, 'secondes restantes');
    }

    /**
     * Reprend le timer
     */
    resume() {
        if (!this.isRunning && this.remaining > 0) {
            this.isRunning = true;
            this.intervalId = setInterval(() => this.tick(), 1000);
            console.log('▶️ Timer repris:', this.remaining, 'secondes restantes');
        }
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
        }
        
        // Affichage circulaire (variables CSS)
        if (this.countdownEl) {
            this.countdownEl.style.setProperty('--t', seconds);
            this.countdownEl.style.setProperty('--s', seconds);
            
            // Animation urgence pour les dernières secondes
            if (seconds <= 5) {
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
}

// Instance singleton
const timer = new Timer();

// Export
export { Timer, timer };
export default timer;