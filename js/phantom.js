/**
 * 🎯 PHANTOM CHESS - VERSION AVEC FILE D'ATTENTE ET BLOCAGE UI
 * 
 * Nouvelles fonctionnalités :
 * - File d'attente des coups (moveQueue)
 * - Blocage de l'UI pendant l'exécution des mouvements
 * - Écoute du BLE_MOVE_DONE pour synchroniser
 */

class PhantomChessboard {
    constructor() {
        // UUIDs Bluetooth
        this.SERVICE_UUID = 'fd31a840-22e7-11eb-adc1-0242ac120002';
        this.UUID_GAME = 'cc68a66e-3bfa-4614-a77f-f46954a4c103';
        this.UUID_MECHANISM_SPEED = 'acb646cc-92ca-11ee-b9d1-0242ac120002';
        this.UUID_SOUND_SETTINGS = 'acb64a32-92ca-11ee-b9d1-0242ac120002';
        this.UUID_BATTERY = '7b204548-40c4-11eb-adc1-0242ac120002';
        this.UUID_SETSTATE = 'acb6543c-92ca-11ee-b9d1-0242ac120002';
        this.UUID_JUMP_TO_CENTER = '5e316147-4550-4cf3-8e2b-edc098312a43';
        this.UUID_VERSION = '392d9e66-937a-11ee-b9d1-0242ac120002';
        
        // OpCodes
        this.OP_CODES = {
            GAME_START: 0,
            GAME_END: 1,
            MOVEMENT: 2,
            MOVEMENT_VERIFY: 3,
            VOICE_COMMAND: 4,
            TAKE_BACK: 5,
            BOARD_STATE: 6,
            CALIBRATION: 7,
            ERROR_MSG: 8,
            CHECK_SOUND: 9,
            SIDE: 10,
            GAME_ASSISTANCE: 11,
            BLE_MOVE_DONE: 12,
            SNAPTOCENTERCOM: 13,
            RESET_DETECTION: 14
        };
        
        this.OP_CODE_NAMES = {
            0: 'GAME_START', 1: 'GAME_END', 2: 'MOVEMENT', 3: 'MOVEMENT_VERIFY',
            4: 'VOICE_COMMAND', 5: 'TAKE_BACK', 6: 'BOARD_STATE', 7: 'CALIBRATION',
            8: 'ERROR_MSG', 9: 'CHECK_SOUND', 10: 'SIDE', 11: 'GAME_ASSISTANCE',
            12: 'BLE_MOVE_DONE', 13: 'SNAPTOCENTERCOM', 14: 'RESET_DETECTION'
        };
        
        // État
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristics = {};
        this.isConnected = false;
        this.enabled = false;
        this.lastFenSent = null;
        this.gameInitialized = false;
        
        // 🆕 File d'attente et état de mouvement
        this.moveQueue = [];
        this.isMoving = false;
        this.moveDoneResolver = null;
        this.moveTimeout = null;
        this.MOVE_TIMEOUT_MS = 30000; // 30 secondes max par mouvement
        this.savedTimerState = null; // Pour la pause du timer de vote
        
        // 🆕 Webcam
        this.webcamStream = null;
        this.webcamOpacity = 0.5;
        
        console.log('🎯 PhantomChessboard initialisé (avec file d\'attente)');
    }
    
    // ========== GESTION DE L'OVERLAY UI ==========
    
    
    /**
     * 🆕 Met en pause le timer de vote (compatible avec chessVoterApp.js)
     */
    pauseVoteTimer() {
        // Vérifier si intervalId existe (variable globale de chessVoterApp.js)
        if (typeof intervalId !== 'undefined' && intervalId !== null) {
            this.savedTimerState = {
                intervalId: intervalId,
                voterTimer: typeof voterTimer !== 'undefined' ? voterTimer : 0,
                wasActive: true
            };
            clearInterval(intervalId);
            intervalId = null;
            this.log(`⏸️ Timer en pause (${this.savedTimerState.voterTimer}s restantes)`, 'info');
        } else {
            // Pas de timer actif, on note qu'il ne faudra pas en relancer un
            this.savedTimerState = { wasActive: false };
            this.log('⏸️ Pas de timer actif à mettre en pause', 'info');
        }
    }
    
    /**
     * 🆕 Reprend le timer de vote (seulement s'il était actif avant)
     */
    resumeVoteTimer() {
        // Ne reprendre que si le timer était actif avant la pause
        if (this.savedTimerState && this.savedTimerState.wasActive && this.savedTimerState.voterTimer > 0) {
            // Restaurer voterTimer
            if (typeof voterTimer !== 'undefined') {
                voterTimer = this.savedTimerState.voterTimer;
            }
            
            // Relancer l'interval
            if (typeof bip === 'function') {
                intervalId = setInterval(function() {
                    bip(true);
                }, 1000);
                this.log(`▶️ Timer repris: ${this.savedTimerState.voterTimer}s restantes`, 'info');
            }
        }
        this.savedTimerState = null;
    }
    
    /**
     * 🆕 Synchronise la position actuelle au Phantom (appelé à la connexion)
     */
    syncCurrentPosition() {
        // La page affichée (Tournoi, Live) peut suivre sa propre partie : c'est elle qui fait foi
        const route = (window.location.hash.split('/')[1] || '').split('?')[0];
        const provided = window.phantomPositionProviders?.[route]?.();
        if (typeof provided === 'function') {
            // La page gère elle-même la mise en place (ex. Tournoi : choix position actuelle / rejouer)
            provided();
            return;
        }
        if (provided) {
            this.log('📋 Partie suivie détectée, synchronisation...', 'info');
            this.syncPosition(provided);
            return;
        }
        if (typeof chess === 'undefined') {
            this.log('⚠️ Pas de partie en cours', 'info');
            return;
        }
        
        const currentFen = chess.fen();
        const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
        
        // Vérifier si on est à la position initiale
        if (currentFen.startsWith(initialFen)) {
            this.log('📋 Position initiale, synchronisation légère', 'info');
        } else {
            this.log('📋 Partie en cours détectée, synchronisation...', 'info');
        }
        
        // Lancer la synchronisation (le timer sera mis en pause automatiquement par showBlockingOverlay)
        this.syncPosition(currentFen);
    }
    
    // ========== GESTION DE LA FILE D'ATTENTE ==========
    
    /**
     * Ajoute un FEN à la file d'attente et lance le traitement
     */
    queuePosition(fen) {
        // Recalibration en cours : on garde la dernière position pour après
        if (this.recalibrating) {
            this.pendingFen = fen;
            return;
        }
        // 🆕 Détecter si c'est un reset vers la position initiale
        const initialFenStart = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
        const fenPosition = fen.split(' ')[0];
        
        if (fenPosition === initialFenStart && this.lastFenSent !== null) {
            this.log('🔄 Détection reset partie - réinitialisation', 'info');
            this.lastFenSent = null; // Permettre le nouveau GAME_START
            this.moveQueue = []; // Vider la file en cours
        }
        
        // Éviter les doublons consécutifs
        const lastInQueue = this.moveQueue[this.moveQueue.length - 1];
        if (lastInQueue === fen || (this.moveQueue.length === 0 && this.lastFenSent === fen)) {
            console.log('⏭️ FEN identique, ignoré');
            return;
        }
        
        this.moveQueue.push(fen);
        this.log(`📥 FEN ajouté à la file (${this.moveQueue.length} en attente)`, 'info');
        
        // Lancer le traitement si pas déjà en cours
        if (!this.isMoving) {
            this.processQueue();
        } else {
            // Mettre à jour l'overlay avec le nombre en attente
            this.showBlockingOverlay?.('Déplacement en cours...', this.moveQueue.length);
        }
    }
    
    /**
     * Traite la file d'attente coup par coup
     */
    async processQueue() {
        if (this.isMoving || this.moveQueue.length === 0) {
            return;
        }
        
        this.isMoving = true;
        const fen = this.moveQueue.shift();
        const remaining = this.moveQueue.length;
        
        // Émettre l'événement pour mettre le timer en pause (seulement au premier coup)
        window.dispatchEvent(new CustomEvent('phantomMoveStart'));
        
        this.log(`🎯 Traitement du coup (${remaining} restants)`, 'info');
        
        try {
            // Exécuter le mouvement et attendre BLE_MOVE_DONE
            await this.syncPositionAndWait(fen);
            this.log('✅ Mouvement terminé', 'success');
        } catch (error) {
            this.log(`❌ Erreur mouvement: ${error.message}`, 'error');
        }
        
        // Petit délai entre les mouvements pour laisser le board se stabiliser
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Recalibration lancée pendant ce coup : elle reprend la main
        if (this.recalibrating) {
            this.isMoving = false;
            return;
        }

        // Si la queue est vide, le Phantom a terminé tous ses mouvements
        if (this.moveQueue.length === 0) {
            this.isMoving = false;
            // Émettre l'événement APRÈS que BLE_MOVE_DONE a été reçu
            window.dispatchEvent(new CustomEvent('phantomMoveComplete'));
            return;
        }
        
        // Traiter le prochain coup (sans réémettre phantomMoveStart)
        this.isMoving = false;
        this.processQueue();
    }
    
    /**
     * Synchronise la position ET attend le BLE_MOVE_DONE
     */
    async syncPositionAndWait(fen) {
        return new Promise(async (resolve, reject) => {
            // Créer une promesse qui sera résolue par handleGameNotification
            this.moveDoneResolver = resolve;
            
            // Timeout de sécurité
            this.moveTimeout = setTimeout(() => {
                this.log('⚠️ Timeout mouvement (30s)', 'warn');
                this.moveDoneResolver = null;
                resolve(); // On continue quand même
            }, this.MOVE_TIMEOUT_MS);
            
            try {
                // Convertir FEN en matrice 10x10
                const matrix = this.fenToMatrix(fen);
                
                // Debug: afficher la matrice
                console.log('📋 Matrice générée:\n' + this.formatMatrix(matrix));
                
                // Déterminer la couleur qui joue (inversée pour le Phantom)
                const fenParts = fen.split(' ');
                const colorToPlay = (fenParts.length > 1 && fenParts[1] === 'b') ? 'W' : 'B';
                
                // Envoyer via GAME_START avec la matrice
                await this.sendCommand(this.OP_CODES.GAME_START, matrix + ',' + colorToPlay);
                
                // Attendre un peu puis envoyer SIDE
                await new Promise(r => setTimeout(r, 300));
                await this.sendCommand(this.OP_CODES.SIDE, '2');
                
                this.lastFenSent = fen;
                
                // Note: La promesse sera résolue par handleGameNotification quand BLE_MOVE_DONE arrive
                // ou par le timeout si ça prend trop longtemps
                
            } catch (error) {
                clearTimeout(this.moveTimeout);
                this.moveDoneResolver = null;
                reject(error);
            }
        });
    }
    
    // ========== CONVERSION FEN → MATRICE 10x10 ==========
    
    fenToMatrix(fen) {
        const position = fen.split(' ')[0];
        const rows = position.split('/');
        
        const board = [];
        for (const row of rows) {
            let boardRow = '';
            for (const char of row) {
                if (/\d/.test(char)) {
                    boardRow += '.'.repeat(parseInt(char));
                } else {
                    boardRow += char;
                }
            }
            board.push(boardRow.padEnd(8, '.'));
        }
        
        // Rotation 90° horaire pour le Phantom
        // Chaque colonne du FEN devient une ligne de la matrice
        // L'ordre dans chaque ligne va du rang 8 au rang 1
        const rotated = [];
        for (let col = 0; col < 8; col++) {
            let newRow = '';
            for (let row = 0; row < 8; row++) {  // De 0 à 7 (rang 8 à rang 1)
                newRow += board[row][col];
            }
            rotated.push(newRow);
        }
        
        // Construire la matrice 10x10
        let matrix = '..........'; // Première ligne (cimetière)
        for (const row of rotated) {
            matrix += '.' + row + '.';
        }
        matrix += '..........'; // Dernière ligne (cimetière)
        
        return matrix;
    }
    
    formatMatrix(matrix) {
        let result = '  0 1 2 3 4 5 6 7 8 9\n';
        for (let i = 0; i < 10; i++) {
            result += `${i} ${matrix.slice(i * 10, (i + 1) * 10).split('').join(' ')}\n`;
        }
        return result;
    }
    
    // ========== CONNEXION BLUETOOTH ==========
    
    async connect() {
        try {
            this.log('🔍 Recherche Phantom...', 'info');
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Phantom' }],
                optionalServices: [this.SERVICE_UUID]
            });
            
            this.log(`📱 Appareil: ${this.device.name}`, 'info');
            
            this.device.addEventListener('gattserverdisconnected', () => {
                this.log('🔌 Déconnecté', 'warn');
                this.isConnected = false;
                this.moveQueue = [];
                this.isMoving = false;
                this.updateUI(false);
            });
            
            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);
            
            // Caractéristique de jeu
            this.characteristics.game = await this.service.getCharacteristic(this.UUID_GAME);
            await this.characteristics.game.startNotifications();
            this.characteristics.game.addEventListener('characteristicvaluechanged', 
                (e) => this.handleGameNotification(e));
            
            // Caractéristiques optionnelles
            try {
                this.characteristics.speed = await this.service.getCharacteristic(this.UUID_MECHANISM_SPEED);
                // Lire la vitesse actuelle
                const speedValue = await this.characteristics.speed.readValue();
                const currentSpeed = parseInt(new TextDecoder().decode(speedValue));
                this.log(`⚡ Vitesse actuelle: ${currentSpeed}/5`, 'info');
                
                // Mettre à jour le slider si présent
                const speedSlider = document.getElementById('phantom-speed');
                const speedValueEl = document.getElementById('phantom-speed-value');
                if (speedSlider) speedSlider.value = currentSpeed;
                if (speedValueEl) speedValueEl.textContent = currentSpeed;
            } catch (e) { 
                this.log('⚠️ Vitesse non disponible', 'warn');
            }
            
            try {
                this.characteristics.sound = await this.service.getCharacteristic(this.UUID_SOUND_SETTINGS);
            } catch (e) { }
            
            try {
                this.characteristics.battery = await this.service.getCharacteristic(this.UUID_BATTERY);
                const batteryValue = await this.characteristics.battery.readValue();
                const batteryStr = new TextDecoder().decode(batteryValue);
                this.log(`🔋 Batterie: ${batteryStr}%`, 'info');
            } catch (e) { }
            
            // Diagnostic : version, réglage « jump to center » et état de l'échiquier
            const readText = async (uuid, key) => {
                const c = await this.service.getCharacteristic(uuid);
                this.characteristics[key] = c;
                return new TextDecoder().decode(await c.readValue());
            };
            try { this.version = await readText(this.UUID_VERSION, 'version'); this.log(`ℹ️ Version: ${this.version}`, 'info'); } catch (e) { }
            try { this.jumpToCenter = await readText(this.UUID_JUMP_TO_CENTER, 'jump'); this.log(`ℹ️ Jump to center: ${this.jumpToCenter}`, 'info'); } catch (e) { }
            try {
                this.boardState = await readText(this.UUID_SETSTATE, 'state');
                this.log(`📊 État: ${this.boardState}`, 'info');
                await this.characteristics.state.startNotifications();
                this.characteristics.state.addEventListener('characteristicvaluechanged', (e) => {
                    const state = new TextDecoder().decode(e.target.value);
                    if (state === this.boardState) return;
                    this.boardState = state;
                    this.log(`📊 État: ${state}`, 'received');
                });
            } catch (e) { }

            this.isConnected = true;
            this.enabled = true;
            this.log('✅ Connecté!', 'success');
            this.updateUI(true);
            
            // 🆕 Sauvegarder l'état en localStorage
            this.saveState();
            
            // 🆕 Lancer la webcam
            this.startWebcam();
            
            // 🆕 Synchroniser le FEN en cours si une partie est active
            this.syncCurrentPosition();
            
            return true;
        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            return false;
        }
    }
    
    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
        this.isConnected = false;
        this.moveQueue = [];
        this.isMoving = false;
        
        // 🆕 Effacer l'état sauvegardé
        this.clearState();
        
        // 🆕 Arrêter la webcam
        this.stopWebcam();
        
        this.updateUI(false);
    }
    
    // ========== NOTIFICATIONS ==========
    
    handleGameNotification(event) {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const bytes = new Uint8Array(value.buffer);
        
        try {
            const strValue = decoder.decode(value);
            const opCode = bytes[0];
            const opName = this.OP_CODE_NAMES[opCode] || `0x${opCode.toString(16)}`;
            const dataStr = strValue.substring(1);
            
            // Erreur de l'échiquier : texte complet (une fois par message, puis un compteur)
            if (opCode === this.OP_CODES.ERROR_MSG) {
                if (dataStr === this.lastError) {
                    this.lastErrorCount = (this.lastErrorCount || 1) + 1;
                    if (this.lastErrorCount % 20 === 0) this.log(`⚠️ ERROR_MSG identique ×${this.lastErrorCount}`, 'warn');
                    return;
                }
                this.lastError = dataStr;
                this.lastErrorCount = 1;
                this.log(`⚠️ [ERROR_MSG] ${dataStr}`, 'warn');
                window.dispatchEvent(new CustomEvent('phantomError', { detail: dataStr }));
                return;
            }

            // Log
            if (dataStr.trim() && dataStr.length < 100) {
                this.log(`📥 [${opName}] "${dataStr}"`, 'received');
            } else if (dataStr.trim()) {
                this.log(`📥 [${opName}] (${dataStr.length} chars)`, 'received');
            } else {
                this.log(`📥 [${opName}]`, 'received');
            }
            
            if (this.calibrationResolver && (opCode === this.OP_CODES.CALIBRATION || opCode === this.OP_CODES.BLE_MOVE_DONE)) {
                const done = this.calibrationResolver;
                this.calibrationResolver = null;
                done();
            }

            // 🆕 BLE_MOVE_DONE - Résoudre la promesse en attente
            if (opCode === this.OP_CODES.BLE_MOVE_DONE) {
                this.log(`🎯 MOVE_DONE reçu!`, 'success');
                
                if (this.moveTimeout) {
                    clearTimeout(this.moveTimeout);
                    this.moveTimeout = null;
                }
                
                if (this.moveDoneResolver) {
                    const resolver = this.moveDoneResolver;
                    this.moveDoneResolver = null;
                    resolver();
                }
            }
            
            // MOVEMENT_VERIFY - répondre automatiquement
            if (opCode === this.OP_CODES.MOVEMENT_VERIFY) {
                this.log(`✅ Auto-validation du mouvement`, 'info');
                this.sendCommand(this.OP_CODES.MOVEMENT_VERIFY, '1');
            }
            
        } catch (error) {
            console.error('Erreur notification:', error);
        }
    }
    
    // ========== ENVOI DE COMMANDES ==========
    
    async sendCommand(opCode, data = '') {
        if (!this.characteristics.game) {
            this.log('⚠️ Non connecté', 'warn');
            return false;
        }
        
        try {
            const message = String.fromCharCode(opCode) + data;
            const encoded = new TextEncoder().encode(message);
            await this.characteristics.game.writeValue(encoded);
            
            const opName = this.OP_CODE_NAMES[opCode] || `0x${opCode.toString(16)}`;
            if (data.length < 50) {
                this.log(`📤 [${opName}] "${data}"`, 'sent');
            } else {
                this.log(`📤 [${opName}] (${data.length} chars)`, 'sent');
            }
            return true;
        } catch (error) {
            this.log(`❌ Erreur envoi: ${error.message}`, 'error');
            return false;
        }
    }
    
    // ========== COMMANDES DE JEU ==========
    
    async sendGameStart() {
        const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
        const matrix = this.fenToMatrix(initialFen);
        return await this.sendCommand(this.OP_CODES.GAME_START, matrix + ',W');
    }
    
    async sendGameEnd() {
        this.gameInitialized = false;
        this.moveQueue = [];
        this.isMoving = false;
        this.lastFenSent = null; // 🆕 Réinitialiser pour permettre un nouveau GAME_START propre
        return await this.sendCommand(this.OP_CODES.GAME_END);
    }
    
    async calibrate() {
        return await this.sendCommand(this.OP_CODES.CALIBRATION);
    }

    /** Recentre toutes les pièces sur leurs cases (SNAPTOCENTERCOM) */
    async snapToCenter() {
        this.lastError = null;
        return await this.sendCommand(this.OP_CODES.SNAPTOCENTERCOM);
    }

    /**
     * Recale la mécanique quand le chariot vise à côté des cases.
     * Pendant une partie l'échiquier ne tient pas compte de CALIBRATION seule :
     * on abandonne les coups en attente, on termine la partie, on calibre,
     * puis on repose la position (GAME_START complet). Les positions reçues
     * entre-temps (partie suivie) sont gardées : seule la dernière est rejouée.
     * @param {() => string|null} getFen position à reposer ensuite (null : rien)
     */
    async recalibrate(getFen = () => null) {
        if (!this.isConnected || this.recalibrating) return false;
        this.recalibrating = true;
        this.pendingFen = null;
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        window.dispatchEvent(new CustomEvent('phantomMoveStart'));   // le minuteur de vote attend
        this.showBlockingOverlay?.('Calibration du Phantom...', 0);
        try {
            // Abandonner le mouvement en cours et la file
            this.moveQueue = [];
            if (this.moveTimeout) { clearTimeout(this.moveTimeout); this.moveTimeout = null; }
            const pending = this.moveDoneResolver;
            this.moveDoneResolver = null;
            pending?.();

            this.log('🛠️ Recalibration : fin de partie, calibration, remise en place', 'info');
            await this.sendGameEnd();
            await sleep(1500);
            // Fin de calibration : retour de l'échiquier (CALIBRATION ou MOVE_DONE), sinon 20 s
            const finished = new Promise(resolve => {
                this.calibrationResolver = resolve;
                setTimeout(resolve, 20000);
            });
            await this.calibrate();
            await finished;
            this.calibrationResolver = null;
            await sleep(1000);
        } finally {
            this.recalibrating = false;
            this.isMoving = false;
        }
        const fen = this.pendingFen || getFen();
        this.pendingFen = null;
        this.lastFenSent = null;   // forcer un GAME_START complet
        if (fen) {
            this.queuePosition(fen);
        } else {
            this.hideBlockingOverlay?.();
            window.dispatchEvent(new CustomEvent('phantomMoveComplete'));
        }
        return true;
    }
    
    // ========== MÉTHODE PRINCIPALE DE SYNC ==========
    
    /**
     * 🎯 Méthode appelée par l'extérieur pour synchroniser une position
     * Ajoute à la file d'attente au lieu d'exécuter directement
     */
    async syncPosition(fen) {
        if (!this.enabled || !this.isConnected) {
            console.log('⚠️ Phantom non actif');
            return false;
        }
        
        this.queuePosition(fen);
        return true;
    }
    
    // ========== PARAMÈTRES ==========
    
    async setSpeed(speed) {
        if (!this.characteristics.speed) {
            this.log('⚠️ Vitesse indisponible', 'warn');
            return false;
        }
        
        try {
            const value = Math.max(0, Math.min(100, speed));
            const encoded = new TextEncoder().encode(value.toString());
            await this.characteristics.speed.writeValue(encoded);
            this.log(`⚡ Vitesse: ${value}%`, 'info');
            return true;
        } catch (error) {
            this.log(`❌ Erreur vitesse: ${error.message}`, 'error');
            return false;
        }
    }
    
    async setVolume(volume) {
        if (!this.characteristics.sound) {
            this.log('⚠️ Volume indisponible', 'warn');
            return false;
        }
        
        try {
            const value = Math.max(0, Math.min(100, volume));
            const soundSettings = `${value},1`;
            const encoded = new TextEncoder().encode(soundSettings);
            await this.characteristics.sound.writeValue(encoded);
            this.log(`🔊 Volume: ${value}%`, 'info');
            return true;
        } catch (error) {
            this.log(`❌ Erreur volume: ${error.message}`, 'error');
            return false;
        }
    }
    
    // ========== UTILITAIRES ==========
    
    log(message, type = 'info') {
        const prefix = '🎯 [Phantom]';
        const fullMessage = `${prefix} ${message}`;
        
        switch (type) {
            case 'error':
                console.error(fullMessage);
                break;
            case 'warn':
                console.warn(fullMessage);
                break;
            case 'success':
                console.log(`%c${fullMessage}`, 'color: #4CAF50');
                break;
            case 'sent':
                console.log(`%c${fullMessage}`, 'color: #2196F3');
                break;
            case 'received':
                console.log(`%c${fullMessage}`, 'color: #FF9800');
                break;
            default:
                console.log(fullMessage);
        }
        
        // Mettre à jour le log UI si présent
        const logElement = document.getElementById('phantom-log');
        if (logElement) {
            const entry = document.createElement('div');
            entry.className = `log-entry log-${type}`;
            entry.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
            logElement.appendChild(entry);
            logElement.scrollTop = logElement.scrollHeight;
        }
    }
    
    // ========== PERSISTANCE ==========
    
    /**
     * 🆕 Sauvegarde l'état en localStorage
     */
    saveState() {
        try {
            const state = {
                wasConnected: true,
                deviceName: this.device?.name || 'Phantom',
                timestamp: Date.now()
            };
            localStorage.setItem('phantomState', JSON.stringify(state));
            this.log('💾 État sauvegardé', 'info');
        } catch (e) {
            console.warn('Impossible de sauvegarder l\'état Phantom:', e);
        }
    }
    
    /**
     * 🆕 Efface l'état sauvegardé
     */
    clearState() {
        try {
            localStorage.removeItem('phantomState');
            this.log('🗑️ État effacé', 'info');
        } catch (e) {
            console.warn('Impossible d\'effacer l\'état Phantom:', e);
        }
    }
    
    /**
     * 🆕 Vérifie si une reconnexion est suggérée
     */
    checkPreviousConnection() {
        try {
            const stateStr = localStorage.getItem('phantomState');
            if (!stateStr) return null;
            
            const state = JSON.parse(stateStr);
            
            // Vérifier que l'état n'est pas trop vieux (24h max)
            const maxAge = 24 * 60 * 60 * 1000;
            if (Date.now() - state.timestamp > maxAge) {
                this.clearState();
                return null;
            }
            
            return state;
        } catch (e) {
            return null;
        }
    }
    
    /**
     * 🆕 Affiche le prompt de reconnexion si nécessaire
     */
    showReconnectPrompt() {
        const previousState = this.checkPreviousConnection();
        if (!previousState) return;
        
        // Vérifier si le prompt existe déjà
        if (document.getElementById('phantom-reconnect-prompt')) return;
        
        const prompt = document.createElement('div');
        prompt.id = 'phantom-reconnect-prompt';
        prompt.innerHTML = `
            <div class="phantom-reconnect-content">
                <span>🎯 Reconnecter "${previousState.deviceName}" ?</span>
                <button id="phantom-reconnect-yes">Connecter</button>
                <button id="phantom-reconnect-no">✕</button>
            </div>
        `;
        document.body.appendChild(prompt);
        
        // Styles
        if (!document.getElementById('phantom-reconnect-styles')) {
            const style = document.createElement('style');
            style.id = 'phantom-reconnect-styles';
            style.textContent = `
                #phantom-reconnect-prompt {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 10000;
                    animation: slideIn 0.3s ease;
                }
                
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                
                .phantom-reconnect-content {
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    padding: 15px 20px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
                    border: 1px solid rgba(102, 126, 234, 0.3);
                    color: white;
                    font-size: 14px;
                }
                
                .phantom-reconnect-content button {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 500;
                    transition: all 0.2s;
                }
                
                #phantom-reconnect-yes {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                
                #phantom-reconnect-yes:hover {
                    transform: scale(1.05);
                }
                
                #phantom-reconnect-no {
                    background: rgba(255, 255, 255, 0.1);
                    color: white;
                }
                
                #phantom-reconnect-no:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `;
            document.head.appendChild(style);
        }
        
        // Event listeners
        document.getElementById('phantom-reconnect-yes')?.addEventListener('click', async () => {
           prompt.remove();
           
           // 1. D'abord connecter au Phantom
           const success = await this.connect();
           
           // 2. SEULEMENT si la connexion réussit, afficher le panneau
           if (success) {
               const phantomCheckbox = document.getElementById('phantomChess');
               if (phantomCheckbox && !phantomCheckbox.checked) {
                   phantomCheckbox.checked = true;
                   $(phantomCheckbox).trigger('change');
               }
           }
        });
        
        document.getElementById('phantom-reconnect-no')?.addEventListener('click', () => {
            prompt.remove();
            this.clearState();
        });
        
        // Auto-dismiss après 10 secondes
        setTimeout(() => {
            if (document.getElementById('phantom-reconnect-prompt')) {
                prompt.remove();
            }
        }, 10000);
    }
    
    // ========== WEBCAM ==========
    
    /**
     * 🆕 Démarre la webcam et l'affiche en overlay sur l'échiquier
     */
    async startWebcam() {
        try {
            // Vérifier si déjà active
            if (this.webcamStream) {
                this.log('📷 Webcam déjà active', 'info');
                return true;
            }
            
            this.log('📷 Démarrage webcam...', 'info');
            
            // Demander l'accès à la webcam
            this.webcamStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'environment' // Caméra arrière si disponible
                },
                audio: false
            });
            
            // Créer l'overlay vidéo
            this.createWebcamOverlay();
            
            // Connecter le stream à la vidéo
            const video = document.getElementById('phantom-webcam-video');
            if (video) {
                video.srcObject = this.webcamStream;
                video.play();
            }
            
            this.log('📷 Webcam active', 'success');
            return true;
            
        } catch (error) {
            this.log(`📷 Erreur webcam: ${error.message}`, 'error');
            console.error('Erreur webcam:', error);
            return false;
        }
    }
    
    /**
     * 🆕 Arrête la webcam
     */
    stopWebcam() {
        if (this.webcamStream) {
            this.webcamStream.getTracks().forEach(track => track.stop());
            this.webcamStream = null;
            this.log('📷 Webcam arrêtée', 'info');
        }
        
        // Supprimer l'overlay
        const overlay = document.getElementById('phantom-webcam-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
    
    /**
     * 🆕 Crée l'overlay vidéo sur l'échiquier
     */
    createWebcamOverlay() {
        // Supprimer si existe déjà
        const existing = document.getElementById('phantom-webcam-overlay');
        if (existing) existing.remove();
        
        // Trouver l'échiquier
        const boardContainer = document.getElementById('myBoard') || 
                               document.getElementById('board') || 
                               document.querySelector('.board-container') ||
                               document.querySelector('[class*="board"]');
        
        if (!boardContainer) {
            this.log('⚠️ Échiquier non trouvé pour overlay webcam', 'warn');
            return;
        }
        
        // S'assurer que le conteneur est positionné
        const computedStyle = window.getComputedStyle(boardContainer);
        if (computedStyle.position === 'static') {
            boardContainer.style.position = 'relative';
        }
        
        // Créer l'overlay
        const overlay = document.createElement('div');
        overlay.id = 'phantom-webcam-overlay';
        overlay.innerHTML = `
            <video id="phantom-webcam-video" autoplay playsinline muted></video>
            <div class="phantom-webcam-controls">
                <button id="phantom-webcam-toggle" title="Afficher/Masquer">👁️</button>
                <button id="phantom-webcam-opacity-down" title="Moins transparent">➖</button>
                <button id="phantom-webcam-opacity-up" title="Plus transparent">➕</button>
            </div>
        `;
        
        boardContainer.appendChild(overlay);
        
        // Ajouter les styles
        if (!document.getElementById('phantom-webcam-styles')) {
            const style = document.createElement('style');
            style.id = 'phantom-webcam-styles';
            style.textContent = `
                #phantom-webcam-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 50;
                }
                
                #phantom-webcam-overlay video {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    opacity: 0.5;
                    transition: opacity 0.3s ease;
                }
                
                #phantom-webcam-overlay.hidden video {
                    opacity: 0;
                }
                
                .phantom-webcam-controls {
                    position: absolute;
                    bottom: 10px;
                    right: 10px;
                    display: flex;
                    gap: 5px;
                    pointer-events: auto;
                }
                
                .phantom-webcam-controls button {
                    width: 32px;
                    height: 32px;
                    border: none;
                    border-radius: 6px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    cursor: pointer;
                    font-size: 14px;
                    transition: background 0.2s;
                }
                
                .phantom-webcam-controls button:hover {
                    background: rgba(102, 126, 234, 0.8);
                }
            `;
            document.head.appendChild(style);
        }
        
        // Ajouter les event listeners
        this.setupWebcamControls();
    }
    
    /**
     * 🆕 Configure les contrôles de la webcam
     */
    setupWebcamControls() {
        const overlay = document.getElementById('phantom-webcam-overlay');
        const video = document.getElementById('phantom-webcam-video');
        
        if (!overlay || !video) return;
        
        // Opacité initiale
        this.webcamOpacity = 0.5;
        this.webcamVisible = true;
        
        // Toggle visibilité
        document.getElementById('phantom-webcam-toggle')?.addEventListener('click', () => {
            this.webcamVisible = !this.webcamVisible;
            video.style.opacity = this.webcamVisible ? this.webcamOpacity : 0;
        });
        
        // Diminuer opacité
        document.getElementById('phantom-webcam-opacity-down')?.addEventListener('click', () => {
            this.webcamOpacity = Math.max(0.1, this.webcamOpacity - 0.1);
            if (this.webcamVisible) {
                video.style.opacity = this.webcamOpacity;
            }
        });
        
        // Augmenter opacité
        document.getElementById('phantom-webcam-opacity-up')?.addEventListener('click', () => {
            this.webcamOpacity = Math.min(1, this.webcamOpacity + 0.1);
            if (this.webcamVisible) {
                video.style.opacity = this.webcamOpacity;
            }
        });
    }
    
    // ========== UI ==========
    
    updateUI(connected) {
        // Utiliser le paramètre ou l'état interne
        const isConn = (connected !== undefined) ? connected : this.isConnected;
        
        const statusEl = document.getElementById('phantom-status');
        if (statusEl) {
            if (isConn) {
                statusEl.textContent = `✅ Connecté: ${this.device ? this.device.name : 'Phantom'}`;
                statusEl.style.background = 'rgba(72, 187, 120, 0.3)';
            } else {
                statusEl.textContent = '❌ Déconnecté';
                statusEl.style.background = 'rgba(244, 67, 54, 0.3)';
            }
        }
        
        // Activer/désactiver les boutons (compatible jQuery et vanilla)
        const buttonIds = [
            'phantom-connect', 'phantom-disconnect', 'phantom-calibrate', 
            'phantom-test', 'phantom-speed', 'phantom-volume', 'phantom-undo',
            'phantom-game-start', 'phantom-game-end'
        ];
        
        buttonIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id === 'phantom-connect') {
                    el.disabled = isConn;
                } else {
                    el.disabled = !isConn;
                }
            }
        });
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
        this.log(enabled ? '🟢 Activé' : '🔴 Désactivé', 'info');
        
        if (!enabled) {
            this.moveQueue = [];
            this.isMoving = false;
        }
    }
    
    isEnabled() {
        return this.enabled && this.isConnected;
    }
    
    /**
     * 🆕 Retourne si un mouvement est en cours (pour bloquer l'UI externe)
     */
    isBusy() {
        return this.isMoving || this.moveQueue.length > 0;
    }
}

// Instance globale
window.phantomChessboard = new PhantomChessboard();

/**
 * 🎯 FONCTION GLOBALE appelée par chessVoterApp.js après chaque coup
 */
window.syncPhantomPosition = function() {
    if (!window.phantomChessboard) {
        console.log('⚠️ [syncPhantomPosition] phantomChessboard non disponible');
        return;
    }
    
    if (!window.phantomChessboard.isConnected) {
        console.log('⚠️ [syncPhantomPosition] Phantom non connecté');
        return;
    }
    
    if (!window.phantomChessboard.enabled) {
        console.log('⚠️ [syncPhantomPosition] Phantom désactivé');
        return;
    }
    
    if (typeof chess === 'undefined') {
        console.log('⚠️ [syncPhantomPosition] chess.js non disponible');
        return;
    }
    
    const currentFen = chess.fen();
    console.log('🔄 [syncPhantomPosition] Sync vers Phantom:', currentFen);
    
    window.phantomChessboard.syncPosition(currentFen);
};

/**
 * 🆕 Fonction pour vérifier si le Phantom est occupé (pour bloquer les votes etc.)
 */
window.isPhantomBusy = function() {
    return window.phantomChessboard && 
           window.phantomChessboard.isConnected && 
           window.phantomChessboard.enabled && 
           window.phantomChessboard.isBusy();
};

// 🆕 Au chargement, vérifier si on doit proposer une reconnexion
document.addEventListener('DOMContentLoaded', function() {
    // Petit délai pour laisser le temps à l'UI de se charger
    setTimeout(() => {
        if (window.phantomChessboard) {
            window.phantomChessboard.showReconnectPrompt();
        }
    }, 1500);
});

console.log('🎯 Phantom.js chargé - Version avec file d\'attente et blocage UI');