// Module d'intégration Phantom via pont Python local
// Remplace le Web Bluetooth par des appels HTTP vers le serveur Python

class PhantomBridgeClient {
    constructor() {
        this.baseUrl = 'http://localhost:5000';
        this.isConnected = false;
        this.batteryLevel = 0;
        this.checkInterval = null;
    }

    // Vérifier le statut du pont Python
    async checkBridge() {
        try {
            const response = await fetch(`${this.baseUrl}/phantom/status`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    // Scanner les appareils Phantom
    async scanDevices() {
        try {
            const response = await fetch(`${this.baseUrl}/phantom/scan`);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('❌ Erreur scan:', error);
            return { found: false, address: null };
        }
    }

    // Se connecter au Phantom
    async connect(address = null) {
        try {
            this.showNotification('🔄 Connexion au Phantom...', 'info');
            
            const response = await fetch(`${this.baseUrl}/phantom/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: address })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.isConnected = true;
                this.showNotification('✅ Phantom connecté!', 'success');
                this.startStatusUpdates();
                $('#phantom-status').text('✅ Connecté').css('color', 'green');
                return true;
            } else {
                this.showNotification('❌ Connexion échouée', 'error');
                $('#phantom-status').text('❌ Connexion échouée').css('color', 'red');
                return false;
            }
            
        } catch (error) {
            console.error('❌ Erreur connexion:', error);
            this.showNotification('❌ Serveur Python non accessible', 'error');
            $('#phantom-status').text('❌ Serveur Python non accessible').css('color', 'red');
            return false;
        }
    }

    // Démarrer les mises à jour de statut
    startStatusUpdates() {
        this.checkInterval = setInterval(async () => {
            await this.updateStatus();
        }, 3000); // Vérifier toutes les 3 secondes
    }

    // Mettre à jour le statut
    async updateStatus() {
        try {
            const response = await fetch(`${this.baseUrl}/phantom/status`);
            const status = await response.json();
            
            this.isConnected = status.connected;
            this.batteryLevel = status.battery;
            
            $('#phantom-battery').text(`🔋 ${this.batteryLevel}%`);
            
            if (!this.isConnected) {
                $('#phantom-status').text('❌ Déconnecté').css('color', 'red');
                this.stopStatusUpdates();
            }
            
        } catch (error) {
            console.error('❌ Erreur mise à jour statut:', error);
        }
    }

    // Arrêter les mises à jour
    stopStatusUpdates() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    // Envoyer un coup au Phantom
    async makeMove(from, to) {
        if (!this.isConnected) {
            console.warn('⚠️ Phantom non connecté');
            return false;
        }

        try {
            const response = await fetch(`${this.baseUrl}/phantom/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: from, to: to })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log(`🎯 Coup envoyé: ${from}→${to}`);
                this.showNotification(`Phantom: ${from}→${to}`, 'success');
                return true;
            } else {
                console.error('❌ Échec envoi coup');
                this.showNotification('❌ Échec envoi coup', 'error');
                return false;
            }
            
        } catch (error) {
            console.error('❌ Erreur envoi coup:', error);
            this.showNotification('❌ Erreur envoi coup', 'error');
            return false;
        }
    }

    // Synchroniser la position
    async syncPosition(fen) {
        if (!this.isConnected) return false;

        try {
            const response = await fetch(`${this.baseUrl}/phantom/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fen: fen })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('🔄 Position synchronisée');
                this.showNotification('🔄 Position synchronisée', 'success');
                return true;
            }
            
        } catch (error) {
            console.error('❌ Erreur sync position:', error);
            return false;
        }
        
        return false;
    }

    // Déconnecter
    async disconnect() {
        try {
            await fetch(`${this.baseUrl}/phantom/disconnect`, {
                method: 'POST'
            });
            
            this.isConnected = false;
            this.stopStatusUpdates();
            this.showNotification('👋 Phantom déconnecté', 'info');
            $('#phantom-status').text('❌ Déconnecté').css('color', 'red');
            
        } catch (error) {
            console.error('❌ Erreur déconnexion:', error);
        }
    }

    // Notification visuelle (même que avant)
    showNotification(message, type = 'info') {
        const colors = {
            'success': '#4CAF50',
            'error': '#f44336', 
            'info': '#2196F3',
            'warning': '#ff9800'
        };

        const notification = $(`
            <div class="phantom-notification phantom-${type}">
                ${message}
            </div>
        `);
        
        $('body').append(notification);
        
        notification.css({
            'position': 'fixed',
            'top': '10px',
            'right': '10px',
            'background': colors[type] || colors.info,
            'color': 'white',
            'padding': '12px 20px',
            'border-radius': '8px',
            'z-index': '10000',
            'font-weight': 'bold',
            'box-shadow': '0 4px 12px rgba(0,0,0,0.3)',
            'animation': 'phantomSlideIn 0.3s ease-out forwards'
        });

        setTimeout(() => {
            notification.css('animation', 'phantomSlideOut 0.3s ease-in forwards');
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
}

// Instance globale
let phantomBridge = null;

// Interface utilisateur (adaptée pour le pont Python)
function addPhantomBridgeControls() {
    const phantomHTML = `
        <div id="phantom-controls" style="background: linear-gradient(135deg, #1e3c72, #2a5298); padding: 20px; border-radius: 15px; margin: 15px 0; color: white; box-shadow: 0 8px 25px rgba(0,0,0,0.3);">
            <h4 style="margin: 0 0 15px 0; text-align: center;">🎯 Phantom Chessboard (Python Bridge)</h4>
            
            <div id="phantom-status" style="font-weight: bold; margin: 10px 0; padding: 8px; border-radius: 5px; text-align: center; background: rgba(255,255,255,0.1);">
                ❌ Non connecté
            </div>
            
            <div style="text-align: center; margin: 15px 0;">
                <button id="check-bridge" class="phantom-button">🔍 Vérifier pont</button>
                <button id="scan-phantom" class="phantom-button">📡 Scanner</button>
            </div>
            
            <div style="text-align: center; margin: 10px 0;">
                <button id="connect-phantom" class="phantom-button" disabled>🔗 Connecter</button>
                <button id="disconnect-phantom" class="phantom-button" disabled>🔌 Déconnecter</button>
            </div>
            
            <div style="text-align: center; margin: 10px 0;">
                <button id="sync-position" class="phantom-button" disabled>🔄 Sync Position</button>
                <button id="test-move" class="phantom-button" disabled>🎮 Test e2-e4</button>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-top: 15px; font-size: 14px;">
                <div id="phantom-battery" style="color: #4CAF50; font-weight: bold;">🔋 ---%</div>
                <div>Python: <span id="bridge-status" style="color: #ff9800;">Non vérifié</span></div>
            </div>
            
            <div style="font-size: 11px; margin-top: 15px; color: #ccc; text-align: center;">
                ⚠️ Nécessite: python phantom_bridge.py<br>
                📦 pip install bleak flask flask-cors
            </div>
        </div>
    `;

    // Ajouter après le formulaire de configuration
    $('#configForm').after(phantomHTML);

    // Styles pour les boutons
    $('.phantom-button').css({
        'background': 'linear-gradient(45deg, #667eea, #764ba2)',
        'color': 'white',
        'border': 'none',
        'padding': '8px 12px',
        'border-radius': '6px',
        'cursor': 'pointer',
        'margin': '3px',
        'font-size': '12px',
        'transition': 'all 0.3s ease'
    });

    // Event listeners
    $('#check-bridge').click(async function() {
        $(this).text('🔄 Vérification...');
        
        if (!phantomBridge) phantomBridge = new PhantomBridgeClient();
        
        const available = await phantomBridge.checkBridge();
        
        if (available) {
            $('#bridge-status').text('✅ Actif').css('color', '#4CAF50');
            $('#scan-phantom, #connect-phantom').prop('disabled', false);
            phantomBridge.showNotification('✅ Pont Python accessible', 'success');
        } else {
            $('#bridge-status').text('❌ Inactif').css('color', '#f44336');
            phantomBridge.showNotification('❌ Pont Python non accessible. Lancez phantom_bridge.py', 'error');
        }
        
        $(this).text('🔍 Vérifier pont');
    });

    $('#scan-phantom').click(async function() {
        $(this).text('🔄 Scan...');
        
        const result = await phantomBridge.scanDevices();
        
        if (result.found) {
            phantomBridge.showNotification(`📱 Phantom trouvé: ${result.address}`, 'success');
            $('#connect-phantom').prop('disabled', false);
        } else {
            phantomBridge.showNotification('❌ Aucun Phantom trouvé', 'warning');
        }
        
        $(this).text('📡 Scanner');
    });

    $('#connect-phantom').click(async function() {
        $(this).prop('disabled', true).text('🔄 Connexion...');
        
        const connected = await phantomBridge.connect();
        
        if (connected) {
            $('#disconnect-phantom, #sync-position, #test-move').prop('disabled', false);
        }
        
        $(this).prop('disabled', false).text('🔗 Connecter');
    });

    $('#disconnect-phantom').click(async function() {
        await phantomBridge.disconnect();
        $('#disconnect-phantom, #sync-position, #test-move').prop('disabled', true);
        $('#phantom-battery').text('🔋 ---%');
    });

    $('#sync-position').click(async function() {
        if (phantomBridge && chess) {
            await phantomBridge.syncPosition(chess.fen());
        }
    });

    $('#test-move').click(async function() {
        if (phantomBridge) {
            await phantomBridge.makeMove('e2', 'e4');
        }
    });
}