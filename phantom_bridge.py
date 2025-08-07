# phantom_bridge.py - Pont entre votre app web et le Phantom via Bluetooth
# Nécessite: pip install bleak flask flask-cors

import asyncio
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from bleak import BleakClient, BleakScanner
import threading
import time

app = Flask(__name__)
CORS(app)  # Permettre les requêtes depuis votre app web

class PhantomBridge:
    def __init__(self):
        # UUIDs officiels du Phantom (depuis votre BLE.h)
        self.SERVICE_UUID = 'fd31a840-22e7-11eb-adc1-0242ac120002'
        self.MOVE_CHAR = 'c60c786b-bf3f-49d8-bd9e-c268e0519a7b'
        self.STATUS_CHAR = '06034924-77e8-433e-ac4c-27302e5e853f'
        self.BATTERY_CHAR = '7b204548-40c4-11eb-adc1-0242ac120002'
        self.MATRIX_CHAR = '1b034927-77e8-433e-ac4c-27302e5e853f'
        
        self.client = None
        self.is_connected = False
        self.device_address = None
        self.battery_level = 0
        self.last_status = ""

    async def scan_for_phantom(self):
        """Rechercher le plateau Phantom"""
        print("🔍 Recherche du plateau Phantom...")
        
        devices = await BleakScanner.discover(timeout=10.0)
        
        for device in devices:
            if device.name and ('phantom' in device.name.lower() or 'chess' in device.name.lower()):
                print(f"📱 Phantom trouvé: {device.name} ({device.address})")
                return device.address
        
        print("❌ Aucun Phantom trouvé")
        return None

    async def connect(self, address=None):
        """Se connecter au Phantom"""
        try:
            if not address:
                address = await self.scan_for_phantom()
                if not address:
                    return False
            
            self.device_address = address
            self.client = BleakClient(address)
            
            print(f"🔗 Connexion à {address}...")
            await self.client.connect()
            
            # Vérifier si le service existe
            services = await self.client.get_services()
            service_found = False
            
            for service in services:
                if service.uuid.lower() == self.SERVICE_UUID.lower():
                    service_found = True
                    break
            
            if not service_found:
                print(f"❌ Service Phantom non trouvé")
                return False
            
            # S'abonner aux notifications de statut
            try:
                await self.client.start_notify(self.STATUS_CHAR, self.on_status_notification)
                print("📡 Notifications de statut activées")
            except Exception as e:
                print(f"⚠️ Impossible d'activer les notifications: {e}")
            
            self.is_connected = True
            print("✅ Phantom connecté avec succès!")
            
            # Lire le niveau de batterie
            await self.read_battery()
            
            return True
            
        except Exception as e:
            print(f"❌ Erreur de connexion: {e}")
            self.is_connected = False
            return False

    def on_status_notification(self, sender, data):
        """Callback pour les notifications de statut"""
        try:
            self.last_status = data.decode('utf-8')
            print(f"📡 Statut Phantom: {self.last_status}")
        except Exception as e:
            print(f"❌ Erreur décodage statut: {e}")

    async def send_move(self, from_square, to_square):
        """Envoyer un coup au Phantom (format: M e2-e4)"""
        if not self.is_connected or not self.client:
            return False
        
        try:
            move_command = f"M {from_square}-{to_square}"
            data = move_command.encode('utf-8')
            
            await self.client.write_gatt_char(self.MOVE_CHAR, data)
            print(f"🎯 Coup envoyé: {move_command}")
            return True
            
        except Exception as e:
            print(f"❌ Erreur envoi coup: {e}")
            return False

    async def sync_position(self, fen):
        """Synchroniser la position (FEN)"""
        if not self.is_connected or not self.client:
            return False
        
        try:
            data = fen.encode('utf-8')
            await self.client.write_gatt_char(self.MATRIX_CHAR, data)
            print(f"🔄 Position synchronisée: {fen}")
            return True
            
        except Exception as e:
            print(f"❌ Erreur sync position: {e}")
            return False

    async def read_battery(self):
        """Lire le niveau de batterie"""
        if not self.is_connected or not self.client:
            return 0
        
        try:
            data = await self.client.read_gatt_char(self.BATTERY_CHAR)
            # Conversion selon le format de votre firmware
            self.battery_level = int.from_bytes(data, byteorder='little') if data else 0
            print(f"🔋 Batterie: {self.battery_level}%")
            return self.battery_level
            
        except Exception as e:
            print(f"❌ Erreur lecture batterie: {e}")
            return 0

    async def disconnect(self):
        """Déconnecter du Phantom"""
        if self.client and self.is_connected:
            try:
                await self.client.disconnect()
                print("👋 Phantom déconnecté")
            except Exception as e:
                print(f"❌ Erreur déconnexion: {e}")
        
        self.is_connected = False
        self.client = None

# Instance globale
phantom = PhantomBridge()

# Routes API pour votre application web
@app.route('/phantom/status', methods=['GET'])
def get_status():
    return jsonify({
        'connected': phantom.is_connected,
        'battery': phantom.battery_level,
        'last_status': phantom.last_status,
        'address': phantom.device_address
    })

@app.route('/phantom/connect', methods=['POST'])
def connect_phantom():
    data = request.get_json() or {}
    address = data.get('address')  # Optionnel
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        success = loop.run_until_complete(phantom.connect(address))
        return jsonify({'success': success})
    finally:
        loop.close()

@app.route('/phantom/disconnect', methods=['POST'])
def disconnect_phantom():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        loop.run_until_complete(phantom.disconnect())
        return jsonify({'success': True})
    finally:
        loop.close()

@app.route('/phantom/move', methods=['POST'])
def send_move():
    data = request.get_json()
    if not data or 'from' not in data or 'to' not in data:
        return jsonify({'error': 'Missing from/to parameters'}), 400
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        success = loop.run_until_complete(phantom.send_move(data['from'], data['to']))
        return jsonify({'success': success})
    finally:
        loop.close()

@app.route('/phantom/sync', methods=['POST'])
def sync_position():
    data = request.get_json()
    if not data or 'fen' not in data:
        return jsonify({'error': 'Missing fen parameter'}), 400
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        success = loop.run_until_complete(phantom.sync_position(data['fen']))
        return jsonify({'success': success})
    finally:
        loop.close()

@app.route('/phantom/scan', methods=['GET'])
def scan_devices():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        address = loop.run_until_complete(phantom.scan_for_phantom())
        return jsonify({'found': address is not None, 'address': address})
    finally:
        loop.close()

if __name__ == '__main__':
    print("🚀 Démarrage du pont Phantom...")
    print("📡 API disponible sur http://localhost:5000")
    print("🔗 Endpoints:")
    print("   GET  /phantom/status")
    print("   POST /phantom/connect")
    print("   POST /phantom/move {'from': 'e2', 'to': 'e4'}")
    print("   POST /phantom/sync {'fen': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}")
    print("   GET  /phantom/scan")
    
    app.run(host='localhost', port=5000, debug=True)