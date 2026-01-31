/**
 * 🎯 PHANTOM CHESS - VERSION AVEC GESTION DU CIMETIÈRE
 * Support complet des captures via matrice 10x10
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
        this.lastMatrixSent = null;
        this.gameInitialized = false;
        
        // Position initiale pour calculer les pièces capturées
        this.INITIAL_PIECES = {
            white: { K: 1, Q: 1, R: 2, B: 2, N: 2, P: 8 },
            black: { k: 1, q: 1, r: 2, b: 2, n: 2, p: 8 }
        };
        
        // Matrice initiale correcte (10x10) - ATTENTION: lecture par COLONNES !
        // Le Phantom lit la matrice colonne par colonne, pas ligne par ligne
        // Colonne 0: cimetière gauche
        // Colonne 1: pièces noires (r,n,b,q,k,b,n,r)
        // Colonne 2: pions noirs
        // Colonnes 3-6: vide
        // Colonne 7: pions blancs
        // Colonne 8: pièces blanches (R,N,B,Q,K,B,N,R)
        // Colonne 9: cimetière droit
        this.INITIAL_MATRIX = 
            '..........' +  // Row 0: cimetière haut
            '.rp....PR.' +  // Row 1: tour noire, pion noir, ..., pion blanc, tour blanche
            '.np....PN.' +  // Row 2: cavalier noir, pion noir, ..., pion blanc, cavalier blanc
            '.bp....PB.' +  // Row 3: fou noir, pion noir, ..., pion blanc, fou blanc
            '.qp....PQ.' +  // Row 4: dame noire, pion noir, ..., pion blanc, dame blanche
            '.kp....PK.' +  // Row 5: roi noir, pion noir, ..., pion blanc, roi blanc
            '.bp....PB.' +  // Row 6: fou noir, pion noir, ..., pion blanc, fou blanc
            '.np....PN.' +  // Row 7: cavalier noir, pion noir, ..., pion blanc, cavalier blanc
            '.rp....PR.' +  // Row 8: tour noire, pion noir, ..., pion blanc, tour blanche
            '..........';   // Row 9: cimetière bas
        
        console.log('🎯 PhantomChessboard initialisé (avec gestion cimetière)');
    }
    
    // ========== CONVERSION FEN → MATRICE AVEC CIMETIÈRE ==========
    
    /**
     * Convertit un FEN en matrice 10x10 avec les pièces capturées au cimetière
     * @param {string} fen - Position FEN
     * @returns {string} Matrice 10x10 pour le Phantom
     */
    fenToMatrixWithGraveyard(fen) {
        // Extraire juste la position (première partie du FEN)
        const position = fen.split(' ')[0];
        
        // Convertir FEN en tableau 8x8
        const board8x8 = this.fenToBoard8x8(position);
        
        // Compter les pièces actuelles
        const currentPieces = this.countPieces(board8x8);
        
        // Calculer les pièces capturées
        const capturedWhite = this.calculateCaptured(this.INITIAL_PIECES.white, currentPieces.white);
        const capturedBlack = this.calculateCaptured(this.INITIAL_PIECES.black, currentPieces.black);
        
        this.log(`⚰️ Pièces capturées - Blancs: ${capturedWhite.join('')} | Noirs: ${capturedBlack.join('')}`, 'info');
        
        // Construire la matrice 10x10
        const matrix = this.buildMatrix10x10(board8x8, capturedWhite, capturedBlack);
        
        return matrix;
    }
    
    /**
     * Convertit la position FEN en tableau 8x8
     */
    fenToBoard8x8(position) {
        const board = [];
        const rows = position.split('/');
        
        for (const row of rows) {
            let boardRow = '';
            for (const char of row) {
                if (/\d/.test(char)) {
                    boardRow += '.'.repeat(parseInt(char));
                } else {
                    boardRow += char;
                }
            }
            board.push(boardRow.padEnd(8, '.').slice(0, 8));
        }
        
        // S'assurer qu'on a 8 lignes
        while (board.length < 8) {
            board.push('........');
        }
        
        return board;
    }
    
    /**
     * Compte les pièces présentes sur le plateau
     */
    countPieces(board8x8) {
        const white = { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0 };
        const black = { k: 0, q: 0, r: 0, b: 0, n: 0, p: 0 };
        
        for (const row of board8x8) {
            for (const char of row) {
                if (char in white) white[char]++;
                if (char in black) black[char]++;
            }
        }
        
        return { white, black };
    }
    
    /**
     * Calcule les pièces capturées
     */
    calculateCaptured(initial, current) {
        const captured = [];
        
        for (const [piece, count] of Object.entries(initial)) {
            const missing = count - (current[piece] || 0);
            for (let i = 0; i < missing; i++) {
                captured.push(piece);
            }
        }
        
        return captured;
    }
    
    /**
     * Construit la matrice 10x10 avec le cimetière
     * ATTENTION: Le Phantom utilise une matrice TRANSPOSÉE !
     * - Les colonnes du plateau deviennent les lignes de la matrice
     * - Colonne 0 = cimetière gauche (pièces noires capturées)
     * - Colonne 9 = cimetière droit (pièces blanches capturées)
     */
    buildMatrix10x10(board8x8, capturedWhite, capturedBlack) {
        // La matrice Phantom est transposée par rapport à un échiquier standard
        // board8x8[row][col] → matrix row = col+1, matrix col = row+1
        
        let matrix = '';
        
        for (let matrixRow = 0; matrixRow < 10; matrixRow++) {
            for (let matrixCol = 0; matrixCol < 10; matrixCol++) {
                
                // Coins et bords du cimetière
                if (matrixRow === 0 || matrixRow === 9) {
                    // Lignes 0 et 9 = cimetière haut/bas
                    if (matrixRow === 0) {
                        // Cimetière haut - on peut y mettre des pièces capturées si besoin
                        matrix += '.';
                    } else {
                        // Cimetière bas
                        matrix += '.';
                    }
                } else if (matrixCol === 0) {
                    // Colonne 0 = cimetière gauche (pièces NOIRES capturées par les blancs)
                    const idx = matrixRow - 1;
                    matrix += (idx < capturedBlack.length) ? capturedBlack[idx] : '.';
                } else if (matrixCol === 9) {
                    // Colonne 9 = cimetière droit (pièces BLANCHES capturées par les noirs)
                    const idx = matrixRow - 1;
                    matrix += (idx < capturedWhite.length) ? capturedWhite[idx] : '.';
                } else {
                    // Zone de jeu 8x8 (colonnes 1-8, lignes 1-8)
                    // Conversion: matrixRow 1-8 → boardCol 0-7, matrixCol 1-8 → boardRow 0-7
                    const boardRow = matrixCol - 1;  // Ligne de l'échiquier (0-7)
                    const boardCol = matrixRow - 1;  // Colonne de l'échiquier (0-7)
                    
                    if (boardRow >= 0 && boardRow < 8 && boardCol >= 0 && boardCol < 8) {
                        matrix += board8x8[boardRow][boardCol] || '.';
                    } else {
                        matrix += '.';
                    }
                }
            }
        }
        
        return matrix;
    }
    
    /**
     * Affiche une matrice 10x10 de façon lisible (pour debug)
     * Note: La matrice Phantom est transposée par rapport à l'échiquier standard
     */
    formatMatrix(matrix) {
        let display = '📋 Matrice Phantom (transposée):\n';
        display += '     0 1 2 3 4 5 6 7 8 9  ← colonnes matrice (= lignes échiquier)\n';
        display += '     C a b c d e f g h C  ← correspondance échiquier\n';
        for (let row = 0; row < 10; row++) {
            const rowLabel = row === 0 ? 'C' : (row === 9 ? 'C' : row.toString());
            const chessFile = row === 0 ? ' ' : (row === 9 ? ' ' : String.fromCharCode(96 + row));
            display += `${row} ${chessFile}  `;
            for (let col = 0; col < 10; col++) {
                display += matrix[row * 10 + col] + ' ';
            }
            display += '\n';
        }
        display += '↑ lignes matrice (= colonnes échiquier a-h)';
        return display;
    }
    
    // ========== CONNEXION ==========
    
    async connect() {
        if (!navigator.bluetooth) {
            this.log('❌ Web Bluetooth non supporté', 'error');
            alert('Web Bluetooth non supporté. Utilisez Chrome ou Edge.');
            return false;
        }
        
        try {
            this.log('🔍 Recherche du Phantom...', 'info');
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Phantom' }],
                optionalServices: [this.SERVICE_UUID]
            });
            
            this.log(`📱 Appareil trouvé: ${this.device.name}`, 'info');
            
            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);
            
            // Récupérer les caractéristiques
            this.characteristics.game = await this.service.getCharacteristic(this.UUID_GAME);
            
            try {
                this.characteristics.speed = await this.service.getCharacteristic(this.UUID_MECHANISM_SPEED);
            } catch (e) { /* Optionnel */ }
            
            try {
                this.characteristics.sound = await this.service.getCharacteristic(this.UUID_SOUND_SETTINGS);
            } catch (e) { /* Optionnel */ }
            
            try {
                this.characteristics.state = await this.service.getCharacteristic(this.UUID_SETSTATE);
            } catch (e) { /* Optionnel */ }
            
            try {
                this.characteristics.battery = await this.service.getCharacteristic(this.UUID_BATTERY);
            } catch (e) { /* Optionnel */ }
            
            // Activer les notifications
            if (this.characteristics.game) {
                await this.characteristics.game.startNotifications();
                this.characteristics.game.addEventListener('characteristicvaluechanged',
                    this.handleGameNotification.bind(this));
            }
            
            if (this.characteristics.state) {
                await this.characteristics.state.startNotifications();
                this.characteristics.state.addEventListener('characteristicvaluechanged',
                    this.handleStateNotification.bind(this));
            }
            
            if (this.characteristics.battery) {
                await this.characteristics.battery.startNotifications();
                this.characteristics.battery.addEventListener('characteristicvaluechanged',
                    this.handleBatteryNotification.bind(this));
            }
            
            this.isConnected = true;
            this.enabled = true;
            this.log(`✅ Connecté à ${this.device.name}`, 'success');
            this.updateUI(true);
            
            // Initialisation automatique
            await this.initializeGame();
            
            // Gestion déconnexion
            this.device.addEventListener('gattserverdisconnected', () => {
                this.log('⚠️ Déconnecté', 'warn');
                this.isConnected = false;
                this.enabled = false;
                this.gameInitialized = false;
                this.updateUI(false);
            });
            
            return true;
            
        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            return false;
        }
    }
    
    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            if (this.gameInitialized) {
                await this.sendGameEnd();
            }
            this.device.gatt.disconnect();
            this.isConnected = false;
            this.enabled = false;
            this.gameInitialized = false;
            this.log('🔌 Déconnecté', 'info');
            this.updateUI(false);
        }
    }
    
    // ========== INITIALISATION ==========
    
    async initializeGame() {
        if (this.gameInitialized) {
            this.log('ℹ️ Partie déjà initialisée', 'info');
            return true;
        }
        
        this.log('🎮 Initialisation partie...', 'info');
        
        // Envoyer la matrice initiale
        await this.sendGameStartWithMatrix(this.INITIAL_MATRIX, 'W');
        
        this.gameInitialized = true;
        this.log('✅ Partie initialisée', 'success');
        
        return true;
    }
    
    // ========== COMMANDES BLE ==========
    
    async sendCommand(opCode, data = '') {
        if (!this.isConnected || !this.characteristics.game) {
            this.log('❌ Non connecté', 'error');
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
    
    /**
     * Envoie GAME_START avec une matrice et une couleur
     */
    async sendGameStartWithMatrix(matrix, color = 'W') {
        const data = matrix + ',' + color;
        this.lastMatrixSent = matrix;
        return await this.sendCommand(this.OP_CODES.GAME_START, data);
    }
    
    async sendGameStart() {
        return await this.sendGameStartWithMatrix(this.INITIAL_MATRIX, 'W');
    }
    
    async sendGameEnd() {
        this.gameInitialized = false;
        return await this.sendCommand(this.OP_CODES.GAME_END);
    }
    
    async sendResetDetection(fen = '') {
        return await this.sendCommand(this.OP_CODES.RESET_DETECTION, fen);
    }
    
    async calibrate() {
        return await this.sendCommand(this.OP_CODES.CALIBRATION);
    }
    
    async sendTakeBack(count, fen, side = '1') {
        const data = `${count},${fen},${side}`;
        this.log(`↩️ TAKE_BACK: ${count} coups, side=${side}`, 'info');
        return await this.sendCommand(this.OP_CODES.TAKE_BACK, data);
    }
    
    // ========== MOUVEMENTS ==========
    
    /**
     * Envoie un mouvement simple (sans capture)
     * Pour les captures, utiliser syncPosition() qui envoie la matrice complète
     */
    async sendMove(move) {
        if (!this.gameInitialized) {
            this.log('⚠️ Partie non initialisée', 'warn');
            await this.initializeGame();
        }
        
        this.log(`♟️ Envoi mouvement: ${move}`, 'info');
        return await this.sendCommand(this.OP_CODES.MOVEMENT, move);
    }
    
    /**
     * 🎯 MÉTHODE PRINCIPALE : Synchronise la position avec le Phantom
     * Utilise GAME_START avec matrice complète incluant le cimetière
     * Cette méthode gère correctement les captures !
     * 
     * @param {string} fen - Position FEN à synchroniser
     * @param {object} moveInfo - Info sur le coup (optionnel, pour optimisation future)
     */
async syncPosition(fen) {
    if (!this.isConnected) {
        this.log("❌ Non connecté", "error");
        return false;
    }

    if (!this.gameInitialized) {
        await this.initializeGame();
    }

    const matrix = this.fenToMatrixWithGraveyard(fen);
    const color = fen.includes(" b ") ? "B" : "W";

    this.log("🔄 RESET_DETECTION + MATRIX", "info");

    await this.sendCommand(this.OP_CODES.RESET_DETECTION, matrix);

    // Attendre la stabilisation interne
    await new Promise(r => setTimeout(r, 200));

    // Reforcer le BLE mode
    await this.sendCommand(this.OP_CODES.SIDE, "2");

    this.lastFenSent = fen;
    return true;
}
    
    /**
     * Synchronisation rapide pour les coups simples (sans capture)
     * Utilise MOVEMENT au lieu de GAME_START - plus rapide mais ne gère pas les captures
     */
    async syncMoveOnly(from, to, promotion = '') {
        const moveStr = `M 1 ${from}-${to} ${promotion || 'E'}`;
        return await this.sendCommand(this.OP_CODES.MOVEMENT, moveStr);
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
    
    async setGameAssistance(settings = '1,1,1,1,0,0') {
        return await this.sendCommand(this.OP_CODES.GAME_ASSISTANCE, settings);
    }
    
    // ========== COMMANDES BRUTES ==========
    
    async sendRawCommand(opCode, data = '') {
        this.log(`🔧 Commande brute: 0x${opCode.toString(16)} "${data}"`, 'info');
        return await this.sendCommand(opCode, data);
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
            
            // Log
            if (dataStr.trim() && dataStr.length < 100) {
                this.log(`📥 [${opName}] "${dataStr}"`, 'received');
            } else if (dataStr.trim()) {
                this.log(`📥 [${opName}] (${dataStr.length} chars)`, 'received');
            } else {
                this.log(`📥 [${opName}]`, 'received');
            }
            
            // BLE_MOVE_DONE
            if (opCode === this.OP_CODES.BLE_MOVE_DONE) {
                this.log(`🎯 MOVE_DONE: ${dataStr}`, 'success');
            }
            
            // MOVEMENT_VERIFY - répondre automatiquement
            if (opCode === this.OP_CODES.MOVEMENT_VERIFY) {
                this.log(`🔍 MOVEMENT_VERIFY: "${dataStr}" → Confirmation...`, 'warning');
                
                setTimeout(() => {
                    this.sendCommand(this.OP_CODES.MOVEMENT_VERIFY, "1")
                        .then(() => this.log(`✅ MOVEMENT_VERIFY confirmé`, 'success'))
                        .catch(err => this.log(`❌ Erreur confirmation: ${err.message}`, 'error'));
                }, 100);
            }
            
        } catch (e) {
            this.log(`📥 Notification binaire (${bytes.length} bytes)`, 'received');
        }
    }
    
    handleStateNotification(event) {
        const state = new TextDecoder('utf-8').decode(event.target.value);
        this.log(`📊 ÉTAT: ${state}`, 'info');
        
        const stateEl = document.getElementById('phantom-state-text');
        if (stateEl) {
            stateEl.textContent = state;
            stateEl.style.color = '#0ff';
        }
    }
    
    handleBatteryNotification(event) {
        const batteryData = new TextDecoder('utf-8').decode(event.target.value);
        const [percentage] = batteryData.split(',');
        this.log(`🔋 Batterie: ${percentage}%`, 'info');
        
        const batteryEl = document.getElementById('phantom-battery');
        if (batteryEl) {
            batteryEl.textContent = `🔋 ${percentage}%`;
        }
    }
    
    // ========== UTILITAIRES ==========
    
    log(message, type = 'info') {
        const prefix = {
            'info': 'ℹ️', 'success': '✅', 'error': '❌',
            'warn': '⚠️', 'sent': '📤', 'received': '📥'
        }[type] || 'ℹ️';
        
        console.log(`${prefix} [Phantom] ${message}`);
    }
    
    updateUI(connected) {
        console.log(`UI: ${connected ? 'Connecté' : 'Déconnecté'}`);
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
        this.log(enabled ? '🟢 Activé' : '🔴 Désactivé', 'info');
    }
    
    isEnabled() {
        return this.enabled && this.isConnected;
    }
}

// Instance globale
window.phantomChessboard = new PhantomChessboard();

console.log('🎯 Phantom.js chargé (version avec gestion cimetière)');