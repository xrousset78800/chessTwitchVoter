/***********************************************************************************************/
/***************************************   twitch chat  ****************************************/
/***********************************************************************************************/

// Called every time a message comes in
function onMessageHandler (target, context, msg, self) {

  if (self) { return; } // Ignore messages from the bot
  
  const args = msg.slice(1).split(' ');
  const commandName = args.shift().toLowerCase();
  
	switch(commandName) {
	  case 'help':
		getCommands(target);
		break;
	  case 'reload':
	  	if(probMode) {
			ReloadPgn(currentProbPgn, target, chess, context);			
		} else {
			client.say(target, `@${context.username} Reload is for prob mod`);
		}
		
		break;			
	  case 'moves':
		showAvailableMoves(target, chess, context);
		break;			
/*	  case 'team':
		getUserTeam(target, context);*/
	  case 'new':
		if(probMode) {
			location.reload();
		} else {
			client.say(target, `@${context.username} Please let them finish the game`);
		}
		break;
	  case 'p':
		//play(target, context, args);
		
		break;
	  default:
	  	let moves = chess.moves();
	  	console.log("opmg")
	  	if(moves.indexOf(msg) !== -1) {
			play(target, context, [msg]);
	  	}
	}
}

const cmds = [ 
		'!help > Affiche les commandes',
		'!new > Relance un nouveau problème',
		'!reload > Relance le problème',
		'!moves > Liste des coups légaux',
//		'!team > Voir equipe ',
//		'!p XXXX > pour voter pour un coup'
	]

function getCommands(target) {
    let msg = "";
	msg = `**** Liste des commandes ***** ********************************************** `;
	
    for(var i=0; i<cmds.length; i++) {
		msg += cmds[i]+' '+'_'.repeat(47-cmds[i].length)+' ';
    }
	//console.log(msg);
    client.say(target, `${msg}`);
}

function getUserTeam(target, context) {
	if (context['user-id'] % 2 == 1){
		//console.log("Team noire");
		client.say(target, `@${context.username}, you have black pieces`);
	} else {
		//console.log("Team blanche");
		client.say(target, `@${context.username}, you have white pieces`);
	}
}

// Called every time the bot connects to Twitch chat
function onConnectedHandler (addr, port) {
    console.log(`${addr}:${port} connected. `);
    
	messageInterval();
    setInterval(() => {
        messageInterval();
    }, 1800000);
}

function messageInterval() {
    client.say(opts.channels[0], `${cmds[0]} pour voir les commandes dispo.`);
}

function showAvailableMoves(target, chess, context) {
	let tempMoves = chess.moves().join(' - ').replace('#', '').replaceAll('+', '');
	
	//client.say(target, `@${context.username} Available moves : ${tempMoves}`);
	//console.log(chess.moves());
}

/***********************************************************************************************/
/***************************************   twitch chat  ****************************************/
/***********************************************************************************************/