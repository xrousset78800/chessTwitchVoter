/**
 * Page Records : Puzzle Rush (podium, fiche de la chaîne, progression),
 * batailles Multi (classement, duels) et viewers les plus actifs de chaque chat.
 */
import H24Stats from './h24Stats.js';

const t = (key, params) => window.i18n?.t(`records.${key}`, params) ?? key;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lang = () => (window.i18n?.currentLang === 'en' ? 'en-US' : 'fr-FR');
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString(lang(), { day: '2-digit', month: 'short' }) : '');
const fmtNum = (n) => Number(n || 0).toLocaleString(lang());
const me = () => (window.twitchAuth?.user?.login || '').toLowerCase();
const STORE_TAB = 'records_tab';

async function getJson(url) {
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

function avatar(p, cls = 'rec-avatar') {
    const name = p.displayName || p.name || p.login || '?';
    return p.avatar
        ? `<img class="${cls}" src="${esc(p.avatar)}" alt="" loading="lazy">`
        : `<span class="${cls}">${esc(name[0].toUpperCase())}</span>`;
}

const profileHref = (login) => `#/records?c=${encodeURIComponent(String(login || '').toLowerCase())}`;
const twitchIcon = (login) => `<a class="rec-twitch" href="https://twitch.tv/${esc(login)}" target="_blank" rel="noopener" aria-label="Twitch" title="twitch.tv/${esc(login)}"><i class="fab fa-twitch"></i></a>`;
/** Nom de chaîne : ouvre sa fiche dans Records (petit lien Twitch à côté) */
const channelLink = (p) => `<a href="${profileHref(p.login)}" class="rec-link">${esc(p.displayName || p.login)}</a>${twitchIcon(p.login)}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const RUSH_MODES = ['0', '30', '60', '120'];
const modeLabel = (k) => (k === '0' ? t('modeUnlimited') : k === '60' ? '1 min' : k === '120' ? '2 min' : '30 s');
const currentChannel = () => {
    const q = window.location.hash.split('?')[1] || '';
    const c = new URLSearchParams(q).get('c');
    return c && /^[a-z0-9_]{1,25}$/i.test(c) ? c.toLowerCase() : null;
};
const empty = (msg) => `<div class="rec-empty">${msg}</div>`;
const failed = (e) => empty(`${esc(t('unavailable'))} (${esc(e.message)})`);

/** Petite courbe SVG des derniers scores */
function sparkline(history) {
    if (!history || history.length < 2) return '';
    const w = 160, h = 40, pad = 4;
    const max = Math.max(...history.map(p => p.score), 1);
    const step = (w - pad * 2) / (history.length - 1);
    const pts = history.map((p, i) => `${(pad + i * step).toFixed(1)},${(h - pad - (p.score / max) * (h - pad * 2)).toFixed(1)}`);
    const last = pts[pts.length - 1].split(',');
    return `<svg class="rec-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t('progress'))}">
        <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="currentColor"/></svg>`;
}

const RecordsPage = {
    initialized: false,
    tab: 'rush',
    rushMode: '0',
    viewerChannel: null,
    viewerSort: 'votes',
    openDuel: null,

    init() {
        if (!this.initialized) {
            this.initialized = true;
            const page = document.getElementById('page-records');
            page.querySelectorAll('[data-records-tab]').forEach(b =>
                b.addEventListener('click', () => this.showTab(b.dataset.recordsTab)));
            document.getElementById('records-refresh')?.addEventListener('click', () => this.load(true));
            document.getElementById('records-rush-modes')?.addEventListener('click', (e) => {
                const b = e.target.closest('[data-rush-mode]');
                if (!b) return;
                this.rushMode = b.dataset.rushMode;
                this.loadRush();
            });
            document.getElementById('records-viewer-sort')?.addEventListener('click', (e) => {
                const b = e.target.closest('[data-sort]');
                if (!b) return;
                this.viewerSort = b.dataset.sort;
                this.loadViewers();
            });
            document.getElementById('records-channels')?.addEventListener('click', (e) => {
                const b = e.target.closest('[data-channel]');
                if (!b) return;
                this.viewerChannel = b.dataset.channel;
                this.loadViewers();
            });
            document.getElementById('records-channel-search')?.addEventListener('submit', (e) => {
                e.preventDefault();
                const v = e.target.querySelector('input').value.trim().toLowerCase();
                if (!v) return;
                this.viewerChannel = v;
                this.loadViewers();
            });
            document.getElementById('records-multi-list')?.addEventListener('click', (e) => {
                const row = e.target.closest('[data-duel]');
                if (!row || e.target.closest('a')) return;
                this.toggleDuels(row.dataset.duel);
            });
            window.addEventListener('languageChanged', () => {
                if (!document.getElementById('page-records').classList.contains('is-active')) return;
                if (this.channel) this.loadChannel(this.channel); else this.load();
            });
            window.addEventListener('twitchAuthChange', () => { this.viewerChannel = null; });
            try { this.tab = localStorage.getItem(STORE_TAB) || 'rush'; } catch {}
            this.bindSearch();
        }
        // #/records?c=<login> : fiche détaillée d'une chaîne
        const channel = currentChannel();
        this.channel = channel;
        document.getElementById('records-main').hidden = !!channel;
        document.getElementById('records-channel').hidden = !channel;
        if (channel) {
            this.loadChannel(channel);
            return;
        }
        this.showTab(this.tab);
        this.load();
    },

    // ========== RECHERCHE ==========

    bindSearch() {
        const input = document.getElementById('records-search');
        const list = document.getElementById('records-suggest');
        if (!input || !list) return;
        let timer = null, seq = 0, active = -1, items = [];

        const close = () => {
            list.hidden = true;
            list.innerHTML = '';
            input.setAttribute('aria-expanded', 'false');
            active = -1;
        };
        const open = (login) => {
            close();
            input.value = '';
            input.blur();
            window.location.hash = profileHref(login);
        };
        const mark = () => list.querySelectorAll('[role=option]').forEach((li, i) => {
            li.classList.toggle('is-active', i === active);
            li.setAttribute('aria-selected', i === active);
        });
        const render = (q) => {
            const badges = (c) => [c.rush && '🔥', c.multi && '⚔', c.viewers && '💬'].filter(Boolean).join(' ');
            list.innerHTML = items.length
                ? items.map((c, i) => `<li role="option" id="rec-sug-${i}" data-login="${esc(c.login)}" aria-selected="false">
                    ${avatar(c, 'rec-avatar rec-avatar--sm')}<span class="rec-suggest__name">${esc(c.displayName)}</span>
                    <span class="rec-suggest__badges">${badges(c)}</span></li>`).join('')
                : `<li class="rec-suggest__empty">${esc(t('searchEmpty', { q }))}</li>`;
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            active = -1;
        };
        const search = async () => {
            const q = input.value.trim().toLowerCase();
            const mine = ++seq;
            if (!q) { close(); return; }
            try {
                const data = await getJson(`/api/channels/search?q=${encodeURIComponent(q)}`);
                if (mine !== seq) return;
                items = data?.channels || [];
                render(q);
            } catch {
                if (mine === seq) close();
            }
        };

        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 180); });
        input.addEventListener('focus', () => { if (input.value.trim()) search(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!items.length || list.hidden) return;
                e.preventDefault();
                active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                mark();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const pick = items[active] || items[0];
                const typed = input.value.trim().toLowerCase();
                if (pick) open(pick.login);
                else if (/^[a-z0-9_]{2,25}$/.test(typed)) open(typed);
            } else if (e.key === 'Escape') {
                close();
            }
        });
        list.addEventListener('mousedown', (e) => {
            const li = e.target.closest('[data-login]');
            if (!li) return;
            e.preventDefault();
            open(li.dataset.login);
        });
        input.addEventListener('blur', () => setTimeout(close, 120));
    },

    // ========== FICHE D'UNE CHAÎNE ==========

    async loadChannel(login) {
        const box = document.getElementById('records-channel');
        box.innerHTML = `<div class="rec-empty">${esc(t('loading'))}</div>`;
        try {
            const [rush, multi, viewers] = await Promise.all([
                getJson(`/api/rush/channel/${encodeURIComponent(login)}`),
                getJson(`/api/multi/channel/${encodeURIComponent(login)}`),
                getJson(`/api/viewers/${encodeURIComponent(login)}?sort=votes&limit=10`)
            ]);
            if (login !== this.channel) return;
            box.innerHTML = this.renderProfile(login, rush, multi, viewers);
        } catch (e) {
            if (login === this.channel) box.innerHTML = this.profileBack() + failed(e);
        }
    },

    profileBack() {
        return `<a class="btn btn--sm btn--ghost rec-profile__back" href="#/records"><i class="fas fa-arrow-left"></i> ${esc(t('profileBack'))}</a>`;
    },

    renderProfile(login, rush, multi, viewers) {
        const who = rush || multi || viewers?.channel || { login, displayName: login };
        const isMe = login === me();
        const head = `${this.profileBack()}
            <div class="rec-profile__head">
                ${avatar(who, 'rec-avatar rec-avatar--xl')}
                <div class="rec-profile__id">
                    <h2 class="rec-profile__name">${esc(who.displayName || login)}${isMe ? ` <span class="rec-chip is-active">${esc(t('itsYou'))}</span>` : ''}</h2>
                    <a class="rec-profile__twitch" href="https://twitch.tv/${esc(login)}" target="_blank" rel="noopener"><i class="fab fa-twitch"></i> twitch.tv/${esc(login)}</a>
                </div>
            </div>`;
        if (!rush && !multi && !viewers) return head + empty(esc(t('profileNoData', { name: who.displayName || login })));
        return head + `<div class="rec-profile__grid">
            ${this.profileRush(rush)}
            ${this.profileMulti(login, multi)}
            ${this.profileViewers(viewers)}
        </div>`;
    },

    profileRush(rush) {
        const modes = RUSH_MODES.filter(k => rush?.modes?.[k]);
        if (!modes.length) return `<section class="rec-card"><h3 class="rec-card__title">🔥 Puzzle Rush</h3>${empty(esc(t('profileNoRush')))}</section>`;
        const totalRuns = modes.reduce((n, k) => n + (rush.modes[k].runs || 0), 0);
        const bestRating = Math.max(...modes.map(k => rush.modes[k].best?.maxRating || 0));
        return `<section class="rec-card">
            <h3 class="rec-card__title">🔥 Puzzle Rush <small>${esc(t('runs', { n: totalRuns }))} · ${esc(t('ratingMax', { n: bestRating || '—' }))}</small></h3>
            <div class="rec-modes">${modes.map(k => {
                const m = rush.modes[k];
                const last = m.history?.length ? m.history[m.history.length - 1] : null;
                const avg = m.history?.length ? Math.round(m.history.reduce((s, h) => s + (h.score || 0), 0) / m.history.length) : null;
                return `<div class="rec-mode">
                    <div class="rec-mode__head"><span class="rec-chip">${esc(modeLabel(k))}</span>
                        <span class="rec-mode__rank">#${m.rank} <small>${esc(t('ofTotal', { n: m.total }))}</small></span></div>
                    <div class="rec-mode__stats">
                        <div><b>${m.best.score}</b><small>${esc(t('best'))}</small></div>
                        <div><b>${m.best.maxRating || '—'}</b><small>${esc(t('ratingLabel'))}</small></div>
                        <div><b>${m.runs || 1}</b><small>${esc(t('runsLabel'))}</small></div>
                        <div><b>${avg ?? '—'}</b><small>${esc(t('avgScore'))}</small></div>
                    </div>
                    ${sparkline(m.history)}
                    <div class="rec-mode__foot">${esc(t('bestOn', { date: fmtDate(m.best.at) }))}${last ? ` · ${esc(t('lastScore', { n: last.score }))}` : ''}</div>
                </div>`;
            }).join('')}</div>
        </section>`;
    },

    profileMulti(login, multi) {
        if (!multi) return `<section class="rec-card"><h3 class="rec-card__title">⚔ ${esc(t('tabMultiFull'))}</h3>${empty(esc(t('profileNoMulti')))}</section>`;
        const rate = pct(multi.w, multi.games);
        const recent = (multi.recent || []).map(g => {
            const color = g.white === login ? 'white' : 'black';
            const opp = color === 'white' ? g.blackProfile : g.whiteProfile;
            const res = g.result === 'draw' ? 'd' : g.result === color ? 'w' : 'l';
            return `<div class="rec-game rec-game--${res}">
                <span class="rec-game__res">${esc(t(res))}</span>
                ${avatar(opp, 'rec-avatar rec-avatar--sm')}
                <span class="rec-game__name">${esc(t('vs'))} ${channelLink(opp)} <small>${esc(t(color === 'white' ? 'asWhite' : 'asBlack'))}</small></span>
                <span class="rec-game__meta">${esc(t('reason_' + g.reason))} · ${esc(t('moves', { n: Math.ceil((g.moves || 0) / 2) }))} · ${fmtDate(g.at)}</span>
            </div>`;
        }).join('');
        const opponents = (multi.opponents || []).map(o => `
            <div class="rec-duel">${avatar(o, 'rec-avatar rec-avatar--sm')}
                <span class="rec-duel__name">${channelLink(o)}</span>
                <span class="rec-duel__score"><span class="rec-w">${o.w}</span>–<span class="rec-d">${o.d}</span>–<span class="rec-l">${o.l}</span></span>
            </div>`).join('');
        return `<section class="rec-card">
            <h3 class="rec-card__title">⚔ ${esc(t('tabMultiFull'))} <small>#${multi.rank} ${esc(t('ofTotal', { n: multi.total }))}</small></h3>
            <div class="rec-mode__stats">
                <div><b>${multi.points}</b><small>${esc(t('pts'))}</small></div>
                <div><b class="rec-w">${multi.w}</b><small>${esc(t('wins'))}</small></div>
                <div><b class="rec-d">${multi.d}</b><small>${esc(t('draws'))}</small></div>
                <div><b class="rec-l">${multi.l}</b><small>${esc(t('losses'))}</small></div>
            </div>
            <div class="rec-wdl" title="${esc(t('winRate', { n: rate }))}">
                <span class="rec-wdl__w" style="flex:${multi.w}"></span><span class="rec-wdl__d" style="flex:${multi.d}"></span><span class="rec-wdl__l" style="flex:${multi.l}"></span>
            </div>
            <div class="rec-mode__foot">${esc(t('winRate', { n: rate }))} · ${esc(t('battles', { n: multi.games }))}</div>
            ${opponents ? `<h4 class="rec-card__sub">${esc(t('opponents'))}</h4>${opponents}` : ''}
            ${recent ? `<h4 class="rec-card__sub">${esc(t('recent'))}</h4>${recent}` : ''}
        </section>`;
    },

    profileViewers(data) {
        if (!data) return `<section class="rec-card"><h3 class="rec-card__title">💬 ${esc(t('tabViewers'))}</h3>${empty(esc(t('profileNoViewers')))}</section>`;
        const c = data.channel;
        const top = data.viewers || [];
        const avgVoters = c.turns ? (c.votes / c.turns) : 0;
        const fmt1 = (n) => n.toLocaleString(lang(), { maximumFractionDigits: 1 });
        const sharpest = top.filter(v => v.votes >= 5).sort((a, b) => (b.picked / b.votes) - (a.picked / a.votes))[0];
        const max = Math.max(...top.map(v => v.votes), 1);
        return `<section class="rec-card">
            <h3 class="rec-card__title">💬 ${esc(t('tabViewers'))}</h3>
            <div class="rec-mode__stats">
                <div><b>${fmtNum(c.viewers)}</b><small>${esc(t('viewersLabel'))}</small></div>
                <div><b>${fmtNum(c.votes)}</b><small>${esc(t('colVotes'))}</small></div>
                <div><b>${fmtNum(c.turns)}</b><small>${esc(t('turnsLabel'))}</small></div>
                <div><b>${fmt1(avgVoters)}</b><small>${esc(t('avgVoters'))}</small></div>
            </div>
            ${sharpest ? `<div class="rec-mode__foot">🎯 ${esc(t('sharpest', { name: sharpest.name, n: pct(sharpest.picked, sharpest.votes) }))}</div>` : ''}
            ${top.length ? `<h4 class="rec-card__sub">${esc(t('topViewers'))}</h4>
            <div class="rec-table rec-table--compact">
                <div class="rec-table__head"><span>#</span><span>${esc(t('viewer'))}</span>
                    <span>${esc(t('colVotes'))}</span><span>${esc(t('colPicked'))}</span><span>${esc(t('colSolved'))}</span></div>
                ${top.map((v, i) => `<div class="rec-table__row">
                    <span class="rec-row__rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
                    <span class="rec-table__name">${esc(v.name)}<span class="rec-bar"><span style="width:${Math.round((v.votes / max) * 100)}%"></span></span></span>
                    <span>${fmtNum(v.votes)}</span>
                    <span>${fmtNum(v.picked)} <small>${pct(v.picked, v.votes)} %</small></span>
                    <span>${v.puzzles ? `${fmtNum(v.solved)}<small>/${fmtNum(v.puzzles)}</small>` : '—'}</span>
                </div>`).join('')}
            </div>` : empty(esc(t('noVotes')))}
        </section>`;
    },

    showTab(tab) {
        if (!['rush', 'multi', 'viewers', 'h24'].includes(tab)) tab = 'rush';
        this.tab = tab;
        try { localStorage.setItem(STORE_TAB, tab); } catch {}
        document.querySelectorAll('#page-records [data-records-tab]').forEach(b => {
            const on = b.dataset.recordsTab === tab;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', on);
        });
        document.querySelectorAll('#page-records [data-records-panel]').forEach(p =>
            p.classList.toggle('is-active', p.dataset.recordsPanel === tab));
        if (tab === 'h24' && this.initialized) H24Stats.load();
    },

    load() {
        this.loadOverview();
        this.loadRush();
        this.loadMulti();
        this.loadViewers();
        if (this.tab === 'h24') H24Stats.load();
    },

    // ========== VUE D'ENSEMBLE ==========

    async loadOverview() {
        const box = document.getElementById('records-overview');
        try {
            const o = await getJson('/api/stats/overview');
            const tiles = [
                ['🔥', o.rush.runs, t('ovRuns')],
                ['📈', String(o.rush.bestRating || '—'), t('ovRating')],
                ['⚔', o.multi.games, t('ovBattles')],
                ['💬', o.viewers.votes, t('ovVotes')],
            ];
            box.innerHTML = tiles.map(([i, v, l]) => `
                <div class="rec-tile"><span class="rec-tile__icon">${i}</span>
                <span class="rec-tile__value">${typeof v === 'number' ? fmtNum(v) : v}</span>
                <span class="rec-tile__label">${esc(l)}</span></div>`).join('');
        } catch {
            box.innerHTML = '';
        }
    },

    // ========== PUZZLE RUSH ==========

    async loadRush() {
        const mode = this.rushMode;
        document.querySelectorAll('#records-rush-modes [data-rush-mode]').forEach(b => {
            const on = b.dataset.rushMode === mode;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on);
        });
        const podium = document.getElementById('records-rush-podium');
        const list = document.getElementById('records-rush-list');
        const login = me();
        try {
            const [board, mine] = await Promise.all([
                getJson(`/api/rush/records?limit=50&mode=${mode}`),
                login ? getJson(`/api/rush/channel/${encodeURIComponent(login)}`) : null
            ]);
            if (mode !== this.rushMode) return;
            this.renderMyRush(mine);
            const records = board?.records || [];
            if (!records.length) {
                podium.innerHTML = '';
                list.innerHTML = empty(t('rushEmpty'));
                return;
            }
            const order = [1, 0, 2].filter(i => records[i]);
            podium.innerHTML = order.map(i => {
                const r = records[i];
                return `<div class="rec-podium__step rec-podium__step--${i + 1} ${r.login === login ? 'is-me' : ''}">
                    <span class="rec-podium__medal">${['🥇', '🥈', '🥉'][i]}</span>
                    ${avatar(r, 'rec-avatar rec-avatar--lg')}
                    <span class="rec-podium__name">${channelLink(r)}</span>
                    <span class="rec-podium__score">${r.best.score}</span>
                    <span class="rec-podium__meta">${esc(t('ratingMax', { n: r.best.maxRating || '—' }))}</span>
                    <span class="rec-podium__block">${i + 1}</span>
                </div>`;
            }).join('');
            list.innerHTML = records.slice(3, 20).map((r, k) => `
                <div class="rush-list__row ${r.login === login ? 'rush-list__row--me' : ''}">
                    <span class="rush-list__rank">${k + 4}</span>
                    ${avatar(r, 'rush-list__avatar')}
                    <span class="rush-list__name">${channelLink(r)}
                        <span class="rush-list__meta">${esc(t('ratingMax', { n: r.best.maxRating || '—' }))} · ${fmtDate(r.best.at)}</span>
                    </span>
                    <span class="rush-list__score" title="${esc(t('runs', { n: r.runs || 1 }))}">${r.best.score}</span>
                </div>`).join('');
        } catch (e) {
            podium.innerHTML = '';
            list.innerHTML = failed(e);
        }
    },

    renderMyRush(mine) {
        const box = document.getElementById('records-rush-me');
        if (!me()) { box.innerHTML = ''; return; }
        const user = window.twitchAuth.user;
        const m = mine?.modes?.[this.rushMode];
        const modes = ['0', '30', '60', '120'];
        const label = (k) => (k === '0' ? t('modeUnlimited') : k === '60' ? '1 min' : k === '120' ? '2 min' : '30 s');
        box.innerHTML = `
            <div class="rec-me">
                <div class="rec-me__who">${avatar({ ...user, login: user.login })}
                    <div><div class="rec-me__title">${esc(t('myCard'))}</div><div class="rec-me__name">${esc(user.displayName)}</div></div>
                </div>
                <div class="rec-me__stats">
                    <div><span class="rec-me__big">${m ? m.best.score : '—'}</span><span class="rec-me__small">${esc(t('best'))}</span></div>
                    <div><span class="rec-me__big">${m ? `#${m.rank}` : '—'}</span><span class="rec-me__small">${m ? esc(t('ofTotal', { n: m.total })) : esc(t('rank'))}</span></div>
                    <div><span class="rec-me__big">${m ? m.runs : 0}</span><span class="rec-me__small">${esc(t('runsLabel'))}</span></div>
                    <div><span class="rec-me__big">${m?.best.maxRating || '—'}</span><span class="rec-me__small">${esc(t('ratingLabel'))}</span></div>
                </div>
                <div class="rec-me__spark">${m ? sparkline(m.history) : ''}
                    <span class="rec-me__small">${m?.history?.length > 1 ? esc(t('lastRuns', { n: m.history.length })) : esc(m ? t('needRuns') : t('noRun'))}</span></div>
                <div class="rec-me__modes">${modes.map(k => {
                    const x = mine?.modes?.[k];
                    return `<span class="rec-chip ${k === this.rushMode ? 'is-active' : ''}">${esc(label(k))} : <b>${x ? x.best.score : '—'}</b></span>`;
                }).join('')}</div>
            </div>`;
    },

    // ========== MULTI ==========

    async loadMulti() {
        const list = document.getElementById('records-multi-list');
        const recent = document.getElementById('records-multi-recent');
        const login = me();
        try {
            const data = await getJson('/api/multi/leaderboard?limit=50');
            const channels = data?.channels || [];
            list.innerHTML = channels.length ? channels.map((c, i) => {
                const rate = c.games ? Math.round((c.w / c.games) * 100) : 0;
                return `<div class="rec-row rec-row--click ${c.login === login ? 'is-me' : ''}" data-duel="${esc(c.login)}" tabindex="0">
                    <span class="rec-row__rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
                    ${avatar(c)}
                    <span class="rec-row__name">${channelLink(c)}
                        <span class="rec-row__meta"><span class="rec-w">${c.w}${esc(t('w'))}</span> · <span class="rec-d">${c.d}${esc(t('d'))}</span> · <span class="rec-l">${c.l}${esc(t('l'))}</span></span>
                        <span class="rec-bar"><span style="width:${rate}%"></span></span>
                    </span>
                    <span class="rec-row__score">${c.points}<small>${esc(t('pts'))}</small></span>
                </div>
                <div class="rec-duels" data-duels="${esc(c.login)}"></div>`;
            }).join('') : empty(t('multiEmpty'));
            recent.innerHTML = (data?.recent || []).length ? data.recent.map(g => {
                const win = g.result;
                const side = (p, color) => `<span class="rec-battle__side ${win === color ? 'is-win' : ''}">${avatar(p, 'rec-avatar rec-avatar--sm')}${esc(p.displayName)}</span>`;
                return `<div class="rec-battle">
                    ${side(g.whiteProfile, 'white')}
                    <span class="rec-battle__vs">${win === 'draw' ? '½–½' : win === 'white' ? '1–0' : '0–1'}</span>
                    ${side(g.blackProfile, 'black')}
                    <span class="rec-battle__meta">${esc(t('reason_' + g.reason))} · ${esc(t('moves', { n: Math.ceil((g.moves || 0) / 2) }))} · ${fmtDate(g.at)}</span>
                </div>`;
            }).join('') : empty(t('recentEmpty'));
            if (this.openDuel) this.toggleDuels(this.openDuel, true);
        } catch (e) {
            list.innerHTML = failed(e);
            recent.innerHTML = '';
        }
    },

    async toggleDuels(login, keepOpen = false) {
        const box = document.querySelector(`#records-multi-list [data-duels="${CSS.escape(login)}"]`);
        if (!box) return;
        const open = keepOpen || !box.classList.contains('is-open');
        document.querySelectorAll('#records-multi-list .rec-duels.is-open').forEach(b => { if (b !== box) b.classList.remove('is-open'); });
        box.classList.toggle('is-open', open);
        this.openDuel = open ? login : null;
        if (!open) return;
        try {
            const d = await getJson(`/api/multi/channel/${encodeURIComponent(login)}`);
            box.innerHTML = d?.opponents?.length ? d.opponents.map(o => `
                <div class="rec-duel">${avatar(o, 'rec-avatar rec-avatar--sm')}
                    <span class="rec-duel__name">${esc(t('vs'))} ${channelLink(o)}</span>
                    <span class="rec-duel__score"><span class="rec-w">${o.w}</span>–<span class="rec-d">${o.d}</span>–<span class="rec-l">${o.l}</span></span>
                </div>`).join('') : empty(t('multiEmpty'));
        } catch (e) {
            box.innerHTML = failed(e);
        }
    },

    // ========== VIEWERS ==========

    async loadViewers() {
        const chips = document.getElementById('records-channels');
        const out = document.getElementById('records-viewers');
        document.querySelectorAll('#records-viewer-sort [data-sort]').forEach(b => b.classList.toggle('is-active', b.dataset.sort === this.viewerSort));
        try {
            const { channels = [] } = await getJson('/api/viewers') || {};
            if (!this.viewerChannel) {
                const login = me();
                this.viewerChannel = channels.find(c => c.login === login)?.login || channels[0]?.login || null;
            }
            chips.innerHTML = channels.slice(0, 12).map(c => `
                <button type="button" class="rec-channel ${c.login === this.viewerChannel ? 'is-active' : ''}" data-channel="${esc(c.login)}">
                    ${avatar(c, 'rec-avatar rec-avatar--sm')}<span>${esc(c.displayName)}</span><small>${fmtNum(c.viewers)}</small>
                </button>`).join('');
            if (!this.viewerChannel) { out.innerHTML = empty(t('viewersEmpty')); return; }

            const channel = this.viewerChannel, sort = this.viewerSort;
            const data = await getJson(`/api/viewers/${encodeURIComponent(channel)}?sort=${sort}&limit=50`);
            if (channel !== this.viewerChannel || sort !== this.viewerSort) return;
            if (!data) { out.innerHTML = empty(t('channelEmpty', { name: esc(channel) })); return; }
            const c = data.channel;
            const head = `<div class="rec-chan">
                ${avatar(c, 'rec-avatar rec-avatar--lg')}
                <div><div class="rec-chan__name">${channelLink(c)}</div>
                <div class="rec-row__meta">${esc(t('chanMeta', { turns: fmtNum(c.turns), puzzles: fmtNum(c.puzzleTurns), viewers: fmtNum(c.viewers) }))}</div></div>
            </div>`;
            if (!data.viewers.length) { out.innerHTML = head + empty(t(sort === 'solved' ? 'noPuzzleVotes' : 'noVotes')); return; }
            const top = data.viewers;
            const max = Math.max(...top.map(v => sort === 'solved' ? v.solved : sort === 'picked' ? v.picked : v.votes), 1);
            out.innerHTML = head + `<div class="rec-table">
                <div class="rec-table__head"><span>#</span><span>${esc(t('viewer'))}</span>
                    <span>${esc(t('colVotes'))}</span><span>${esc(t('colPicked'))}</span><span>${esc(t('colSolved'))}</span></div>
                ${top.map((v, i) => {
                    const val = sort === 'solved' ? v.solved : sort === 'picked' ? v.picked : v.votes;
                    const pickRate = v.votes ? Math.round((v.picked / v.votes) * 100) : 0;
                    return `<div class="rec-table__row">
                        <span class="rec-row__rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
                        <span class="rec-table__name">${esc(v.name)}<span class="rec-bar"><span style="width:${Math.round((val / max) * 100)}%"></span></span></span>
                        <span>${fmtNum(v.votes)}</span>
                        <span>${fmtNum(v.picked)} <small>${v.votes ? pickRate + ' %' : ''}</small></span>
                        <span>${v.puzzles ? `${fmtNum(v.solved)}<small>/${fmtNum(v.puzzles)}</small>` : '—'}</span>
                    </div>`;
                }).join('')}
            </div>`;
        } catch (e) {
            out.innerHTML = failed(e);
        }
    }
};

window.RecordsPage = RecordsPage;
export default RecordsPage;
