/**
 * BOARD.JS - Gestion de l'échiquier visuel
 */

export class ChessBoard {
    constructor(elementId, config = {}) {
        this.elementId = elementId;
        this.element = document.getElementById(elementId);
        
        if (!this.element) {
            throw new Error(`Element avec l'ID ${elementId} non trouvé`);
        }
        
        // Configuration par défaut
        this.config = {
            draggable: true,
            position: 'start',
            orientation: 'white',
            showNotation: true,
            pieceTheme: 'img/chesspieces/wikipedia/{piece}.png',
            appearSpeed: 200,
            moveSpeed: 200,
            snapbackSpeed: 50,
            snapSpeed: 25,
            trashSpeed: 100,
            sparePieces: false,
            showErrors: false,
            ...config
        };
        
        // État interne
        this.board = null;
        this.currentPosition = {};
        this.draggedPiece = null;
        this.sourceSquare = null;
        this.orientation = this.config.orientation;
        this.animations = [];
        
        // Canvas pour les flèches et cercles
        this.canvas = null;
        this.ctx = null;
        
        // Initialiser
        this.init();
    }

    /**
     * Initialise l'échiquier
     */
    init() {
        // Vérifier si chessboard.js est chargé
        if (typeof window.Chessboard === 'undefined') {
            console.error('chessboard.js n\'est pas chargé');
            return;
        }
        
        // Créer l'échiquier avec chessboard.js
        this.board = window.Chessboard(this.elementId, {
            draggable: this.config.draggable,
            position: this.config.position,
            orientation: this.config.orientation,
            showNotation: this.config.showNotation,
            pieceTheme: this.config.pieceTheme,
            appearSpeed: this.config.appearSpeed,
            moveSpeed: this.config.moveSpeed,
            snapbackSpeed: this.config.snapbackSpeed,
            snapSpeed: this.config.snapSpeed,
            trashSpeed: this.config.trashSpeed,
            sparePieces: this.config.sparePieces,
            showErrors: this.config.showErrors,
            onDragStart: this.onDragStart.bind(this),
            onDrop: this.onDrop.bind(this),
            onSnapEnd: this.onSnapEnd.bind(this),
            onMoveEnd: this.onMoveEnd.bind(this),
            onMouseoutSquare: this.onMouseoutSquare.bind(this),
            onMouseoverSquare: this.onMouseoverSquare.bind(this),
            onChange: this.onChange.bind(this)
        });
        
        // Créer le canvas pour les annotations
        this.createCanvas();
        
        // Mettre à jour la position actuelle
        this.currentPosition = this.board.position();
        
        // Écouter les événements de redimensionnement
        window.addEventListener('resize', this.resize.bind(this));
    }

    /**
     * Crée le canvas pour les annotations
     */
    createCanvas() {
        // Trouver ou créer le canvas
        let canvas = document.getElementById('drawing_canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'drawing_canvas';
            canvas.style.position = 'absolute';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '100';
            
            const wrapper = document.getElementById('board_wrapper');
            if (wrapper) {
                wrapper.appendChild(canvas);
            }
        }
        
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resizeCanvas();
    }

    /**
     * Redimensionne le canvas
     */
    resizeCanvas() {
        if (!this.canvas || !this.element) return;
        
        const rect = this.element.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.canvas.style.left = rect.left + 'px';
        this.canvas.style.top = rect.top + 'px';
    }

    /**
     * Dessine une flèche
     */
    drawArrow(from, to, color = 'yellow', width = 10) {
        if (!this.ctx) return;
        
        const fromCoords = this.getSquareCoords(from);
        const toCoords = this.getSquareCoords(to);
        
        if (!fromCoords || !toCoords) return;
        
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width;
        this.ctx.lineCap = 'round';
        
        // Dessiner la ligne
        this.ctx.beginPath();
        this.ctx.moveTo(fromCoords.x, fromCoords.y);
        this.ctx.lineTo(toCoords.x, toCoords.y);
        this.ctx.stroke();
        
        // Dessiner la pointe de flèche
        const angle = Math.atan2(toCoords.y - fromCoords.y, toCoords.x - fromCoords.x);
        const headLength = width * 2;
        
        this.ctx.beginPath();
        this.ctx.moveTo(toCoords.x, toCoords.y);
        this.ctx.lineTo(
            toCoords.x - headLength * Math.cos(angle - Math.PI / 6),
            toCoords.y - headLength * Math.sin(angle - Math.PI / 6)
        );
        this.ctx.moveTo(toCoords.x, toCoords.y);
        this.ctx.lineTo(
            toCoords.x - headLength * Math.cos(angle + Math.PI / 6),
            toCoords.y - headLength * Math.sin(angle + Math.PI / 6)
        );
        this.ctx.stroke();
    }

    /**
     * Dessine un cercle
     */
    drawCircle(square, color = 'green', filled = false) {
        if (!this.ctx) return;
        
        const coords = this.getSquareCoords(square);
        if (!coords) return;
        
        const radius = this.getSquareSize() / 3;
        
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 3;
        
        this.ctx.beginPath();
        this.ctx.arc(coords.x, coords.y, radius, 0, 2 * Math.PI);
        
        if (filled) {
            this.ctx.fillStyle = color + '40'; // Ajoute de la transparence
            this.ctx.fill();
        }
        this.ctx.stroke();
    }

    /**
     * Efface le canvas
     */
    clearCanvas() {
        if (!this.ctx || !this.canvas) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Obtient les coordonnées d'une case
     */
    getSquareCoords(square) {
        const squareEl = this.element.querySelector(`.square-${square}`);
        if (!squareEl) return null;
        
        const rect = squareEl.getBoundingClientRect();
        const boardRect = this.element.getBoundingClientRect();
        
        return {
            x: rect.left - boardRect.left + rect.width / 2,
            y: rect.top - boardRect.top + rect.height / 2
        };
    }

    /**
     * Obtient la taille d'une case
     */
    getSquareSize() {
        const boardWidth = this.element.offsetWidth;
        return boardWidth / 8;
    }

    /**
     * Surligne une case
     */
    highlightSquare(square, className = 'highlight') {
        const squareEl = this.element.querySelector(`.square-${square}`);
        if (squareEl) {
            squareEl.classList.add(className);
        }
    }

    /**
     * Enlève le surlignage d'une case
     */
    unhighlightSquare(square, className = 'highlight') {
        const squareEl = this.element.querySelector(`.square-${square}`);
        if (squareEl) {
            squareEl.classList.remove(className);
        }
    }

    /**
     * Enlève tous les surlignages
     */
    clearHighlights() {
        const highlighted = this.element.querySelectorAll('.highlight');
        highlighted.forEach(el => el.classList.remove('highlight'));
    }

    /**
     * Affiche les coups légaux
     */
    showLegalMoves(square, legalMoves) {
        this.clearLegalMoves();
        
        legalMoves.forEach(move => {
            if (move.from === square) {
                const targetSquareEl = this.element.querySelector(`.square-${move.to}`);
                if (targetSquareEl) {
                    const hint = document.createElement('div');
                    hint.className = move.captured ? 'legal-capture-hint' : 'legal-move-hint';
                    targetSquareEl.appendChild(hint);
                }
            }
        });
    }

    /**
     * Cache les coups légaux
     */
    clearLegalMoves() {
        const hints = this.element.querySelectorAll('.legal-move-hint, .legal-capture-hint');
        hints.forEach(hint => hint.remove());
    }

    /**
     * Callbacks
     */
    onDragStart(source, piece, position, orientation) {
        this.sourceSquare = source;
        this.draggedPiece = piece;
        
        if (this.config.onDragStart) {
            return this.config.onDragStart(source, piece, position, orientation);
        }
        return true;
    }

    onDrop(source, target, piece, newPos, oldPos, orientation) {
        this.clearLegalMoves();
        
        if (this.config.onDrop) {
            return this.config.onDrop(source, target, piece, newPos, oldPos, orientation);
        }
    }

    onSnapEnd() {
        this.sourceSquare = null;
        this.draggedPiece = null;
        
        if (this.config.onSnapEnd) {
            this.config.onSnapEnd();
        }
    }

    onMoveEnd(oldPos, newPos) {
        if (this.config.onMoveEnd) {
            this.config.onMoveEnd(oldPos, newPos);
        }
    }

    onMouseoverSquare(square, piece) {
        if (this.config.onMouseoverSquare) {
            this.config.onMouseoverSquare(square, piece);
        }
    }

    onMouseoutSquare(square, piece) {
        if (this.config.onMouseoutSquare) {
            this.config.onMouseoutSquare(square, piece);
        }
    }

    onChange(oldPos, newPos) {
        this.currentPosition = newPos;
        
        if (this.config.onChange) {
            this.config.onChange(oldPos, newPos);
        }
    }

    /**
     * API Publique
     */
    
    // Définit la position
    position(fen) {
        if (fen === undefined) {
            return this.board.position();
        }
        return this.board.position(fen);
    }

    // Démarre une nouvelle partie
    start() {
        return this.board.start();
    }

    // Efface l'échiquier
    clear() {
        return this.board.clear();
    }

    // Déplace une pièce
    move(...args) {
        return this.board.move(...args);
    }

    // Obtient l'orientation
    getOrientation() {
        return this.orientation;
    }

    // Change l'orientation
    flip() {
        this.orientation = this.orientation === 'white' ? 'black' : 'white';
        return this.board.flip();
    }

    // Redimensionne l'échiquier
    resize() {
        this.board.resize();
        this.resizeCanvas();
    }

    // Détruit l'échiquier
    destroy() {
        window.removeEventListener('resize', this.resize);
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.board.destroy();
    }

    /**
     * Animation de pièce fantôme
     */
    animatePhantom(from, to, piece) {
        const fromCoords = this.getSquareCoords(from);
        const toCoords = this.getSquareCoords(to);
        
        if (!fromCoords || !toCoords) return;
        
        const phantom = document.createElement('div');
        phantom.className = 'phantom-piece';
        phantom.style.position = 'absolute';
        phantom.style.left = fromCoords.x + 'px';
        phantom.style.top = fromCoords.y + 'px';
        phantom.style.width = this.getSquareSize() + 'px';
        phantom.style.height = this.getSquareSize() + 'px';
        phantom.style.backgroundImage = `url(${this.config.pieceTheme.replace('{piece}', piece)})`;
        phantom.style.backgroundSize = 'contain';
        phantom.style.zIndex = '1000';
        phantom.style.transition = 'all 0.5s ease-out';
        phantom.style.opacity = '0.8';
        
        this.element.appendChild(phantom);
        
        // Déclencher l'animation
        setTimeout(() => {
            phantom.style.left = toCoords.x + 'px';
            phantom.style.top = toCoords.y + 'px';
            phantom.style.opacity = '0';
        }, 10);
        
        // Supprimer après l'animation
        setTimeout(() => {
            phantom.remove();
        }, 510);
    }

    /**
     * Met à jour la configuration
     */
    setConfig(key, value) {
        this.config[key] = value;
        
        // Certaines configs nécessitent une reconstruction
        if (['draggable', 'showNotation', 'sparePieces'].includes(key)) {
            this.rebuild();
        }
    }

    /**
     * Reconstruit l'échiquier
     */
    rebuild() {
        const position = this.board.position();
        this.board.destroy();
        this.init();
        this.board.position(position);
    }
}