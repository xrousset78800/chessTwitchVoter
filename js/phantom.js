/**
 * 🎯 PHANTOM CHESS - VERSION FINALE CORRIGÉE
 * MOVEMENT + alternance automatique du SIDE
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
        
        this.OP_CODES = {
            GAME_START: 0,
            GAME_END: 1,
            MOVEMENT: 2,
            BOARD_STATE: 6,
            CALIBRATION: 7,
            SIDE: 10,
            BLE_MOVE_DONE: 12,
            SNAPTOCENTERCOM: 13,
            RESET_DETECTION: 14
        };
        
        this.OP_CODE_NAMES = {
            0: 'GAME_START', 1: 'GAME_END', 2: 'MOVEMENT',
            6: 'BOARD_STATE', 7: 'CALIBRATION', 10: 'SIDE',
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
        this.currentSide = 2; // 👈 NOUVEAU : Toujours BLE (mode 2)
        
        // Matrice initiale
        this.INITIAL_MATRIX = '...........rp....PR..np....PN..bp....PB..qp....PQ..kp....PK..bp....PB..np....PN..rp....PR...........,W';
        
        console.log('🎯 PhantomChessboard initialisé (version finale)');
    }
    
    // ... [MÉTHODES connect, disconnect, initializeGame, sendCommand INCHANGÉES] ...
    
    async connect() {
        if (!navigator.bluetooth) {
            this.log('❌ Web Bluetooth non supporté', 'error');
            alert('Web Bluetooth non supporté. Utilisez Chrome ou Edge.');
            return false;
        }
        
        try {
            this.log('🔍 Recherche Phantom...', 'info');
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Phantom' }],
                optionalServices: [this.SERVICE_UUID]
            });
            
            this.log(`📱 Connexion à ${this.device.name}...`, 'info');
            
            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);
            
            const uuids = {
                game: this.UUID_GAME,
                speed: this.UUID_MECHANISM_SPEED,
                sound: this.UUID_SOUND_SETTINGS,
                battery: this.UUID_BATTERY,
                state: this.UUID_SETSTATE
            };
            
            for (const [key, uuid] of Object.entries(uuids)) {
                try {
                    this.characteristics[key] = await this.service.getCharacteristic(uuid);
                    this.log(`✓ ${key} OK`, 'info');
                } catch (e) {
                    this.log(`⚠ ${key} indisponible`, 'warn');
                }
            }
            
            // Notifications
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
            
            await this.initializeGame();
            
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
                await this.endGame();
            }
            this.device.gatt.disconnect();
            this.isConnected = false;
            this.enabled = false;
            this.gameInitialized = false;
            this.log('🔌 Déconnecté', 'info');
            this.updateUI(false);
        }
    }
    
    async initializeGame() {
        if (this.gameInitialized) {
            this.log('ℹ️ Déjà initialisé', 'info');
            return true;
        }
        
        this.log('🎮 Initialisation...', 'info');
        
        await this.startGame();
        await this.selectSide(2); // BLE mode
        
        this.gameInitialized = true;
        this.log('✅ Initialisé (START + BLE)', 'success');
        
        return true;
    }
    
    async sendCommand(opCode, data = '') {
        if (!this.isConnected || !this.characteristics.game) {
            this.log('❌ Non connecté', 'error');
            return false;
        }
        
        try {
            const message = String.fromCharCode(opCode) + data;
            const encoded = new TextEncoder().encode(message);
            await this.characteristics.game.writeValue(encoded);
            
            const opName = this.OP_CODE_NAMES[opCode] || 'UNK';
            if (data.length < 100) {
                this.log(`📤 [${opName}] "${data}"`, 'sent');
            } else {
                this.log(`📤 [${opName}] (longue)`, 'sent');
            }
            return true;
        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            return false;
        }
    }
    
function fenToPhantomMatrix(fen) {
    const parts = fen.split(' ');
    const position = parts[0];
    const turn = parts[1]; // 'w' ou 'b'
    
    let matrix = '';
    
    // Ajouter 12 cases vides au début (bord supérieur)
    matrix += '.'.repeat(12);
    
    // Convertir chaque rangée
    const rows = position.split('/').reverse(); // Inverser car FEN va de 8 à 1
    
    for (let row of rows) {
        // Bord gauche (2 cases)
        matrix += '..';
        
        // Convertir la rangée
        for (let char of row) {
            if (char >= '1' && char <= '8') {
                // Chiffre = cases vides
                matrix += '.'.repeat(parseInt(char));
            } else {
                // Pièce
                // FEN utilise minuscules pour noir, majuscules pour blanc
                // Phantom utilise p/r/n/b/q/k pour noir, P/R/N/B/Q/K pour blanc
                matrix += char;
            }
        }
        
        // Bord droit (2 cases)
        matrix += '..';
    }
    
    // Ajouter 12 cases vides à la fin (bord inférieur)
    matrix += '.'.repeat(12);
    
    // Ajouter virgule + couleur
    matrix += ',' + (turn === 'w' ? 'W' : 'B');
    
    return matrix;
}

// Modifier syncPosition pour utiliser cette approche
async syncPosition(fen, moveInfo = null) {
    if (!this.enabled || !this.isConnected) {
        console.log('⚠️ Phantom non connecté');
        return false;
    }
    
    if (!this.gameInitialized) {
        await this.initializeGame();
    }
    
    if (fen === this.lastFenSent) {
        console.log('⏭️ FEN identique');
        return true;
    }
    
    this.log(`♟️ Sync via MATRICE: ${fen}`, 'info');
    
    try {
        // 🎯 CONVERTIR LE FEN EN MATRICE
        const matrix = fenToPhantomMatrix(fen);
        
        this.log(`📊 Matrice: ${matrix.substring(0, 50)}...`, 'info');
        
        // 🎯 ENVOYER VIA GAME_START (même commande que l'initialisation)
        await this.sendCommand(this.OP_CODES.GAME_START, matrix);
        
        // Délai
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Mode BLE
        await this.selectSide(2);
        
        this.lastFenSent = fen;
        this.log('✅ Position synchronisée via matrice', 'success');
        
        return true;
        
    } catch (error) {
        console.error('❌ Erreur sync:', error);
        return false;
    }
}
    
    // ... [MÉTHODES handleGameNotification, handleStateNotification, handleBatteryNotification INCHANGÉES] ...
    
    handleGameNotification(event) {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const bytes = new Uint8Array(value.buffer);
        
        try {
            const strValue = decoder.decode(value);
            const opCode = bytes[0];
            const opName = this.OP_CODE_NAMES[opCode] || 'UNK';
            const dataStr = strValue.substring(1);
            
            // 🔍 ESPION : Logger TOUT en détail
            console.log('═══════════════════════════════════════');
            console.log('📥 NOTIFICATION REÇUE');
            console.log('OpCode:', opCode, `(${opName})`);
            console.log('Data brute:', dataStr);
            console.log('Bytes:', Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
            
            // Si c'est un coup (MOVEMENT ou BLE_MOVE_DONE)
            if (opCode === this.OP_CODES.MOVEMENT || opCode === this.OP_CODES.BLE_MOVE_DONE) {
                console.log('🎯 COUP DÉTECTÉ !');
                console.log('   Format:', dataStr);
                
                // Analyser le format
                if (dataStr.includes('x')) {
                    console.log('   ⚠️ CONTIENT UN X (capture)');
                }
                if (dataStr.includes('-')) {
                    console.log('   ⚠️ CONTIENT UN - (simple move)');
                }
            }
            console.log('═══════════════════════════════════════');
            
            // Logs normaux (gardés)
            if (dataStr.trim() && dataStr.length < 100) {
                this.log(`📥 [${opName}] "${dataStr}"`, 'received');
            } else if (dataStr.trim()) {
                this.log(`📥 [${opName}] (longue)`, 'received');
            } else {
                this.log(`📥 [${opName}]`, 'received');
            }
            
            if (opCode === this.OP_CODES.BLE_MOVE_DONE) {
                this.log(`🎯 Coup détecté: ${dataStr}`, 'info');
            }
            
        } catch (e) {
            this.log(`📥 Notif binaire`, 'received');
        }
    }
    
    handleStateNotification(event) {
        const state = new TextDecoder('utf-8').decode(event.target.value);
        this.log(`📊 État: ${state}`, 'info');
    }
    
    handleBatteryNotification(event) {
        const batteryData = new TextDecoder('utf-8').decode(event.target.value);
        const [percentage] = batteryData.split(',');
        this.log(`🔋 ${percentage}%`, 'info');
        
        const batteryEl = document.getElementById('phantom-battery');
        if (batteryEl) {
            batteryEl.textContent = `🔋 ${percentage}%`;
        }
    }
    
    async startGame() {
        return await this.sendCommand(this.OP_CODES.GAME_START, this.INITIAL_MATRIX);
    }
    
    async endGame() {
        this.gameInitialized = false;
        return await this.sendCommand(this.OP_CODES.GAME_END);
    }
    
    async selectSide(side) {
        return await this.sendCommand(this.OP_CODES.SIDE, side.toString());
    }
    
    async calibrate() {
        return await this.sendCommand(this.OP_CODES.CALIBRATION);
    }
    
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

// Fonction de sync
function syncPhantomPosition() {
    if (!window.phantomChessboard || !window.phantomChessboard.isEnabled()) {
        return;
    }
    
    const autoSyncCheckbox = document.getElementById('phantom-auto-sync');
    if (autoSyncCheckbox && !autoSyncCheckbox.checked) {
        return;
    }
    
    if (typeof chess !== 'undefined') {
        const currentFen = chess.fen();
        
        // 🎯 RÉCUPÉRER L'OBJET COMPLET depuis chess.history({ verbose: true })
        const history = chess.history({ verbose: true });
        const lastMove = history.length > 0 ? history[history.length - 1] : null;
        
        // 🎯 PASSER L'OBJET COMPLET (pas un objet simplifié)
        // lastMove contient déjà : from, to, flags, captured, san, etc.
        window.phantomChessboard.syncPosition(currentFen, lastMove);
    }
}

// Fonction de test
function testPhantomSync() {
    if (typeof chess !== 'undefined') {
        const fen = chess.fen();
        const history = chess.history({ verbose: true });
        const lastMove = history.length > 0 ? history[history.length - 1] : null;
        
        const moveInfo = lastMove ? {
            from: lastMove.from,
            to: lastMove.to,
            promotion: lastMove.promotion || ''
        } : null;
        
        console.log('🧪 Test sync');
        console.log('FEN:', fen);
        console.log('Coup:', moveInfo);
        
        window.phantomChessboard.syncPosition(fen, moveInfo);
    } else {
        alert('Aucune partie en cours');
    }
}

console.log('🎯 Phantom chargé (v.finale - MOVEMENT + FEN + SIDE)');