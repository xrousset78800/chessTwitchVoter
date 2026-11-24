/**
 * Stats globales du 24/24 (onglet de la page Records) : résultats, décisions, ouvertures,
 * puzzle rush, votes d'options, joueurs, activité et dernières parties.
 */
const tr = (key, params, fb) => {
    const v = window.i18n?.t(key, params);
    return v && v !== key ? v : (fb ?? key);
};
const t = (key, params, fb) => tr(`h24stats.${key}`, params, fb);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lang = () => window.i18n?.locale?.() || 'fr-FR';
const fmtNum = (n) => Number(n || 0).toLocaleString(lang());
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString(lang(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
function fmtDur(ms) {
    const m = Math.round((ms || 0) / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h < 48 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${Math.round(h / 24)} j`;
}
const STORE = 'h24StatsFilter';

function choiceLabel(id, c) {
    if (id === 'mode') return tr(`h24.mode.${c}`, null, c);
    if (id === 'turn') return tr('h24.seconds', { n: c }, `${c} s`);
    if (id === 'decision') return tr(`h24.decision.${c}`, null, c);
    if (id === 'votes') return tr(Number(c) === 1 ? 'h24.votesOne' : 'h24.votesN', { n: c }, `${c}`);
    if (id === 'anonymity') return tr(`h24.anonymity.${c}`, null, c);
    if (id === 'spin') return tr(`h24.spin.${c}`, null, c);
    if (id === 'elo') return `Stockfish ${Number(c) >= 2400 ? '2400+' : c}`;
    return String(c);
}
function resultLabel(r) {
    if (!r) return '';
    if (r.kind === 'rush') return t('rushScore', { n: r.solved }, `${r.solved} puzzle(s)`);
    if (r.kind === 'mate') return tr(r.winner === 'w' ? 'h24.whiteWins' : 'h24.blackWins', null, r.winner === 'w' ? 'Victoire des Blancs' : 'Victoire des Noirs');
    return tr('h24.drawResult', null, 'Partie nulle') + (r.reason && r.reason !== 'draw' ? ` · ${tr(`h24.drawReason.${r.reason}`, null, r.reason)}` : '');
}

/** Liste de barres horizontales : [{ label, n, cls? }] */
function bars(items, { total, unit = '' } = {}) {
    if (!items.length) return `<p class="h24s-none">${esc(t('none', null, 'Pas encore de données'))}</p>`;
    const max = Math.max(...items.map(i => i.n), 1);
    return `<div class="h24s-bars">${items.map(i => `
        <div class="h24s-bar ${i.cls || ''}">
            <span class="h24s-bar__label">${i.html || esc(i.label)}</span>
            <span class="h24s-bar__track"><span style="width:${Math.max(2, (i.n / max) * 100)}%"></span></span>
            <span class="h24s-bar__value">${fmtNum(i.n)}${unit}${total ? ` <small>${pct(i.n, total)} %</small>` : ''}</span>
        </div>`).join('')}</div>`;
}
/** Petit histogramme vertical (activité) */
function columns(values, labels) {
    const max = Math.max(...values, 1);
    return `<div class="h24s-cols">${values.map((v, i) => `
        <div class="h24s-col" title="${esc(labels[i])} : ${fmtNum(v)}">
            <span class="h24s-col__bar" style="height:${v ? Math.max(4, (v / max) * 100) : 0}%"></span>
            <span class="h24s-col__label">${esc(labels[i])}</span>
        </div>`).join('')}</div>`;
}
const card = (title, body, cls = '') => `<section class="h24s-card ${cls}"><h3 class="h24s-card__title">${title}</h3>${body}</section>`;
const kv = (label, value) => `<div class="h24s-kv"><span>${esc(label)}</span><strong>${value}</strong></div>`;

const H24Stats = {
    filter: { days: 0, bots: true },
    bound: false,
    seq: 0,

    async load() {
        const box = document.getElementById('records-h24');
        if (!box) return;
        if (!this.bound) {
            this.bound = true;
            try { Object.assign(this.filter, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
            box.addEventListener('click', (e) => {
                const b = e.target.closest('[data-h24s-days], [data-h24s-bots]');
                if (!b) return;
                if (b.dataset.h24sDays != null) this.filter.days = Number(b.dataset.h24sDays);
                else this.filter.bots = !this.filter.bots;
                try { localStorage.setItem(STORE, JSON.stringify(this.filter)); } catch {}
                this.load();
            });
        }
        const seq = ++this.seq;
        if (!box.querySelector('.h24s-grid')) box.innerHTML = `<div class="rec-empty">${esc(t('loading', null, 'Chargement…'))}</div>`;
        try {
            const q = new URLSearchParams({ days: this.filter.days, bots: this.filter.bots ? 1 : 0, tz: new Date().getTimezoneOffset() });
            const r = await fetch(`/api/h24/stats?${q}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            if (seq === this.seq) box.innerHTML = this.html(data);
        } catch (e) {
            if (seq === this.seq) box.innerHTML = `<div class="rec-empty">${esc(t('unavailable', null, 'Stats indisponibles'))} (${esc(e.message)})</div>`;
        }
    },

    filters() {
        const f = this.filter;
        const days = [[0, t('all', null, 'Tout')], [30, t('d30', null, '30 jours')], [7, t('d7', null, '7 jours')], [1, t('d1', null, '24 h')]];
        return `<div class="h24s-filters">
            ${days.map(([d, l]) => `<button type="button" class="rec-chip${f.days === d ? ' is-active' : ''}" data-h24s-days="${d}">${esc(l)}</button>`).join('')}
            <button type="button" class="rec-chip${f.bots ? ' is-active' : ''}" data-h24s-bots><i class="fas fa-robot"></i> ${esc(t('withBots', null, 'Parties avec bots'))}</button>
        </div>`;
    },

    html(d) {
        const o = d.overview;
        const tiles = [
            ['♟', fmtNum(o.games), t('games', null, 'Parties')],
            ['🎯', fmtNum(Math.ceil(o.plies / 2)), t('moves', null, 'Coups joués')],
            ['🗳', fmtNum(o.votes), t('votes', null, 'Votes')],
            ['👥', fmtNum(o.players), t('players', null, 'Joueurs')],
            ['⏱', fmtDur(o.playMs), t('playTime', null, 'Temps de jeu')],
            ['👀', fmtNum(o.peak), t('peak', null, 'Pic de spectateurs')]
        ];
        const head = `${this.filters()}
            <div class="rec-tiles h24s-tiles">${tiles.map(([i, v, l]) => `<div class="rec-tile"><span class="rec-tile__icon">${i}</span>
                <span class="rec-tile__value">${v}</span><span class="rec-tile__label">${esc(l)}</span></div>`).join('')}</div>`;
        if (!o.games && !Object.keys(d.ballots || {}).length) {
            return `${head}<div class="rec-empty">${esc(t('empty', null, 'Aucune partie terminée pour l\'instant : les stats se remplissent à chaque fin de partie.'))}</div>`;
        }

        // Résultats (deux équipes)
        const r = d.results;
        const played = r.w + r.b + r.draw;
        const split = played ? `<div class="h24s-split">
            ${r.w ? `<span class="h24s-split__w" style="flex:${r.w}">${pct(r.w, played)} %</span>` : ''}
            ${r.draw ? `<span class="h24s-split__d" style="flex:${r.draw}">${pct(r.draw, played)} %</span>` : ''}
            ${r.b ? `<span class="h24s-split__b" style="flex:${r.b}">${pct(r.b, played)} %</span>` : ''}
        </div>
        <div class="h24s-legend"><span><i class="h24s-dot h24s-dot--w"></i>${esc(tr('h24.white', null, 'Blancs'))} ${fmtNum(r.w)}</span>
            <span><i class="h24s-dot h24s-dot--d"></i>${esc(t('draws', null, 'Nulles'))} ${fmtNum(r.draw)}</span>
            <span><i class="h24s-dot h24s-dot--b"></i>${esc(tr('h24.black', null, 'Noirs'))} ${fmtNum(r.b)}</span></div>` : '';
        const reasons = Object.entries(r.reasons || {}).sort((a, b) => b[1] - a[1])
            .map(([k, n]) => ({ label: tr(`h24.drawReason.${k}`, null, k), n }));
        const results = card(`<i class="fas fa-chess-king"></i> ${esc(t('results', null, 'Résultats'))}`, played ? `${split}
            ${kv(t('avgLength', null, 'Durée moyenne'), `${fmtNum(Math.ceil(r.avgPlies / 2))} ${esc(t('movesShort', null, 'coups'))} · ${fmtDur(r.avgMs)}`)}
            ${r.longest ? kv(t('longest', null, 'Plus longue partie'), `${fmtNum(Math.ceil(r.longest.plies / 2))} ${esc(t('movesShort', null, 'coups'))}`) : ''}
            ${r.fastestMate ? kv(t('fastestMate', null, 'Mat le plus rapide'), `${fmtNum(Math.ceil(r.fastestMate.plies / 2))} ${esc(t('movesShort', null, 'coups'))} · ${esc(tr(r.fastestMate.winner === 'w' ? 'h24.white' : 'h24.black'))}`) : ''}
            ${reasons.length ? `<p class="h24s-sub">${esc(t('drawReasons', null, 'Raisons des nulles'))}</p>${bars(reasons, { total: r.draw })}` : ''}`
            : `<p class="h24s-none">${esc(t('noTeams', null, 'Aucune partie à deux équipes terminée'))}</p>`);

        // Décisions
        const dc = d.decisions;
        const decisions = card(`<i class="fas fa-dice"></i> ${esc(t('decisions', null, 'Décisions'))}`, dc.turns ? `
            ${bars([{ label: tr('h24.decision.majority', null, 'Majorité'), n: dc.majority }, { label: tr('h24.decision.draw', null, 'Tirage au sort'), n: dc.draw }], { total: dc.majority + dc.draw })}
            ${dc.consensus != null ? kv(t('consensus', null, 'Part moyenne du coup joué'), `${dc.consensus} %`) : ''}
            ${kv(t('randomMoves', null, 'Coups au hasard (personne n\'a voté)'), `${fmtNum(dc.random)} <small>${pct(dc.random, dc.turns)} %</small>`)}
            ${kv(t('ties', null, 'Égalités départagées'), fmtNum(dc.ties))}
            ${kv(t('wheels', null, 'Tirages à la roue'), fmtNum(dc.wheel))}`
            : `<p class="h24s-none">${esc(t('none', null, 'Pas encore de données'))}</p>`);

        // Puzzle rush
        const ru = d.rush;
        const rush = card(`<i class="fas fa-bolt"></i> Puzzle rush`, ru.games ? `
            ${kv(t('rushGames', null, 'Rush joués'), fmtNum(ru.games))}
            ${ru.best ? kv(t('rushBest', null, 'Meilleur rush'), `${fmtNum(ru.best.solved)} ${esc(t('puzzles', null, 'puzzles'))}${ru.best.maxRating ? ` · ${ru.best.maxRating}` : ''}`) : ''}
            ${kv(t('rushAvg', null, 'Moyenne par rush'), `${ru.avgSolved} ${esc(t('puzzles', null, 'puzzles'))}`)}
            ${ru.bestRating ? kv(t('rushRating', null, 'Puzzle le plus dur résolu'), fmtNum(ru.bestRating)) : ''}`
            : `<p class="h24s-none">${esc(t('noRush', null, 'Aucun rush terminé'))}</p>`);

        // Contre Stockfish : bilan par niveau
        const vs = d.vsBot || { games: 0, levels: [] };
        const lvl = (elo) => (Number(elo) >= 2400 ? '2400+' : String(elo));
        const vsCard = card(`<i class="fas fa-robot"></i> ${esc(t('vsBot', null, 'Contre Stockfish'))}`, vs.levels.length ? `
            ${vs.bestBeaten ? kv(t('vsBest', null, 'Plus haut niveau battu'), `Stockfish ${esc(lvl(vs.bestBeaten.elo))}`) : kv(t('vsBest', null, 'Plus haut niveau battu'), esc(t('vsNoWin', null, 'Aucun pour l\'instant')))}
            <table class="h24s-vs"><thead><tr><th>${esc(t('vsLevel', null, 'Niveau'))}</th><th>${esc(t('games', null, 'Parties'))}</th>
                <th class="h24s-vs__w">${esc(t('vsWin', null, 'Victoires'))}</th><th>${esc(t('draws', null, 'Nulles'))}</th><th class="h24s-vs__l">${esc(t('vsLoss', null, 'Défaites'))}</th></tr></thead>
            <tbody>${vs.levels.map(l => `<tr><td>${esc(lvl(l.elo))}</td><td>${fmtNum(l.games)}</td>
                <td class="h24s-vs__w">${fmtNum(l.win)} <small>${pct(l.win, l.games)} %</small></td><td>${fmtNum(l.draw)}</td><td class="h24s-vs__l">${fmtNum(l.loss)}</td></tr>`).join('')}</tbody></table>`
            : `<p class="h24s-none">${esc(t('vsNone', null, 'Aucune partie contre Stockfish terminée'))}</p>`);

        // Votes d'options
        const order = ['mode', 'elo', 'turn', 'decision', 'spin', 'votes', 'anonymity'];
        const titles = { elo: tr('h24.ballot.elo', null, 'Niveau de Stockfish'), mode: tr('h24.ballot.mode', null, 'Mode'), turn: tr('h24.ballot.turn', null, 'Temps par coup'), decision: tr('h24.ballot.decision', null, 'Décision'),
            spin: tr('h24.ballot.spin', null, 'Roue'), votes: tr('h24.ballot.votes', null, 'Votes par joueur'), anonymity: tr('h24.ballot.anonymity', null, 'Votes') };
        const ballots = order.filter(id => d.ballots?.[id]).map(id => {
            const b = d.ballots[id];
            const items = Object.entries(b.counts).sort((a, c) => c[1] - a[1]).map(([k, n]) => ({ label: choiceLabel(id, k), n }));
            return `<div class="h24s-ballot"><p class="h24s-sub">${esc(titles[id] || id)} <small>${fmtNum(b.total)} ${esc(t('ballotsN', null, 'votes'))}${b.none ? ` · ${pct(b.none, b.total)} % ${esc(t('noVoter', null, 'sans votant'))}` : ''}</small></p>${bars(items, { total: b.total })}</div>`;
        }).join('');
        const ballotCard = card(`<i class="fas fa-sliders-h"></i> ${esc(t('ballots', null, 'Choix de la communauté'))}`, ballots || `<p class="h24s-none">${esc(t('none', null, 'Pas encore de données'))}</p>`, 'h24s-card--wide');

        // Joueurs
        const rank = (list, unit) => list.length ? `<ol class="h24s-rank">${list.map((p, i) => `<li><span class="h24s-rank__i">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
            <span class="h24s-rank__name">${esc(p.k)}</span><strong>${fmtNum(p.n)}</strong>${unit ? ` <small>${esc(unit)}</small>` : ''}</li>`).join('')}</ol>`
            : `<p class="h24s-none">${esc(t('none', null, 'Pas encore de données'))}</p>`;
        const pl = d.players;
        const playersCard = card(`<i class="fas fa-users"></i> ${esc(t('playersTitle', null, 'Joueurs'))}`, `<div class="h24s-ranks">
            <div><p class="h24s-sub">${esc(t('topVoters', null, 'Plus gros votants'))}</p>${rank(pl.voters)}</div>
            <div><p class="h24s-sub">${esc(t('topWinners', null, 'Le plus de victoires'))}</p>${rank(pl.winners)}</div>
            <div><p class="h24s-sub">${esc(t('topPlayed', null, 'Le plus de parties'))}</p>${rank(pl.played)}</div>
            <div><p class="h24s-sub">${esc(t('topHits', null, 'Meilleur flair (coups retenus)'))}</p>${rank(pl.hits || [])}</div>
        </div><p class="h24s-note">${esc(t('botsExcluded', null, 'Les bots de test ne sont jamais classés.'))}</p>`, 'h24s-card--wide');

        // Activité
        const dayLabels = d.activity.days.map((_, i) => {
            const dt = new Date(Date.now() - (13 - i) * 86400000);
            return dt.toLocaleDateString(lang(), { day: '2-digit', month: '2-digit' });
        });
        const activity = card(`<i class="fas fa-chart-bar"></i> ${esc(t('activity', null, 'Activité'))}`, `
            <p class="h24s-sub">${esc(t('byHour', null, 'Parties par heure'))}</p>${columns(d.activity.hours, d.activity.hours.map((_, h) => `${h}h`))}
            <p class="h24s-sub">${esc(t('byDay', null, 'Parties par jour (14 derniers jours)'))}</p>${columns(d.activity.days, dayLabels)}`, 'h24s-card--wide');

        // Dernières parties
        const recent = card(`<i class="fas fa-history"></i> ${esc(t('recent', null, 'Dernières parties'))}`, d.recent.length ? `<div class="h24s-recent">${d.recent.map(g => `
            <div class="h24s-game h24s-game--${g.result?.kind === 'mate' ? g.result.winner : g.result?.kind || 'draw'}">
                <span class="h24s-game__mode"><i class="fas ${g.mode === 'rush' ? 'fa-bolt' : g.mode === 'bot' ? 'fa-robot' : 'fa-chess'}"></i></span>
                <span class="h24s-game__res">${esc(resultLabel(g.result))}</span>
                <span class="h24s-game__meta">${g.vs ? `Stockfish ${Number(g.vs.elo) >= 2400 ? '2400+' : g.vs.elo} · ` : ''}${g.mode === 'teams' ? `${fmtNum(Math.ceil(g.plies / 2))} ${esc(t('movesShort', null, 'coups'))} · ` : ''}${fmtDur(g.ms)} · ${fmtNum(g.players)} ${esc(t('playersShort', null, 'joueurs'))}${g.bots ? ` · <i class="fas fa-robot" title="${esc(t('withBots', null, 'Parties avec bots'))}"></i>` : ''}</span>
                <span class="h24s-game__at">${esc(fmtDate(g.at))}</span>
            </div>`).join('')}</div>` : `<p class="h24s-none">${esc(t('none', null, 'Pas encore de données'))}</p>`, 'h24s-card--wide');

        const since = d.since ? `<p class="rec-hint">${esc(t('since', { d: new Date(d.since).toLocaleDateString(lang()) }, `Depuis le ${new Date(d.since).toLocaleDateString(lang())}`))}</p>` : '';
        return `${head}${since}<div class="h24s-grid">${results}${decisions}${vsCard}${rush}${ballotCard}${playersCard}${activity}${recent}</div>`;
    }
};

export default H24Stats;
