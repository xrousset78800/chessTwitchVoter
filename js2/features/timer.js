/**
 * TIMER.JS - Gestion du timer de jeu
 */

export class Timer {
    constructor(duration = 30) {
        this.duration = duration * 1000; // Convertir en millisecondes
        this.remaining = this.duration;
        this.startTime = null;
        this.interval = null;
        this.isPaused = false;
        this.isRunning = false;
        
        // Callbacks
        this.onTick = null;
        this.onExpire = null;
        this.onWarning = null;
        
        // Éléments UI
        this.displayElement = null;
        this.countdownElement = null;
        
        this.init();
    }

    /**
     * Initialise le timer
     */
    init() {
        // Trouver ou créer l'élément d'affichage
        this.countdownElement = document.querySelector('.countdown');
        this.displayElement = document.getElementById('timerDisplay');
        
        // Créer l'élément si nécessaire
        if (!this.displayElement && !this.countdownElement) {
            this.createTimerDisplay();
        }
    }

    /**
     * Crée l'affichage du timer
     */
    createTimerDisplay() {
        const container = document.createElement('div');
        container.className = 'timer-container';
        container.innerHTML = `
            <div class="timer-display" id="timerDisplay">
                <span class="timer-value">00:00</span>
            </div>
        `;
        
        const gameArea = document.querySelector('.game-main');
        if (gameArea) {
            gameArea.appendChild(container);
        }
        
        this.displayElement = document.getElementById('timerDisplay');
    }

    /**
     * Démarre le timer
     */
    start() {
        if (this.isRunning && !this.isPaused) return;
        
        if (this.isPaused) {
            // Reprendre depuis la pause
            this.isPaused = false;
        } else {
            // Nouveau démarrage
            this.remaining = this.duration;
        }
        
        this.isRunning = true;
        this.startTime = Date.now() - (this.duration - this.remaining);
        
        // Démarrer l'intervalle
        if (this.interval) {
            clearInterval(this.interval);
        }
        
        this.interval = setInterval(() => this.tick(), 100);
        
        // Afficher le timer
        this.showTimer();
        
        console.log('Timer démarré:', this.duration / 1000, 'secondes');
    }

    /**
     * Tick du timer
     */
    tick() {
        if (!this.isRunning || this.isPaused) return;
        
        const elapsed = Date.now() - this.startTime;
        this.remaining = Math.max(0, this.duration - elapsed);
        
        // Mettre à jour l'affichage
        this.updateDisplay();
        
        // Callback onTick
        if (this.onTick) {
            this.onTick(this.remaining / 1000);
        }
        
        // Warning à 10 secondes
        if (this.remaining <= 10000 && this.remaining > 9900 && this.onWarning) {
            this.onWarning();
        }
        
        // Expiration
        if (this.remaining === 0) {
            this.expire();
        }
    }

    /**
     * Met à jour l'affichage
     */
    updateDisplay() {
        const seconds = Math.ceil(this.remaining / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const display = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        // Affichage texte
        if (this.displayElement) {
            const valueElement = this.displayElement.querySelector('.timer-value');
            if (valueElement) {
                valueElement.textContent = display;
            }
            
            // Classe urgence
            if (seconds <= 10) {
                this.displayElement.classList.add('timer-urgent');
            } else {
                this.displayElement.classList.remove('timer-urgent');
            }
        }
        
        // Countdown circulaire (style original)
        if (this.countdownElement) {
            // Mettre à jour la variable CSS pour l'animation
            const percentage = this.remaining / this.duration;
            this.countdownElement.style.setProperty('--t', seconds);
            this.countdownElement.style.setProperty('--q', Math.ceil(this.duration / 1000));
            
            // Classe urgence
            if (seconds <= 5) {
                this.countdownElement.classList.add('timer-critical');
            } else {
                this.countdownElement.classList.remove('timer-critical');
            }
        }
    }

    /**
     * Expire le timer
     */
    expire() {
        this.stop();
        
        console.log('Timer expiré!');
        
        if (this.onExpire) {
            this.onExpire();
        }
        
        // Animation d'expiration
        if (this.displayElement) {
            this.displayElement.classList.add('timer-expired');
            setTimeout(() => {
                this.displayElement.classList.remove('timer-expired');
            }, 2000);
        }
    }

    /**
     * Arrête le timer
     */
    stop() {
        this.isRunning = false;
        this.isPaused = false;
        
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        
        this.hideTimer();
    }

    /**
     * Met en pause le timer
     */
    pause() {
        if (!this.isRunning || this.isPaused) return;
        
        this.isPaused = true;
        
        if (this.displayElement) {
            this.displayElement.classList.add('timer-paused');
        }
        
        console.log('Timer en pause');
    }

    /**
     * Reprend le timer
     */
    resume() {
        if (!this.isRunning || !this.isPaused) return;
        
        this.isPaused = false;
        this.startTime = Date.now() - (this.duration - this.remaining);
        
        if (this.displayElement) {
            this.displayElement.classList.remove('timer-paused');
        }
        
        console.log('Timer repris');
    }

    /**
     * Réinitialise le timer
     */
    reset() {
        this.stop();
        this.remaining = this.duration;
        this.updateDisplay();
    }

    /**
     * Redémarre le timer
     */
    restart() {
        this.reset();
        this.start();
    }

    /**
     * Définit une nouvelle durée
     */
    setDuration(seconds) {
        this.duration = seconds * 1000;
        if (!this.isRunning) {
            this.remaining = this.duration;
            this.updateDisplay();
        }
    }

    /**
     * Ajoute du temps
     */
    addTime(seconds) {
        this.remaining = Math.min(this.remaining + (seconds * 1000), this.duration * 2);
        this.updateDisplay();
    }

    /**
     * Affiche le timer
     */
    showTimer() {
        if (this.countdownElement) {
            const parent = this.countdownElement.parentElement;
            if (parent) {
                parent.classList.add('showTimer');
            }
        }
        
        if (this.displayElement) {
            this.displayElement.style.display = 'block';
        }
    }

    /**
     * Cache le timer
     */
    hideTimer() {
        if (this.countdownElement) {
            const parent = this.countdownElement.parentElement;
            if (parent) {
                parent.classList.remove('showTimer');
            }
        }
        
        if (this.displayElement) {
            this.displayElement.style.display = 'none';
        }
    }

    /**
     * Obtient le temps restant
     */
    getRemaining() {
        return Math.ceil(this.remaining / 1000);
    }

    /**
     * Obtient le pourcentage restant
     */
    getPercentage() {
        return (this.remaining / this.duration) * 100;
    }

    /**
     * Vérifie si le timer est actif
     */
    isActive() {
        return this.isRunning && !this.isPaused;
    }

    /**
     * Détruit le timer
     */
    destroy() {
        this.stop();
        
        if (this.displayElement && this.displayElement.parentNode) {
            this.displayElement.parentNode.removeChild(this.displayElement);
        }
    }
}