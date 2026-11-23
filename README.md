# Crowd Gambit

Échecs interactifs pilotés par le chat Twitch : le chat vote les coups, l'échiquier
Phantom (optionnel) les rejoue physiquement.

## Lancer en local

```
npm install
node --watch server.js
```

Puis ouvrir http://localhost:3000.

- `--watch` redémarre le serveur quand `server.js` change. Les fichiers `js/` et `css/`
  sont servis statiquement : un rechargement du navigateur suffit (Ctrl+F5 si cache).
- Le serveur Express est obligatoire (Socket.IO pour la Bataille Twitch et la page
  Parcourir). Ne pas utiliser `http-server`.

## Connexion Twitch

La connexion passe par OAuth (implicit grant, 100 % navigateur, aucun scope demandé).
Le login Twitch de l'utilisateur devient sa chaîne : le chat est rejoint automatiquement
et sert d'identité pour les records.

Le Client ID de l'application Twitch est défini dans `js/core/twitchAuth.js`.
L'URL de redirection enregistrée dans la console développeur Twitch doit correspondre
exactement à l'URL de la page, par exemple `http://localhost:3000/` en développement.

## Puzzle Rush

Mode solo configurable dans **Nouveau** (carte « Puzzle Rush ») : le chat enchaîne des
puzzles Lichess de difficulté croissante, toujours par vote à la majorité. Un mauvais coup,
ou aucun vote avant la fin du timer, compte comme une erreur ; à la troisième le run s'arrête.

- Options : rating de départ (défaut 600, +60 par puzzle résolu) et pause entre puzzles.
- Le score est envoyé au serveur (`POST /api/rush/records`) si l'utilisateur est connecté
  avec Twitch. Le serveur vérifie le token auprès de Twitch et n'accepte que ceux émis pour
  notre Client ID : la chaîne enregistrée est toujours celle du token.
- Les records sont stockés dans `data/rush-records.json` (dossier ignoré par git, un
  enregistrement par chaîne) et affichés dans **Parcourir**, carte « Puzzle Rush » à côté de Créer / Rejoindre. Le bouton « Lancer un run » (rating de départ, pause) démarre directement sur la route `#/game` : même échiquier que Nouveau, sans aucun réglage.
- Variables d'environnement : `TWITCH_CLIENT_ID` (sinon la valeur du code) et `DATA_DIR`
  (sinon `./data`).

## Routes préconfigurées

Trois routes du menu lancent une partie sans passer par les réglages. Elles demandent une connexion Twitch : la chaîne du compte connecté est celle qui joue.

- **`#/rush`** : Puzzle Rush, rating de départ et pause, records des chaînes.
- **`#/mono`** : une chaîne. Le chat s'inscrit pendant 2 minutes en tapant `join` ou `!join`, puis la partie démarre. Deux formats :
  - le streamer joue sur l'échiquier (Blancs, Noirs ou au hasard) contre les inscrits, qui votent pour l'autre camp ;
  - les inscrits sont répartis au hasard en deux équipes.
- **`#/multi`** : deux chaînes. Le formulaire crée un lien `#/multi/<blancs>/<noirs>?timer=30&mode=wheel` à envoyer à l'autre streamer. Les 2 minutes d'inscription démarrent quand les deux sont sur le lien. Seuls ces deux comptes peuvent y entrer : le serveur vérifie le token Twitch.

Options communes : temps de vote, roue ou majorité, subs only, followers only. Seuls les inscrits du camp au trait votent, une fois par coup. Le panneau « Joueurs inscrits » permet de retirer ou d'ajouter un joueur pendant la partie.

« Followers only » est vérifié à l'inscription auprès de Twitch (`GET /helix/channels/followers`), avec le token du streamer et le scope `moderator:read:followers`. Un compte connecté avant l'ajout de ce scope doit se reconnecter. Les subs, modos et VIP sont exemptés, comme dans le mode followers du chat. Si Twitch ne répond pas, l'inscription passe et le streamer est averti. Hors de ces routes, l'option reste sans vérification : il faut activer le mode followers dans le chat Twitch.

`MULTI_LOBBY_MS` change la durée du salon multi côté serveur (120000 par défaut).

## Tester sans Twitch

Dans **Nouveau**, activer le vote puis cliquer sur des coups dans le panneau
« Coups disponibles » : chaque clic compte comme un vote d'un joueur de test.
