/**
 * DOM.JS - Gestion du DOM et de l'interface
 */

export class DOMManager {
    constructor() {
        this.elements = {};
        this.initialized = false;
    }

    /**
     * Initialise le gestionnaire DOM
     */
    async initialize() {
        this.cacheElements();
        this.createMissingElements();
        this.initialized = true;
    }

    /**
     * Cache les éléments importants
     */
    cacheElements() {
        this.elements = {
            // Échiquier
            board: document.getElementById('myBoard'),
            boardWrapper: document.getElementById('board_wrapper'),
            
            // Canvas
            primaryCanvas: document.getElementById('primary_canvas'),
            drawingCanvas: document.getElementById('drawing_canvas'),
            
            // Contrôles
            startBtn: document.getElementById('startBtn'),
            pauseBtn: document.getElementById('pauseBtn'),
            resetBtn: document.getElementById('resetBtn'),
            configBtn: document.getElementById('openFormButton'),
            
            // Formulaires
            configForm: document.getElementById('configForm'),
            problemInfo: document.getElementById('probleminfo'),
            
            // Affichage
            moveHistory: document.getElementById('moveHistory'),
            fenDisplay: document.getElementById('fenDisplay'),
            pgnDisplay: document.getElementById('pgnDisplay'),
            
            // Timer
            countdown: document.querySelector('.countdown'),
            timerDisplay: document.getElementById('timerDisplay'),
            
            // Votes
            votingContainer: document.getElementById('votingContainer'),
            votingOptions: document.getElementById('votingOptions'),
            totalVotes: document.getElementById('totalVotes'),
            
            // Graphique
            pollChart: document.getElementById('pollChart'),
            
            // Phantom
            phantomContainer: document.querySelector('.phantomContainer'),
            
            // Info
            gameInfo: document.getElementById('gameInfo'),
            playerInfo: document.getElementById('playerInfo'),
            statusDisplay: document.getElementById('statusDisplay')
        };
    }

    /**
     * Crée les éléments manquants
     */
    createMissingElements() {
        // Créer le conteneur phantom s'il n'existe pas
        if (!this.elements.phantomContainer) {
            const phantom = document.createElement('div');
            phantom.className = 'phantomContainer';
            document.body.appendChild(phantom);
            this.elements.phantomContainer = phantom;
        }

        // Créer la zone d'historique si elle n'existe pas
        if (!this.elements.moveHistory) {
            const history = document.createElement('div');
            history.id = 'moveHistory';
            history.className = 'move-history';
            
            const sidebar = document.querySelector('.game-sidebar');
            if (sidebar) {
                sidebar.appendChild(history);
            }
            
            this.elements.moveHistory = history;
        }

        // Créer les boutons de contrôle s'ils n'existent pas
        if (!this.elements.startBtn) {
            this.createControlButtons();
        }
    }

    /**
     * Crée les boutons de contrôle
     */
    createControlButtons() {
        const controlPanel = document.createElement('div');
        controlPanel.className = 'control-panel';
        controlPanel.innerHTML = `
            <div class="control-panel-header">
                <h3 class="control-panel-title">Contrôles</h3>
            </div>
            <div class="control-panel-body">
                <button id="startBtn" class="btn btn-success">
                    <i class="fas fa-play"></i> Démarrer
                </button>
                <button id="pauseBtn" class="btn btn-warning">
                    <i class="fas fa-pause"></i> Pause
                </button>
                <button id="resetBtn" class="btn btn-danger">
                    <i class="fas fa-redo"></i> Réinitialiser
                </button>
            </div>
        `;

        const gameArea = document.querySelector('.game-main');
        if (gameArea) {
            gameArea.appendChild(controlPanel);
        }

        // Recacher les éléments
        this.elements.startBtn = document.getElementById('startBtn');
        this.elements.pauseBtn = document.getElementById('pauseBtn');
        this.elements.resetBtn = document.getElementById('resetBtn');
    }

    /**
     * Met à jour l'état du jeu
     */
    updateGameState(state) {
        // Boutons
        if (this.elements.startBtn) {
            this.elements.startBtn.disabled = state.isPlaying && !state.isPaused;
            this.elements.startBtn.innerHTML = state.isPlaying 
                ? '<i class="fas fa-play"></i> Reprendre' 
                : '<i class="fas fa-play"></i> Démarrer';
        }

        if (this.elements.pauseBtn) {
            this.elements.pauseBtn.disabled = !state.isPlaying;
            this.elements.pauseBtn.innerHTML = state.isPaused 
                ? '<i class="fas fa-play"></i> Reprendre' 
                : '<i class="fas fa-pause"></i> Pause';
        }

        // Indicateur de tour
        document.body.dataset.turn = state.currentTurn;

        // Classe d'état
        document.body.classList.toggle('game-playing', state.isPlaying);
        document.body.classList.toggle('game-paused', state.isPaused);
        document.body.classList.toggle('voting-active', state.votingActive);
    }

    /**
     * Ajoute un coup à l'historique
     */
    addMoveToHistory(move) {
        if (!this.elements.moveHistory) return;

        const moveElement = document.createElement('div');
        moveElement.className = 'history-move';
        
        // Numéro du coup pour les blancs
        if (move.color === 'w') {
            const moveNumber = document.createElement('span');
            moveNumber.className = 'move-number';
            moveNumber.textContent = `${Math.ceil((this.elements.moveHistory.children.length + 1) / 2)}.`;
            moveElement.appendChild(moveNumber);
        }

        const moveNotation = document.createElement('span');
        moveNotation.className = `move-notation ${move.color === 'w' ? 'white-move' : 'black-move'}`;
        moveNotation.textContent = move.san;
        moveElement.appendChild(moveNotation);

        this.elements.moveHistory.appendChild(moveElement);
        
        // Scroll vers le bas
        this.elements.moveHistory.scrollTop = this.elements.moveHistory.scrollHeight;
    }

    /**
     * Efface l'historique
     */
    clearHistory() {
        if (this.elements.moveHistory) {
            this.elements.moveHistory.innerHTML = '';
        }
    }

    /**
     * Met à jour l'affichage FEN
     */
    updateFEN(fen) {
        if (this.elements.fenDisplay) {
            this.elements.fenDisplay.textContent = fen;
        }
    }

    /**
     * Met à jour l'affichage PGN
     */
    updatePGN(pgn) {
        if (this.elements.pgnDisplay) {
            this.elements.pgnDisplay.textContent = pgn;
        }
    }

    /**
     * Affiche un phantom
     */
    showPhantom(text, options = {}) {
        if (!this.elements.phantomContainer) return;

        const phantom = document.createElement('div');
        phantom.className = `phantom ${options.className || ''}`;
        phantom.innerHTML = `
            <div class="phantom-text ${options.type || ''}">${text}</div>
        `;

        // Position
        if (options.position) {
            phantom.style.left = options.position.x + 'px';
            phantom.style.top = options.position.y + 'px';
        } else {
            // Position aléatoire
            phantom.style.left = Math.random() * (window.innerWidth - 200) + 'px';
            phantom.style.top = Math.random() * (window.innerHeight - 100) + 'px';
        }

        this.elements.phantomContainer.appendChild(phantom);

        // Animation de sortie
        setTimeout(() => {
            phantom.classList.add('phantom-fade-out');
        }, options.duration || 3000);

        // Suppression
        setTimeout(() => {
            phantom.remove();
        }, (options.duration || 3000) + 1000);
    }

    /**
     * Met à jour le statut
     */
    updateStatus(message, type = 'info') {
        if (this.elements.statusDisplay) {
            this.elements.statusDisplay.textContent = message;
            this.elements.statusDisplay.className = `status status-${type}`;
        }
    }

    /**
     * Affiche/cache un élément
     */
    show(elementId) {
        const element = this.elements[elementId] || document.getElementById(elementId);
        if (element) {
            element.style.display = 'block';
            element.classList.add('active');
        }
    }

    hide(elementId) {
        const element = this.elements[elementId] || document.getElementById(elementId);
        if (element) {
            element.style.display = 'none';
            element.classList.remove('active');
        }
    }

    /**
     * Toggle un élément
     */
    toggle(elementId) {
        const element = this.elements[elementId] || document.getElementById(elementId);
        if (element) {
            if (element.style.display === 'none' || !element.classList.contains('active')) {
                this.show(elementId);
            } else {
                this.hide(elementId);
            }
        }
    }

    /**
     * Obtient un élément
     */
    get(elementId) {
        return this.elements[elementId] || document.getElementById(elementId);
    }

    /**
     * Définit le contenu HTML
     */
    setHTML(elementId, html) {
        const element = this.get(elementId);
        if (element) {
            element.innerHTML = html;
        }
    }

    /**
     * Définit le texte
     */
    setText(elementId, text) {
        const element = this.get(elementId);
        if (element) {
            element.textContent = text;
        }
    }

    /**
     * Ajoute une classe
     */
    addClass(elementId, className) {
        const element = this.get(elementId);
        if (element) {
            element.classList.add(className);
        }
    }

    /**
     * Retire une classe
     */
    removeClass(elementId, className) {
        const element = this.get(elementId);
        if (element) {
            element.classList.remove(className);
        }
    }

    /**
     * Toggle une classe
     */
    toggleClass(elementId, className) {
        const element = this.get(elementId);
        if (element) {
            element.classList.toggle(className);
        }
    }
}