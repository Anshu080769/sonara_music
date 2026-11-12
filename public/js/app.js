import { MusicPlayer } from './player.js';
import {
  escapeHtml,
  formatTime,
  registerTrack,
  getRegisteredTrack,
  getRegisteredTrackList,
  renderHomeView,
  renderSearchView,
  renderArtistsView,
  renderArtistDetailView,
  renderGenresView,
  renderGenreDetailView,
  renderAlbumsView,
  renderAlbumDetailView,
  renderAllTracksView,
  renderLibraryView,
  renderYouTubeView,
  renderSimilarTrackCard
} from './views.js';

const STORAGE_LIKED = 'sonora_liked_v1';
const STORAGE_RECENT = 'sonora_recent_v1';
const STORAGE_YT_KEY = 'sonora_yt_api_key_v1';
const STORAGE_YT_TRACKS = 'sonora_yt_tracks_v1';

const state = {
  catalog: null,
  likedIds: JSON.parse(localStorage.getItem(STORAGE_LIKED) || '[]'),
  recentIds: JSON.parse(localStorage.getItem(STORAGE_RECENT) || '[]'),
  savedYouTubeTracks: JSON.parse(localStorage.getItem(STORAGE_YT_TRACKS) || '{}'),
  ytBrowserKey: localStorage.getItem(STORAGE_YT_KEY) || '',
  ytServerConfigured: false,
  ytQuery: '',
  ytResults: null,
  ytLoading: false,
  historyStack: [],
  historyIdx: -1,
  currentRoute: { name: 'home', id: null },
  searchQuery: '',
  searchGenre: '',
  searchSort: 'relevance',
  artistGenre: '',
  artistSort: 'listeners',
  albumGenre: '',
  albumSort: 'newest',
  tracksGenre: '',
  tracksSort: 'plays',
  webDiscoverEnabled: true,
  webResults: null,
  youtubeSearchResults: null,
  currentTrack: null,
  isPlaying: false,
  similarFocusTrack: null,
  similarList: [],
  similarErrorMsg: '',
  panelTab: 'similar',
  recommendations: []
};

let searchDebounceTimer = null;
let toastTimer = null;

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

function isYouTubeKeyReady() {
  return Boolean(state.ytServerConfigured || state.ytBrowserKey.trim());
}

function updateYouTubeStatusUI() {
  const dot = document.getElementById('ytStatusDot');
  if (dot) dot.classList.toggle('ready', isYouTubeKeyReady());
  const box = document.getElementById('ytServerKeyStatus');
  if (box) {
    if (state.ytServerConfigured) {
      box.innerHTML = '✓ <strong>Server environment key active</strong> (<code>YOUTUBE_API_KEY</code> is configured on the server).';
    } else if (state.ytBrowserKey.trim()) {
      box.innerHTML = '✓ <strong>Browser API key saved</strong> (stored in your browser <code>localStorage</code>).';
    } else {
      box.innerHTML = 'No API key configured yet. Paste a Google YouTube Data API v3 key below or set <code>YOUTUBE_API_KEY</code> in <code>.env</code>.';
    }
  }
}

function saveLibrary() {
  localStorage.setItem(STORAGE_LIKED, JSON.stringify(state.likedIds));
  localStorage.setItem(STORAGE_RECENT, JSON.stringify(state.recentIds));
  localStorage.setItem(STORAGE_YT_TRACKS, JSON.stringify(state.savedYouTubeTracks));
  const badge = document.getElementById('likedCountBadge');
  if (badge) badge.textContent = String(state.likedIds.length);
}

function rememberTrackIfExternal(track) {
  if (!track) return;
  registerTrack(track);
  if (track.isYouTube || track.isExternal) {
    state.savedYouTubeTracks[track.id] = track;
    // Keep cache bounded to 60 recent/liked external tracks
    const keepIds = new Set([...state.likedIds, ...state.recentIds, track.id]);
    const keys = Object.keys(state.savedYouTubeTracks);
    if (keys.length > 60) {
      for (const k of keys) {
        if (!keepIds.has(k)) delete state.savedYouTubeTracks[k];
      }
    }
  }
}

function ytFetchHeaders() {
  const headers = {};
  if (state.ytBrowserKey.trim()) {
    headers['x-youtube-api-key'] = state.ytBrowserKey.trim();
  }
  return headers;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const player = new MusicPlayer({
  onTrackChange: async (track) => {
    state.currentTrack = track;
    rememberTrackIfExternal(track);
    state.recentIds = [track.id, ...state.recentIds.filter((x) => x !== track.id)].slice(0, 20);
    saveLibrary();

    if (!track.isExternal) {
      fetch(`/api/tracks/${encodeURIComponent(track.id)}/play`, { method: 'POST' }).catch(() => {});
      loadSimilarForTrack(track);
      refreshRecommendations();
    } else if (track.isYouTube) {
      loadSimilarForTrack(track);
    } else {
      state.similarFocusTrack = track;
      state.similarList = [];
      state.similarErrorMsg = '';
      renderRightPanel();
    }
    updatePlayerBar();
    updateCinemaIfOpen();
    syncPlayingRowHighlights();
  },
  onStateChange: (kind) => {
    state.isPlaying = player.isPlaying;
    updatePlayerBar(kind);
    if (kind === 'queue') renderQueueList();
    if (kind !== 'time') syncPlayingRowHighlights();
  },
  onError: (msg) => {
    showToast(msg);
  },
  onNeedSimilar: async (track, excludeIds) => {
    try {
      const excludeSet = new Set(excludeIds);
      if (track.isYouTube) {
        if (!isYouTubeKeyReady()) return null;
        const data = await fetchJson(
          `/api/youtube/similar?videoId=${encodeURIComponent(track.videoId)}&title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artistName)}&limit=6`,
          { headers: ytFetchHeaders() }
        );
        const list = data.similar || [];
        const next = list.find((r) => !excludeSet.has(r.track.id)) || list[0];
        if (next) {
          rememberTrackIfExternal(next.track);
          showToast(`Autoplay similar: ${next.track.title}`);
          return next.track;
        }
        return null;
      }

      if (!track.isExternal) {
        const data = await fetchJson(`/api/tracks/${encodeURIComponent(track.id)}/similar?limit=6`);
        const next = data.similar.find((r) => !excludeSet.has(r.track.id)) || data.similar[0];
        if (next) {
          showToast(`Autoplay similar: ${next.track.title}`);
          return next.track;
        }
      }
    } catch {
      return null;
    }
    return null;
  }
});

async function loadSimilarForTrack(track) {
  if (!track) return;
  state.similarFocusTrack = track;
  state.similarErrorMsg = '';

  if (track.isYouTube) {
    if (!isYouTubeKeyReady()) {
      state.similarList = [];
      state.similarErrorMsg = 'Configure a YouTube API key to load similar YouTube full tracks.';
      renderRightPanel();
      updateCinemaIfOpen();
      return;
    }
    try {
      const data = await fetchJson(
        `/api/youtube/similar?videoId=${encodeURIComponent(track.videoId)}&title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artistName)}&limit=8`,
        { headers: ytFetchHeaders() }
      );
      state.similarList = data.similar || [];
      state.similarList.forEach((r) => rememberTrackIfExternal(r.track));
      if (!data.ok && data.message) state.similarErrorMsg = data.message;
    } catch (err) {
      state.similarList = [];
      state.similarErrorMsg = err.message;
    }
    renderRightPanel();
    updateCinemaIfOpen();
    return;
  }

  if (track.isExternal) {
    state.similarList = [];
    renderRightPanel();
    return;
  }

  try {
    const data = await fetchJson(`/api/tracks/${encodeURIComponent(track.id)}/similar?limit=8`);
    state.similarList = data.similar || [];
  } catch {
    state.similarList = [];
  }
  renderRightPanel();
  updateCinemaIfOpen();
}

async function refreshRecommendations() {
  try {
    const data = await fetchJson('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        likedIds: state.likedIds,
        recentIds: state.recentIds,
        limit: 8
      })
    });
    state.recommendations = data.recommendations || [];
  } catch {
    state.recommendations = [];
  }
}

function updatePlayerBar(kind) {
  const track = player.currentTrack;
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  if (playIcon && pauseIcon) {
    playIcon.classList.toggle('hidden', player.isPlaying);
    pauseIcon.classList.toggle('hidden', !player.isPlaying);
  }

  const dur = player.getDuration();
  const cur = player.getCurrentTime();
  const seekBar = document.getElementById('seekBar');
  const curLabel = document.getElementById('currentTimeLabel');
  const durLabel = document.getElementById('durationLabel');
  if (curLabel) curLabel.textContent = formatTime(cur);
  if (durLabel) durLabel.textContent = formatTime(dur);
  if (seekBar && dur > 0) {
    seekBar.value = String((cur / dur) * 100);
  }

  if (kind === 'time') return;

  if (track) {
    document.getElementById('playerArt').src = track.artUrl;
    document.getElementById('playerTitle').textContent = track.title;
    const artistBtn = document.getElementById('playerArtistBtn');
    const albumBtn = document.getElementById('playerAlbumBtn');
    artistBtn.textContent = track.artistName;
    albumBtn.textContent = track.albumTitle;
    artistBtn.disabled = Boolean(track.isExternal);
    albumBtn.disabled = Boolean(track.isExternal);

    const likeBtn = document.getElementById('playerLikeBtn');
    likeBtn.classList.toggle('liked', state.likedIds.includes(track.id));
  }

  document.getElementById('shuffleBtn').classList.toggle('active', player.shuffle);
  const repBtn = document.getElementById('repeatBtn');
  repBtn.classList.toggle('active', player.repeat !== 'off');
  repBtn.title = `Repeat: ${player.repeat}`;
  document.getElementById('repeatOneTag').classList.toggle('hidden', player.repeat !== 'one');

  document.getElementById('volumeBar').value = String(player.muted ? 0 : player.volume);
  document.getElementById('muteBtn').classList.toggle('active', player.muted);
  document.getElementById('queueCountPill').textContent = String(player.queue.length);
}

const PLAY_ICON_SMALL = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 5l13 7-13 7V5z" fill="currentColor"/></svg>`;

function syncPlayingRowHighlights() {
  const curId = player.currentTrack?.id;
  document.querySelectorAll('.track-row').forEach((row) => {
    const id = row.dataset.trackId;
    const rowNum = row.dataset.rowNum || '';
    const isCur = id === curId;
    row.classList.toggle('playing', isCur);
    const idxCell = row.querySelector('.track-idx');
    if (!idxCell) return;
    if (isCur && player.isPlaying) {
      idxCell.innerHTML = `<div class="eq-bars" aria-label="Playing"><span></span><span></span><span></span></div>`;
    } else {
      idxCell.innerHTML = `<span class="track-idx-num">${escapeHtml(rowNum)}</span>
        <button class="track-row-play" data-action="play-track" data-track-id="${escapeHtml(id)}" title="Play">${PLAY_ICON_SMALL}</button>`;
    }
  });
}

function renderRightPanel() {
  const focus = state.similarFocusTrack || player.currentTrack;
  const nowCard = document.getElementById('panelNowPlayingCard');
  const simList = document.getElementById('panelSimilarList');

  if (!focus) {
    nowCard.innerHTML = `<div class="panel-empty">Pick any track to stream and see live similar suggestions.</div>`;
    simList.innerHTML = '';
    return;
  }

  nowCard.innerHTML = `
    <div class="panel-now-top">
      <img src="${escapeHtml(focus.artUrl)}" alt="${escapeHtml(focus.title)}">
      <div style="min-width:0;flex:1">
        <div class="sim-item-title">${escapeHtml(focus.title)}</div>
        <div class="sim-item-sub">${escapeHtml(focus.artistName)}</div>
      </div>
    </div>
    <div class="dna-pills">
      <span class="dna-pill">${escapeHtml(focus.genreName || focus.genre)}</span>
      <span class="dna-pill">${focus.isYouTube ? 'YouTube Full' : `${focus.bpm || 110} BPM`}</span>
      ${focus.key ? `<span class="dna-pill">${escapeHtml(focus.key)}</span>` : ''}
      ${(focus.moods || []).slice(0, 3).map((m) => `<span class="dna-pill">${escapeHtml(m)}</span>`).join('')}
    </div>
  `;

  if (focus.isExternal && !focus.isYouTube) {
    simList.innerHTML = `<div class="panel-empty">Streaming live iTunes web preview. Search local catalog or YouTube for similar track recommendations!</div>`;
    return;
  }

  if (state.similarErrorMsg) {
    simList.innerHTML = `
      <div class="panel-empty">
        ${escapeHtml(state.similarErrorMsg)}
        ${focus.isYouTube ? `<br><button class="text-btn" data-action="open-yt-settings">Configure YouTube Key</button>` : ''}
      </div>
    `;
    renderQueueList();
    return;
  }

  if (!state.similarList.length) {
    simList.innerHTML = `<div class="panel-empty">Finding similar tracks...</div>`;
    renderQueueList();
    return;
  }

  simList.innerHTML = state.similarList
    .map((rec) => {
      const tid = escapeHtml(registerTrack(rec.track));
      return `
        <div class="sim-item">
          <img src="${escapeHtml(rec.track.artUrl)}" alt="${escapeHtml(rec.track.title)}" data-action="play-track" data-track-id="${tid}">
          <div class="sim-item-info" data-action="play-track" data-track-id="${tid}">
            <div class="sim-item-title">${escapeHtml(rec.track.title)}</div>
            <div class="sim-item-sub">${escapeHtml(rec.track.artistName)} · ${rec.matchPercent}% match</div>
            <div class="sim-reason">${escapeHtml(rec.reasons.join(' · '))}</div>
          </div>
          <button class="tiny-action" data-action="queue-track" data-track-id="${tid}" title="Add to queue">+</button>
        </div>
      `;
    })
    .join('');

  renderQueueList();
}

function renderQueueList() {
  const queueEl = document.getElementById('panelQueueList');
  if (!queueEl) return;
  document.getElementById('queueCountPill').textContent = String(player.queue.length);

  if (!player.queue.length) {
    queueEl.innerHTML = `<div class="panel-empty">Your playing queue is empty.</div>`;
    return;
  }

  queueEl.innerHTML = player.queue
    .map((t, idx) => {
      const isCur = idx === player.queueIndex;
      const tid = escapeHtml(registerTrack(t));
      return `
        <div class="sim-item" style="${isCur ? 'border-color: var(--accent); background: rgba(124,92,255,0.14);' : ''}">
          <img src="${escapeHtml(t.artUrl)}" alt="${escapeHtml(t.title)}" data-action="play-track" data-track-id="${tid}">
          <div class="sim-item-info" data-action="play-track" data-track-id="${tid}">
            <div class="sim-item-title">${isCur ? '▶ ' : ''}${escapeHtml(t.title)}</div>
            <div class="sim-item-sub">${escapeHtml(t.artistName)} · ${formatTime(t.duration)}</div>
          </div>
          ${
            isCur
              ? ''
              : `<button class="tiny-action" data-action="remove-queue" data-index="${idx}" title="Remove">&times;</button>`
          }
        </div>
      `;
    })
    .join('');
}

function updateCinemaIfOpen() {
  const modal = document.getElementById('cinemaModal');
  if (!modal || modal.classList.contains('hidden')) return;
  renderCinemaModal();
}

function renderCinemaModal() {
  const track = player.currentTrack || state.catalog?.tracks[0];
  if (!track) return;
  const body = document.getElementById('cinemaBody');
  const tid = escapeHtml(registerTrack(track));
  const simCards = state.similarList.slice(0, 4).map(renderSimilarTrackCard).join('');

  body.innerHTML = `
    <div class="cinema-top-grid">
      <img class="cinema-art" src="${escapeHtml(track.artUrl)}" alt="${escapeHtml(track.title)}">
      <div>
        <div class="detail-kicker">${escapeHtml(track.genreName || track.genre)} · ${track.isYouTube ? 'YouTube Full Stream' : `${track.bpm || 110} BPM`}</div>
        <h2 class="detail-title" style="font-size:32px">${escapeHtml(track.title)}</h2>
        <p class="detail-sub">
          ${
            track.isExternal
              ? `${escapeHtml(track.artistName)} — ${escapeHtml(track.albumTitle)}`
              : `<span class="inline-link" data-nav="artist" data-id="${escapeHtml(track.artistId)}">${escapeHtml(track.artistName)}</span>
                 · <span class="inline-link" data-nav="album" data-id="${escapeHtml(track.albumId)}">${escapeHtml(track.albumTitle)}</span>`
          }
        </p>
        <div class="dna-pills" style="margin-bottom:12px">
          ${(track.moods || []).map((m) => `<span class="dna-pill">${escapeHtml(m)}</span>`).join('')}
          ${track.key ? `<span class="dna-pill">Key: ${escapeHtml(track.key)}</span>` : ''}
        </div>
        <canvas id="cinemaVizCanvas" class="cinema-viz" width="600" height="82"></canvas>
        <div class="hero-actions">
          <button class="btn-primary" data-action="toggle-main-play">${player.isPlaying ? 'Pause Stream' : 'Play Stream'}</button>
          <button class="btn-secondary" data-action="queue-track" data-track-id="${tid}">Add to Queue</button>
          ${!track.isExternal ? `<button class="btn-secondary" data-nav="artist" data-id="${escapeHtml(track.artistId)}">Open Artist</button>` : ''}
        </div>
      </div>
    </div>
    ${
      simCards
        ? `<div class="section-header"><h3 class="section-title">Similar Tracks To Stream Next</h3></div>
           <div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));">${simCards}</div>`
        : ''
    }
  `;

  player.setExtraCanvas(document.getElementById('cinemaVizCanvas'));
}

function updateNavUI() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    const r = btn.dataset.route;
    const cur = state.currentRoute.name;
    const match =
      r === cur ||
      (r === 'artists' && cur === 'artist') ||
      (r === 'genres' && cur === 'genre') ||
      (r === 'albums' && cur === 'album');
    btn.classList.toggle('active', match);
  });

  document.getElementById('navBackBtn').disabled = state.historyIdx <= 0;
  document.getElementById('navForwardBtn').disabled = state.historyIdx >= state.historyStack.length - 1;
}

async function navigate(name, id = null, pushHistory = true) {
  const next = { name, id };
  if (pushHistory) {
    state.historyStack = state.historyStack.slice(0, state.historyIdx + 1);
    state.historyStack.push(next);
    state.historyIdx = state.historyStack.length - 1;
  }
  state.currentRoute = next;
  updateNavUI();

  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('cinemaModal').classList.add('hidden');
  player.setExtraCanvas(null);

  await renderCurrentView();
  document.getElementById('mainContent').scrollTop = 0;
}

async function runYouTubeSearch(query) {
  state.ytQuery = query;
  state.ytLoading = true;
  state.ytResults = null;
  if (state.currentRoute.name === 'youtube') await renderCurrentView();

  try {
    const res = await fetchJson(
      `/api/youtube/search?q=${encodeURIComponent(query)}&limit=12`,
      { headers: ytFetchHeaders() }
    );
    state.ytResults = res;
    (res.tracks || []).forEach(registerTrack);
  } catch (err) {
    state.ytResults = { ok: false, tracks: [], message: err.message };
  } finally {
    state.ytLoading = false;
    if (state.currentRoute.name === 'youtube') await renderCurrentView();
  }
}

async function renderCurrentView() {
  const container = document.getElementById('mainContent');
  if (!state.catalog) return;

  const { name, id } = state.currentRoute;
  try {
    if (name === 'home') {
      await refreshRecommendations();
      container.innerHTML = renderHomeView(state.catalog, state.recommendations, state);
    } else if (name === 'search') {
      const localResults = await fetchJson(
        `/api/search?q=${encodeURIComponent(state.searchQuery)}&genre=${encodeURIComponent(state.searchGenre)}&sort=${encodeURIComponent(state.searchSort)}`
      );
      container.innerHTML = renderSearchView({
        query: state.searchQuery,
        localResults,
        webResults: state.webResults,
        youtubeResults: state.youtubeSearchResults,
        webEnabled: state.webDiscoverEnabled,
        genreFilter: state.searchGenre,
        sort: state.searchSort,
        genres: state.catalog.genres,
        state
      });
      if (state.webDiscoverEnabled && state.searchQuery) {
        const qSnap = state.searchQuery;
        if (state.webResults === null) {
          fetchJson(`/api/discover?q=${encodeURIComponent(qSnap)}&limit=10`).then((res) => {
            if (state.currentRoute.name === 'search' && state.searchQuery === qSnap) {
              state.webResults = res;
              renderCurrentView();
            }
          });
        }
        if (state.youtubeSearchResults === null) {
          fetchJson(`/api/youtube/search?q=${encodeURIComponent(qSnap)}&limit=8`, {
            headers: ytFetchHeaders()
          })
            .then((res) => {
              if (state.currentRoute.name === 'search' && state.searchQuery === qSnap) {
                state.youtubeSearchResults = res;
                renderCurrentView();
              }
            })
            .catch(() => {
              if (state.currentRoute.name === 'search' && state.searchQuery === qSnap) {
                state.youtubeSearchResults = { ok: false, tracks: [] };
                renderCurrentView();
              }
            });
        }
      }
    } else if (name === 'youtube') {
      container.innerHTML = renderYouTubeView({
        query: state.ytQuery,
        results: state.ytResults,
        loading: state.ytLoading,
        keyConfigured: isYouTubeKeyReady(),
        genres: state.catalog.genres,
        state
      });
    } else if (name === 'artists') {
      container.innerHTML = renderArtistsView(state.catalog, {
        genreFilter: state.artistGenre,
        sort: state.artistSort
      });
    } else if (name === 'artist') {
      const data = await fetchJson(`/api/artists/${encodeURIComponent(id)}`);
      container.innerHTML = renderArtistDetailView(data, state, state.catalog);
    } else if (name === 'genres') {
      container.innerHTML = renderGenresView(state.catalog);
    } else if (name === 'genre') {
      const data = await fetchJson(`/api/genres/${encodeURIComponent(id)}`);
      container.innerHTML = renderGenreDetailView(data, state);
    } else if (name === 'albums') {
      container.innerHTML = renderAlbumsView(state.catalog, {
        genreFilter: state.albumGenre,
        sort: state.albumSort
      });
    } else if (name === 'album') {
      const data = await fetchJson(`/api/albums/${encodeURIComponent(id)}`);
      container.innerHTML = renderAlbumDetailView(data, state);
    } else if (name === 'tracks') {
      container.innerHTML = renderAllTracksView(
        state.catalog,
        { genreFilter: state.tracksGenre, sort: state.tracksSort },
        state
      );
    } else if (name === 'library') {
      await refreshRecommendations();
      container.innerHTML = renderLibraryView(state.catalog, state.recommendations, state);
    }
  } catch (err) {
    container.innerHTML = `<div class="panel-empty">Unable to load view: ${escapeHtml(err.message)}</div>`;
  }
}

function resolveTrackById(id) {
  return (
    getRegisteredTrack(id) ||
    state.savedYouTubeTracks[id] ||
    state.catalog?.tracks.find((t) => t.id === id) ||
    null
  );
}

function openYtSettingsModal() {
  updateYouTubeStatusUI();
  const input = document.getElementById('ytApiKeyInput');
  if (input) input.value = state.ytBrowserKey;
  document.getElementById('ytSettingsModal').classList.remove('hidden');
}

async function handleAction(action, el) {
  if (action === 'play-track') {
    const track = resolveTrackById(el.dataset.trackId);
    if (track) await player.playTrack(track);
    return;
  }
  if (action === 'play-list') {
    const tracks = getRegisteredTrackList(el.dataset.listKey);
    if (tracks.length) await player.playTrack(tracks[0], tracks);
    return;
  }
  if (action === 'shuffle-list') {
    const tracks = getRegisteredTrackList(el.dataset.listKey);
    if (tracks.length) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      await player.playTrack(shuffled[0], shuffled);
      showToast('Shuffled queue started');
    }
    return;
  }
  if (action === 'play-album') {
    const data = await fetchJson(`/api/albums/${encodeURIComponent(el.dataset.id)}`);
    if (data.tracks.length) await player.playTrack(data.tracks[0], data.tracks);
    return;
  }
  if (action === 'play-artist') {
    const data = await fetchJson(`/api/artists/${encodeURIComponent(el.dataset.id)}`);
    if (data.tracks.length) await player.playTrack(data.tracks[0], data.tracks);
    return;
  }
  if (action === 'play-genre') {
    const data = await fetchJson(`/api/genres/${encodeURIComponent(el.dataset.id)}`);
    if (data.tracks.length) await player.playTrack(data.tracks[0], data.tracks);
    return;
  }
  if (action === 'queue-track') {
    const track = resolveTrackById(el.dataset.trackId);
    if (track) {
      rememberTrackIfExternal(track);
      player.addToQueue(track);
      showToast(`Added "${track.title}" to queue`);
    }
    return;
  }
  if (action === 'remove-queue') {
    player.removeFromQueue(Number(el.dataset.index));
    return;
  }
  if (action === 'toggle-like') {
    const id = el.dataset.id;
    const track = resolveTrackById(id);
    if (track) rememberTrackIfExternal(track);
    const idx = state.likedIds.indexOf(id);
    if (idx >= 0) {
      state.likedIds.splice(idx, 1);
      showToast('Removed from Liked');
    } else {
      state.likedIds.unshift(id);
      showToast('Saved to Liked Songs');
    }
    saveLibrary();
    updatePlayerBar();
    renderCurrentView();
    return;
  }
  if (action === 'show-similar') {
    const track = resolveTrackById(el.dataset.id);
    if (track) {
      document.getElementById('rightPanel').classList.remove('collapsed');
      document.getElementById('toggleSimilarPanelBtn').classList.add('active');
      switchPanelTab('similar');
      await loadSimilarForTrack(track);
      showToast(`Showing tracks similar to "${track.title}"`);
    }
    return;
  }
  if (action === 'search-youtube-query') {
    const q = el.dataset.query || '';
    await navigate('youtube');
    await runYouTubeSearch(q);
    return;
  }
  if (action === 'open-yt-settings') {
    openYtSettingsModal();
    return;
  }
  if (action === 'toggle-main-play') {
    player.togglePlay();
    updateCinemaIfOpen();
    return;
  }
  if (action === 'search-filter-genre') {
    state.searchGenre = el.dataset.id;
    renderCurrentView();
    return;
  }
  if (action === 'artist-filter-genre') {
    state.artistGenre = el.dataset.id;
    renderCurrentView();
    return;
  }
  if (action === 'album-filter-genre') {
    state.albumGenre = el.dataset.id;
    renderCurrentView();
    return;
  }
  if (action === 'tracks-filter-genre') {
    state.tracksGenre = el.dataset.id;
    renderCurrentView();
  }
}

function switchPanelTab(tabName) {
  state.panelTab = tabName;
  document.querySelectorAll('.panel-tab').forEach((t) => t.classList.toggle('active', t.dataset.panelTab === tabName));
  document.getElementById('panelSimilarView').classList.toggle('hidden', tabName !== 'similar');
  document.getElementById('panelQueueView').classList.toggle('hidden', tabName !== 'queue');
}

function renderSearchDropdown(results) {
  const dd = document.getElementById('searchDropdown');
  if (!state.searchQuery.trim()) {
    dd.classList.add('hidden');
    return;
  }
  const sections = [];
  if (results.tracks.length) {
    sections.push(`<div class="dropdown-group-label">Tracks</div>`);
    sections.push(
      ...results.tracks.slice(0, 4).map((t) => {
        const tid = escapeHtml(registerTrack(t));
        return `
          <button class="dropdown-item" data-action="play-track" data-track-id="${tid}">
            <img src="${escapeHtml(t.artUrl)}" alt="">
            <div class="dropdown-item-info">
              <div class="dropdown-item-title">${escapeHtml(t.title)}</div>
              <div class="dropdown-item-sub">${escapeHtml(t.artistName)} · ${escapeHtml(t.genreName)}</div>
            </div>
            <span class="tag-badge">Play</span>
          </button>
        `;
      })
    );
  }
  if (results.artists.length) {
    sections.push(`<div class="dropdown-group-label">Artists</div>`);
    sections.push(
      ...results.artists.slice(0, 3).map(
        (a) => `
          <button class="dropdown-item" data-nav="artist" data-id="${escapeHtml(a.id)}">
            <img src="${escapeHtml(a.artUrl)}" alt="" style="border-radius:50%">
            <div class="dropdown-item-info">
              <div class="dropdown-item-title">${escapeHtml(a.name)}</div>
              <div class="dropdown-item-sub">Artist · ${escapeHtml(a.primaryGenreName)}</div>
            </div>
          </button>
        `
      )
    );
  }
  if (results.albums.length) {
    sections.push(`<div class="dropdown-group-label">Albums</div>`);
    sections.push(
      ...results.albums.slice(0, 3).map(
        (alb) => `
          <button class="dropdown-item" data-nav="album" data-id="${escapeHtml(alb.id)}">
            <img src="${escapeHtml(alb.artUrl)}" alt="">
            <div class="dropdown-item-info">
              <div class="dropdown-item-title">${escapeHtml(alb.title)}</div>
              <div class="dropdown-item-sub">Album · ${escapeHtml(alb.artistName)}</div>
            </div>
          </button>
        `
      )
    );
  }
  if (results.genres.length) {
    sections.push(`<div class="dropdown-group-label">Genres</div>`);
    sections.push(
      ...results.genres.slice(0, 2).map(
        (g) => `
          <button class="dropdown-item" data-nav="genre" data-id="${escapeHtml(g.id)}">
            <img src="${escapeHtml(g.artUrl)}" alt="">
            <div class="dropdown-item-info">
              <div class="dropdown-item-title">${escapeHtml(g.name)}</div>
              <div class="dropdown-item-sub">Genre · ${g.trackCount} tracks</div>
            </div>
          </button>
        `
      )
    );
  }

  sections.push(`
    <button class="dropdown-item" data-action="search-youtube-query" data-query="${escapeHtml(state.searchQuery)}">
      <div class="dropdown-item-info">
        <div class="dropdown-item-title" style="color: #ff7a7a">Search full music on YouTube for "${escapeHtml(state.searchQuery)}" →</div>
      </div>
    </button>
    <button class="dropdown-item" data-nav="search">
      <div class="dropdown-item-info">
        <div class="dropdown-item-title" style="color: var(--accent-3)">See all results &amp; similar suggestions for "${escapeHtml(state.searchQuery)}" →</div>
      </div>
    </button>
  `);

  dd.innerHTML = sections.join('');
  dd.classList.remove('hidden');
}

function bindGlobalEvents() {
  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      e.stopPropagation();
      document.getElementById('searchDropdown').classList.add('hidden');
      handleAction(actionEl.dataset.action, actionEl);
      return;
    }

    const navEl = e.target.closest('[data-nav]');
    if (navEl) {
      e.stopPropagation();
      document.getElementById('searchDropdown').classList.add('hidden');
      navigate(navEl.dataset.nav, navEl.dataset.id || null);
      return;
    }

    const routeBtn = e.target.closest('[data-route]');
    if (routeBtn) {
      navigate(routeBtn.dataset.route);
      return;
    }

    if (!e.target.closest('.search-box-wrap')) {
      document.getElementById('searchDropdown').classList.add('hidden');
    }
  });

  // Delegated form submissions inside views (YouTube Search & Direct Stream)
  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'ytSearchForm') {
      e.preventDefault();
      const input = document.getElementById('ytViewSearchInput');
      const q = (input?.value || '').trim();
      if (q) await runYouTubeSearch(q);
      return;
    }
    if (e.target.id === 'ytDirectForm') {
      e.preventDefault();
      const input = document.getElementById('ytDirectInput');
      const val = (input?.value || '').trim();
      if (!val) return;
      try {
        const res = await fetchJson(`/api/youtube/video?input=${encodeURIComponent(val)}`, {
          headers: ytFetchHeaders()
        });
        if (res.track) {
          rememberTrackIfExternal(res.track);
          await player.playTrack(res.track);
          showToast(`Streaming full track: ${res.track.title}`);
          input.value = '';
        }
      } catch (err) {
        showToast(err.message);
      }
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'searchSortSelect') {
      state.searchSort = e.target.value;
      renderCurrentView();
    } else if (e.target.id === 'artistSortSelect') {
      state.artistSort = e.target.value;
      renderCurrentView();
    } else if (e.target.id === 'albumSortSelect') {
      state.albumSort = e.target.value;
      renderCurrentView();
    } else if (e.target.id === 'tracksSortSelect') {
      state.tracksSort = e.target.value;
      renderCurrentView();
    }
  });

  document.getElementById('navBackBtn').addEventListener('click', () => {
    if (state.historyIdx > 0) {
      state.historyIdx--;
      const target = state.historyStack[state.historyIdx];
      navigate(target.name, target.id, false);
    }
  });
  document.getElementById('navForwardBtn').addEventListener('click', () => {
    if (state.historyIdx < state.historyStack.length - 1) {
      state.historyIdx++;
      const target = state.historyStack[state.historyIdx];
      navigate(target.name, target.id, false);
    }
  });

  const searchInput = document.getElementById('globalSearchInput');
  const clearBtn = document.getElementById('searchClearBtn');

  searchInput.addEventListener('input', () => {
    const val = searchInput.value;
    state.searchQuery = val;
    state.webResults = null;
    state.youtubeSearchResults = null;
    clearBtn.classList.toggle('hidden', !val);

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(async () => {
      if (state.currentRoute.name === 'search') {
        renderCurrentView();
      } else if (val.trim()) {
        const res = await fetchJson(`/api/search?q=${encodeURIComponent(val.trim())}`);
        renderSearchDropdown(res);
      } else {
        document.getElementById('searchDropdown').classList.add('hidden');
      }
    }, 160);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('searchDropdown').classList.add('hidden');
      state.searchQuery = searchInput.value;
      state.webResults = null;
      state.youtubeSearchResults = null;
      navigate('search');
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    state.webResults = null;
    state.youtubeSearchResults = null;
    clearBtn.classList.add('hidden');
    document.getElementById('searchDropdown').classList.add('hidden');
    if (state.currentRoute.name === 'search') renderCurrentView();
    searchInput.focus();
  });

  document.getElementById('webDiscoverToggle').addEventListener('change', (e) => {
    state.webDiscoverEnabled = e.target.checked;
    state.webResults = null;
    state.youtubeSearchResults = null;
    if (state.currentRoute.name === 'search') renderCurrentView();
  });

  // YouTube Settings Modal + Floating Dock controls
  document.getElementById('ytKeyModalBtn').addEventListener('click', openYtSettingsModal);
  document.getElementById('closeYtSettingsBtn').addEventListener('click', () => {
    document.getElementById('ytSettingsModal').classList.add('hidden');
  });
  document.getElementById('ytSettingsBackdrop').addEventListener('click', () => {
    document.getElementById('ytSettingsModal').classList.add('hidden');
  });
  document.getElementById('ytKeyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = document.getElementById('ytApiKeyInput').value.trim();
    state.ytBrowserKey = val;
    localStorage.setItem(STORAGE_YT_KEY, val);
    updateYouTubeStatusUI();
    document.getElementById('ytSettingsModal').classList.add('hidden');
    showToast(val ? 'YouTube Data API v3 key saved' : 'Browser YouTube API key cleared');
    state.youtubeSearchResults = null;
    if (state.currentRoute.name === 'youtube' && state.ytQuery) {
      await runYouTubeSearch(state.ytQuery);
    } else {
      await renderCurrentView();
    }
  });
  document.getElementById('clearYtKeyBtn').addEventListener('click', () => {
    state.ytBrowserKey = '';
    localStorage.removeItem(STORAGE_YT_KEY);
    document.getElementById('ytApiKeyInput').value = '';
    updateYouTubeStatusUI();
    showToast('Cleared browser YouTube API key');
    renderCurrentView();
  });

  document.getElementById('ytResizeBtn').addEventListener('click', () => {
    document.getElementById('ytPlayerDock').classList.toggle('theater');
  });
  document.getElementById('ytStopBtn').addEventListener('click', () => {
    player.stopYouTube();
    showToast('Stopped YouTube stream');
  });

  document.getElementById('toggleSimilarPanelBtn').addEventListener('click', () => {
    const panel = document.getElementById('rightPanel');
    const collapsed = panel.classList.toggle('collapsed');
    document.getElementById('toggleSimilarPanelBtn').classList.toggle('active', !collapsed);
  });
  document.getElementById('closePanelBtn').addEventListener('click', () => {
    document.getElementById('rightPanel').classList.add('collapsed');
    document.getElementById('toggleSimilarPanelBtn').classList.remove('active');
  });
  document.querySelectorAll('.panel-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchPanelTab(tab.dataset.panelTab));
  });
  document.getElementById('autoplaySimilarToggle').addEventListener('change', (e) => {
    player.autoplaySimilar = e.target.checked;
  });
  document.getElementById('clearQueueBtn').addEventListener('click', () => {
    player.clearQueue();
    showToast('Cleared upcoming queue');
  });

  document.getElementById('playPauseBtn').addEventListener('click', () => {
    if (!player.currentTrack && state.catalog?.tracks?.length) {
      player.playTrack(state.catalog.tracks[0], state.catalog.tracks.slice(0, 8));
    } else {
      player.togglePlay();
    }
  });
  document.getElementById('nextBtn').addEventListener('click', () => player.next(false));
  document.getElementById('prevBtn').addEventListener('click', () => player.prev());
  document.getElementById('shuffleBtn').addEventListener('click', () => {
    const s = player.toggleShuffle();
    showToast(s ? 'Shuffle enabled' : 'Shuffle disabled');
  });
  document.getElementById('repeatBtn').addEventListener('click', () => {
    const r = player.cycleRepeat();
    showToast(`Repeat: ${r}`);
  });
  document.getElementById('seekBar').addEventListener('input', (e) => {
    player.seekToPercent(Number(e.target.value));
  });
  document.getElementById('volumeBar').addEventListener('input', (e) => {
    player.setVolume(Number(e.target.value));
  });
  document.getElementById('muteBtn').addEventListener('click', () => player.toggleMute());
  document.getElementById('playerLikeBtn').addEventListener('click', () => {
    if (!player.currentTrack) return;
    handleAction('toggle-like', { dataset: { id: player.currentTrack.id } });
  });
  document.getElementById('playerArtistBtn').addEventListener('click', () => {
    if (player.currentTrack && !player.currentTrack.isExternal) {
      navigate('artist', player.currentTrack.artistId);
    }
  });
  document.getElementById('playerAlbumBtn').addEventListener('click', () => {
    if (player.currentTrack && !player.currentTrack.isExternal) {
      navigate('album', player.currentTrack.albumId);
    }
  });
  document.getElementById('quickSimilarBtn').addEventListener('click', () => {
    document.getElementById('rightPanel').classList.remove('collapsed');
    document.getElementById('toggleSimilarPanelBtn').classList.add('active');
    switchPanelTab('similar');
  });

  document.getElementById('expandPlayerBtn').addEventListener('click', () => {
    document.getElementById('cinemaModal').classList.remove('hidden');
    renderCinemaModal();
  });
  document.getElementById('closeCinemaBtn').addEventListener('click', () => {
    document.getElementById('cinemaModal').classList.add('hidden');
    player.setExtraCanvas(null);
  });
  document.querySelector('.cinema-backdrop').addEventListener('click', () => {
    document.getElementById('cinemaModal').classList.add('hidden');
    player.setExtraCanvas(null);
  });

  document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === '/' && !typing) {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === ' ' && !typing) {
      e.preventDefault();
      document.getElementById('playPauseBtn').click();
    } else if (e.key === 'Escape') {
      document.getElementById('searchDropdown').classList.add('hidden');
      document.getElementById('cinemaModal').classList.add('hidden');
      document.getElementById('ytSettingsModal').classList.add('hidden');
      player.setExtraCanvas(null);
    }
  });
}

async function init() {
  bindGlobalEvents();
  saveLibrary();
  Object.values(state.savedYouTubeTracks).forEach(registerTrack);

  const [catalog, ytStatus] = await Promise.all([
    fetchJson('/api/catalog'),
    fetchJson('/api/youtube/status').catch(() => ({ configured: false }))
  ]);
  state.catalog = catalog;
  state.catalog.tracks.forEach(registerTrack);
  state.ytServerConfigured = Boolean(ytStatus.configured);
  updateYouTubeStatusUI();

  const quickGenres = document.getElementById('sidebarGenreList');
  quickGenres.innerHTML = state.catalog.genres
    .map(
      (g) => `
        <button class="quick-genre-btn" data-nav="genre" data-id="${escapeHtml(g.id)}">
          <span class="genre-dot" style="background:${escapeHtml(g.color)}"></span>
          <span>${escapeHtml(g.name)}</span>
        </button>
      `
    )
    .join('');

  const firstTrack = state.catalog.tracks[0];
  await loadSimilarForTrack(firstTrack);
  await navigate('home');
}

init().catch((err) => {
  document.getElementById('mainContent').innerHTML = `<div class="panel-empty">Failed to initialize Sonora: ${escapeHtml(err.message)}</div>`;
});
