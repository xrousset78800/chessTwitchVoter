from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import random

app = Flask(__name__)
CORS(app)

class PhantomSimulator:
    def __init__(self):
        self.is_connected = False
        self.battery_level = 87  # Simulation
        self.last_status = "Ready"
        self.last_move = ""
        self.move_count = 0
        self.position = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        
    def connect(self):
        print("🎮 SIMULATION: Connexion au Phantom...")
        time.sleep(1)  # Simulation délai
        self.is_connected = True
        print("✅ SIMULATION: Phantom connecté !")
        return True
    
    def disconnect(self):
        print("👋 SIMULATION: Déconnexion Phantom")
        self.is_connected = False
    
    def send_move(self, from_sq, to_sq):
        if not self.is_connected:
            return False
            
        move = f"{from_sq}-{to_sq}"
        self.last_move = move
        self.move_count += 1
        
        print(f"🎯 SIMULATION: Coup reçu {move}")
        print(f"    → Déplacement pièce de {from_sq} vers {to_sq}")
        print(f"    → Mouvement {self.move_count} exécuté")
        
        # Simulation d'une réponse du plateau
        self.last_status = f"Move completed: {move}"
        
        # Simuler une baisse de batterie
        if self.move_count % 10 == 0:
            self.battery_level = max(10, self.battery_level - 1)
            
        return True
    
    def sync_position(self, fen):
        if not self.is_connected:
            return False
            
        self.position = fen
        print(f"🔄 SIMULATION: Position synchronisée")
        print(f"    → FEN: {fen[:50]}...")
        
        self.last_status = "Position synchronized"
        return True

# Instance globale
phantom_sim = PhantomSimulator()

# API Routes (identiques au vrai pont)
@app.route('/phantom/status', methods=['GET'])
def get_status():
    return jsonify({
        'connected': phantom_sim.is_connected,
        'battery': phantom_sim.battery_level,
        'last_status': phantom_sim.last_status,
        'address': 'SIM:00:11:22:33:44:55',
        'last_move': phantom_sim.last_move,
        'move_count': phantom_sim.move_count,
        'mode': 'SIMULATOR'
    })

@app.route('/phantom/connect', methods=['POST'])
def connect_phantom():
    success = phantom_sim.connect()
    return jsonify({'success': success})

@app.route('/phantom/disconnect', methods=['POST'])
def disconnect_phantom():
    phantom_sim.disconnect()
    return jsonify({'success': True})

@app.route('/phantom/move', methods=['POST'])
def send_move():
    data = request.get_json()
    if not data or 'from' not in data or 'to' not in data:
        return jsonify({'error': 'Missing from/to parameters'}), 400
    
    success = phantom_sim.send_move(data['from'], data['to'])
    return jsonify({'success': success})

@app.route('/phantom/sync', methods=['POST'])
def sync_position():
    data = request.get_json()
    if not data or 'fen' not in data:
        return jsonify({'error': 'Missing fen parameter'}), 400
    
    success = phantom_sim.sync_position(data['fen'])
    return jsonify({'success': success})

@app.route('/phantom/scan', methods=['GET'])
def scan_devices():
    print("📡 SIMULATION: Scan des appareils...")
    time.sleep(2)  # Simulation scan
    return jsonify({
        'found': True, 
        'address': 'SIM:00:11:22:33:44:55',
        'name': 'Phantom Simulator'
    })

@app.route('/phantom/demo', methods=['POST'])
def demo_sequence():
    """Démonstration automatique de coups"""
    if not phantom_sim.is_connected:
        return jsonify({'error': 'Not connected'}), 400
    
    demo_moves = [
        ('e2', 'e4'), ('e7', 'e5'),
        ('g1', 'f3'), ('b8', 'c6'),
        ('f1', 'b5'), ('a7', 'a6')
    ]
    
    print("🎭 SIMULATION: Démonstration automatique...")
    
    for i, (from_sq, to_sq) in enumerate(demo_moves):
        phantom_sim.send_move(from_sq, to_sq)
        time.sleep(0.5)  # Petit délai entre les coups
    
    return jsonify({'success': True, 'moves': len(demo_moves)})

if __name__ == '__main__':
    print("🎮 PHANTOM SIMULATOR")
    print("=" * 50)
    print("🚀 Mode développement - Pas besoin de Bluetooth !")
    print("📡 API disponible sur http://localhost:5000")
    print("")
    print("🎯 Endpoints identiques au vrai pont :")
    print("   GET  /phantom/status")
    print("   POST /phantom/connect")
    print("   POST /phantom/move")
    print("   POST /phantom/sync")
    print("   GET  /phantom/scan")
    print("   POST /phantom/demo  (bonus)")
    print("")
    print("💡 Les coups apparaîtront dans la console")
    print("🔄 Remplacez par phantom_bridge.py quand Bluetooth marche")
    
    app.run(host='localhost', port=5000, debug=False)