/**
 * Gestionnaire pour les messages Twitch en mode multiplayer
 * À appeler depuis onMessageHandler dans client.js
 */
function handleChatMessage(channel, tags, message, self) {
    // Ignorer ses propres messages
    if (self) return;
    
    // Vérifier qu'on est en mode multiplayer
    if (!window.multiplayerManager || !window.multiplayerManager.gameId) {
        return; // Pas en mode multiplayer, ignorer
    }
    
    // Déterminer l'équipe du message selon le canal
    let team = null;
    const currentChannel = channel.replace('#', '').toLowerCase();
    
    if (window.streamer1Channel && window.streamer1Channel.toLowerCase() === currentChannel) {
        team = 'white';
    } else if (window.streamer2Channel && window.streamer2Channel.toLowerCase() === currentChannel) {
        team = 'black';
    }
    
    // Créer l'objet message
    const messageData = {
        author: tags['display-name'] || tags.username,
        content: message,
        timestamp: Date.now(),
        badges: tags.badges || {},
        color: tags.color || '#ffffff',
        team: team,
        channel: currentChannel
    };
    
    // Envoyer au serveur multiplayer
    window.multiplayerManager.sendChatMessage(messageData);
    
    // Log pour debug
    console.log(`💬 [${team || 'unknown'}] ${messageData.author}: ${message}`);
}

// Rendre la fonction globale
window.handleChatMessage = handleChatMessage;