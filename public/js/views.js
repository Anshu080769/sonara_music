// Modular UI view renderers for Sonora

const trackRegistry = new Map();
const listRegistry = new Map();

export function registerTrack(track) {
  if (track && track.id) trackRegistry.set(track.id, track);
  return track?.id || '';
}

export function getRegisteredTrack(id) {
  return trackRegistry.get(id) || null;
}

export function registerTrackList(key, tracks = []) {
  tracks.forEach(registerTrack);
  listRegistry.set(key, tracks);
  return key;
}

export function getRegisteredTrackList(key) {
  return listRegistry.get(key) || [];
}

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(sec = 0) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

export function formatPlays(n = 0) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const PLAY_SVG = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 5l13 7-13 7V5z" fill="currentColor"/></svg>`;

export function renderTrackRow(track, idx, state) {
  registerTrack(track);
  const isCurrent = state.currentTrack?.id === track.id;
  const isPlaying = isCurrent && state.isPlaying;
  const isLiked = state.likedIds.includes(track.id);
  const tid = escapeHtml(track.id);

  return `
    <div class="track-row ${isCurrent ? 'playing' : ''}" data-track-id="${tid}" data-row-num="${idx + 1}">
      <div class="track-idx">
        ${
          isPlaying
            ? `<div class="eq-bars" aria-label="Playing"><span></span><span></span><span></span></div>`
            : `<span class="track-idx-num">${idx + 1}</span>
               <button class="track-row-play" data-action="play-track" data-track-id="${tid}" title="Play ${escapeHtml(track.title)}">
                 ${PLAY_SVG}
               </button>`
        }
      </div>
      <img class="track-thumb" src="${escapeHtml(track.artUrl)}" alt="${escapeHtml(track.albumTitle)}" data-action="play-track" data-track-id="${tid}">
      <div class="track-main">
        <div class="track-title" data-action="play-track" data-track-id="${tid}">${escapeHtml(track.title)}</div>
        <div class="track-artist-line">
          ${
            track.isExternal
              ? `<span>${escapeHtml(track.artistName)}</span>`
              : `<span class="inline-link" data-nav="artist" data-id="${escapeHtml(track.artistId)}">${escapeHtml(track.artistName)}</span>`
          }
          ${
            track.isYouTube
              ? `<span class="tag-badge yt">YouTube Full</span>`
              : track.isExternal
                ? `<span class="tag-badge external">Web Preview</span>`
                : ''
          }
        </div>
      </div>
      <div class="track-album-col">
        ${
          track.isExternal
            ? `<span>${escapeHtml(track.albumTitle)}</span>`
            : `<span class="inline-link" data-nav="album" data-id="${escapeHtml(track.albumId)}">${escapeHtml(track.albumTitle)}</span>`
        }
      </div>
      <div class="track-meta-col">
        <span class="tag-badge">${escapeHtml(track.genreName || track.genre)}</span>
        <span>${formatTime(track.duration)}</span>
      </div>
      <div class="track-actions-col">
        <button class="tiny-action ${isLiked ? 'liked' : ''}" data-action="toggle-like" data-id="${tid}" title="Like">
          ${isLiked ? '♥' : '♡'}
        </button>
        <button class="tiny-action" data-action="queue-track" data-track-id="${tid}" title="Add to queue">+Queue</button>
        ${
          !track.isExternal || track.isYouTube
            ? `<button class="tiny-action" data-action="show-similar" data-id="${tid}" title="Similar tracks">Similar</button>`
            : ''
        }
      </div>
    </div>
  `;
}

export function renderAlbumCard(album, extraBadge = '', extraReason = '') {
  return `
    <div class="media-card" data-nav="album" data-id="${escapeHtml(album.id)}">
      <div class="card-art-wrap">
        <img src="${escapeHtml(album.artUrl)}" alt="${escapeHtml(album.title)}" loading="lazy">
        <button class="card-play-fab" data-action="play-album" data-id="${escapeHtml(album.id)}" title="Play album">
          ${PLAY_SVG}
        </button>
      </div>
      <div class="card-title">${escapeHtml(album.title)}</div>
      <div class="card-sub">${escapeHtml(album.artistName)} · ${album.year}</div>
      ${extraBadge ? `<span class="match-badge">${escapeHtml(extraBadge)}</span>` : ''}
      ${extraReason ? `<div class="reason-text">${escapeHtml(extraReason)}</div>` : ''}
    </div>
  `;
}

export function renderArtistCard(artist, extraBadge = '', extraReason = '') {
  return `
    <div class="media-card" data-nav="artist" data-id="${escapeHtml(artist.id)}">
      <div class="card-art-wrap round">
        <img src="${escapeHtml(artist.artUrl)}" alt="${escapeHtml(artist.name)}" loading="lazy">
        <button class="card-play-fab" data-action="play-artist" data-id="${escapeHtml(artist.id)}" title="Play artist">
          ${PLAY_SVG}
        </button>
      </div>
      <div class="card-title">${escapeHtml(artist.name)}</div>
      <div class="card-sub">${escapeHtml(artist.primaryGenreName)} · ${formatPlays(artist.monthlyListeners)} listeners</div>
      ${extraBadge ? `<span class="match-badge">${escapeHtml(extraBadge)}</span>` : ''}
      ${extraReason ? `<div class="reason-text">${escapeHtml(extraReason)}</div>` : ''}
    </div>
  `;
}

export function renderSimilarTrackCard(rec) {
  const { track, matchPercent, reasons } = rec;
  const tid = escapeHtml(registerTrack(track));
  return `
    <div class="media-card" data-action="play-track" data-track-id="${tid}">
      <div class="card-art-wrap">
        <img src="${escapeHtml(track.artUrl)}" alt="${escapeHtml(track.title)}" loading="lazy">
        <button class="card-play-fab" data-action="play-track" data-track-id="${tid}" title="Stream ${escapeHtml(track.title)}">
          ${PLAY_SVG}
        </button>
      </div>
      <div class="card-title">${escapeHtml(track.title)}</div>
      <div class="card-sub">
        <span class="inline-link" data-nav="artist" data-id="${escapeHtml(track.artistId)}">${escapeHtml(track.artistName)}</span>
      </div>
      <span class="match-badge">${matchPercent}% match</span>
      <div class="reason-text">${escapeHtml((reasons || []).join(' · '))}</div>
    </div>
  `;
}

export function renderGenreCard(genre) {
  return `
    <div class="genre-card" data-nav="genre" data-id="${escapeHtml(genre.id)}"
      style="background: linear-gradient(135deg, ${escapeHtml(genre.color)}, ${escapeHtml(genre.accent)});">
      <div>
        <h3 class="genre-card-title">${escapeHtml(genre.name)}</h3>
        <div class="genre-card-sub">${escapeHtml(genre.tagline)}</div>
      </div>
      <div class="genre-card-meta">
        <span class="genre-pill-stat">${genre.trackCount} tracks</span>
        <span class="genre-pill-stat">${genre.artistCount} artists</span>
        <span class="genre-pill-stat">${genre.bpmRange[0]}–${genre.bpmRange[1]} BPM</span>
      </div>
      <button class="card-play-fab" data-action="play-genre" data-id="${escapeHtml(genre.id)}" title="Stream ${escapeHtml(genre.name)}">
        ${PLAY_SVG}
      </button>
    </div>
  `;
}

export function renderHomeView(catalog, recommendations, state) {
  const featuredTrack = state.currentTrack && !state.currentTrack.isExternal
    ? state.currentTrack
    : catalog.tracks[0];
  const featuredId = escapeHtml(registerTrack(featuredTrack));
  const topTracks = [...catalog.tracks].sort((a, b) => b.plays - a.plays).slice(0, 6);
  const topListKey = registerTrackList('home-top', topTracks);

  return `
    <section class="hero-banner">
      <img class="hero-art" src="${escapeHtml(featuredTrack.artUrl)}" alt="${escapeHtml(featuredTrack.title)}">
      <div>
        <div class="hero-kicker">
          <span>FEATURED STREAM</span>
          <span>·</span>
          <span>${escapeHtml(featuredTrack.genreName)}</span>
          <span>·</span>
          <span>${featuredTrack.bpm} BPM</span>
        </div>
        <h1 class="hero-title">${escapeHtml(featuredTrack.title)}</h1>
        <p class="hero-desc">
          By <strong class="inline-link" data-nav="artist" data-id="${escapeHtml(featuredTrack.artistId)}">${escapeHtml(featuredTrack.artistName)}</strong>
          from <em>${escapeHtml(featuredTrack.albumTitle)}</em>.
          Browse our full catalog by artist, genre, or album — stream instantly and uncover smart similar suggestions.
        </p>
        <div class="hero-actions">
          <button class="btn-primary" data-action="play-track" data-track-id="${featuredId}">
            ${PLAY_SVG} Stream Now
          </button>
          <button class="btn-secondary" data-action="show-similar" data-id="${featuredId}">
            Find Similar Tracks
          </button>
          <button class="btn-secondary" data-nav="genres">
            Explore Genres
          </button>
        </div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Recommended &amp; Similar For You</h2>
          <p class="section-sub">Dynamically tuned to your listening and liked tracks</p>
        </div>
        <button class="text-btn" data-nav="library">View Your Taste →</button>
      </div>
      <div class="card-grid">
        ${recommendations.slice(0, 6).map(renderSimilarTrackCard).join('')}
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Browse by Genre</h2>
          <p class="section-sub">Jump into curated sonic moods and tempo realms</p>
        </div>
        <button class="text-btn" data-nav="genres">All ${catalog.genres.length} Genres →</button>
      </div>
      <div class="genre-grid">
        ${catalog.genres.slice(0, 4).map(renderGenreCard).join('')}
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Browse by Artist</h2>
          <p class="section-sub">Studio artists across electronic, lo-fi, jazz, indie &amp; classical</p>
        </div>
        <button class="text-btn" data-nav="artists">All ${catalog.artists.length} Artists →</button>
      </div>
      <div class="card-grid">
        ${catalog.artists.slice(0, 6).map((a) => renderArtistCard(a)).join('')}
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Browse by Album</h2>
          <p class="section-sub">Complete studio releases ready to stream</p>
        </div>
        <button class="text-btn" data-nav="albums">All ${catalog.albums.length} Albums →</button>
      </div>
      <div class="card-grid">
        ${catalog.albums.slice(0, 6).map((a) => renderAlbumCard(a)).join('')}
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Trending Tracks</h2>
          <p class="section-sub">Most streamed cuts right now</p>
        </div>
        <button class="btn-secondary" data-action="play-list" data-list-key="${topListKey}">Play All Top</button>
      </div>
      <div class="track-list">
        ${topTracks.map((t, i) => renderTrackRow(t, i, state)).join('')}
      </div>
    </section>
  `;
}

export function renderSearchView({ query, localResults, webResults, youtubeResults, webEnabled, genreFilter, sort, genres, state }) {
  const { tracks = [], artists = [], albums = [], genres: matchedGenres = [], similarTracks = [], similarArtists = [] } = localResults || {};
  const topTrack = tracks[0];
  const searchListKey = registerTrackList('search-results', tracks);

  const genreChips = `
    <div class="chip-row">
      <button class="filter-chip ${!genreFilter ? 'active' : ''}" data-action="search-filter-genre" data-id="">All Genres</button>
      ${genres.map((g) => `<button class="filter-chip ${genreFilter === g.id ? 'active' : ''}" data-action="search-filter-genre" data-id="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`).join('')}
    </div>
  `;

  let topMatchHtml = '';
  if (query && topTrack) {
    const topTid = escapeHtml(registerTrack(topTrack));
    topMatchHtml = `
      <section class="section-block">
        <div class="section-header"><h2 class="section-title">Top Match</h2></div>
        <div class="hero-banner" style="margin-bottom:0">
          <img class="hero-art" src="${escapeHtml(topTrack.artUrl)}" alt="${escapeHtml(topTrack.title)}">
          <div>
            <div class="hero-kicker">TRACK MATCH · ${escapeHtml(topTrack.genreName)}</div>
            <h2 class="hero-title">${escapeHtml(topTrack.title)}</h2>
            <p class="hero-desc">
              <span class="inline-link" data-nav="artist" data-id="${escapeHtml(topTrack.artistId)}">${escapeHtml(topTrack.artistName)}</span>
              · <span class="inline-link" data-nav="album" data-id="${escapeHtml(topTrack.albumId)}">${escapeHtml(topTrack.albumTitle)}</span>
              · ${topTrack.bpm} BPM · ${formatTime(topTrack.duration)}
            </p>
            <div class="hero-actions">
              <button class="btn-primary" data-action="play-track" data-track-id="${topTid}">${PLAY_SVG} Stream Track</button>
              <button class="btn-secondary" data-action="show-similar" data-id="${topTid}">Similar Tracks</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  let ytHtml = '';
  if (webEnabled && query) {
    if (youtubeResults === null) {
      ytHtml = `<section class="section-block"><h2 class="section-title">YouTube Full Tracks</h2><p class="section-sub">Searching YouTube Music...</p></section>`;
    } else if (youtubeResults?.needsKey) {
      ytHtml = `
        <section class="section-block">
          <div class="section-header">
            <div>
              <h2 class="section-title">YouTube Full Tracks</h2>
              <p class="section-sub">Add your YouTube Data API v3 key to search &amp; stream full-length tracks for "${escapeHtml(query)}".</p>
            </div>
            <button class="btn-secondary" data-action="open-yt-settings">Configure YouTube Key</button>
          </div>
        </section>
      `;
    } else if (youtubeResults?.ok && youtubeResults.tracks?.length) {
      const ytListKey = registerTrackList('search-yt-results', youtubeResults.tracks);
      ytHtml = `
        <section class="section-block">
          <div class="section-header">
            <div>
              <h2 class="section-title">YouTube Full Tracks (${youtubeResults.tracks.length})</h2>
              <p class="section-sub">Full-length playback via YouTube IFrame Player API</p>
            </div>
            <button class="btn-secondary" data-action="play-list" data-list-key="${ytListKey}">Play All Full Tracks</button>
          </div>
          <div class="track-list">
            ${youtubeResults.tracks.map((t, i) => renderTrackRow(t, i, state)).join('')}
          </div>
        </section>
      `;
    } else if (youtubeResults && !youtubeResults.ok && youtubeResults.message) {
      ytHtml = `
        <section class="section-block">
          <div class="section-header">
            <div>
              <h2 class="section-title">YouTube Full Tracks</h2>
              <p class="section-sub">${escapeHtml(youtubeResults.message)}</p>
            </div>
          </div>
        </section>
      `;
    }
  }

  let webHtml = '';
  if (webEnabled && query) {
    if (webResults === null) {
      webHtml = `<section class="section-block"><h2 class="section-title">Live Web Search (iTunes)</h2><p class="section-sub">Searching global catalog...</p></section>`;
    } else if (webResults.online && webResults.tracks?.length) {
      webHtml = `
        <section class="section-block">
          <div class="section-header">
            <div>
              <h2 class="section-title">Live Web Catalog Results</h2>
              <p class="section-sub">30-second previews streamed from iTunes Search API</p>
            </div>
          </div>
          <div class="track-list">
            ${webResults.tracks.map((t, i) => renderTrackRow(t, i, state)).join('')}
          </div>
        </section>
      `;
    } else if (webResults && !webResults.online) {
      webHtml = `
        <section class="section-block">
          <div class="section-header">
            <div>
              <h2 class="section-title">Live Web Catalog</h2>
              <p class="section-sub">${escapeHtml(webResults.message || 'Offline mode — showing local studio catalog results.')}</p>
            </div>
          </div>
        </section>
      `;
    }
  }

  return `
    <div class="section-header">
      <div>
        <h1 class="section-title">${query ? `Search results for "${escapeHtml(query)}"` : 'Explore & Filter Music'}</h1>
        <p class="section-sub">${tracks.length} tracks · ${artists.length} artists · ${albums.length} albums</p>
      </div>
      <select class="sort-select" id="searchSortSelect" aria-label="Sort results">
        <option value="relevance" ${sort === 'relevance' ? 'selected' : ''}>Sort: Relevance</option>
        <option value="plays" ${sort === 'plays' ? 'selected' : ''}>Sort: Most Played</option>
        <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Sort: Newest</option>
        <option value="title" ${sort === 'title' ? 'selected' : ''}>Sort: A–Z</option>
      </select>
    </div>

    <div class="filter-bar">${genreChips}</div>

    ${topMatchHtml}

    ${tracks.length ? `
      <section class="section-block">
        <div class="section-header">
          <h2 class="section-title">Tracks (${tracks.length})</h2>
          <button class="btn-secondary" data-action="play-list" data-list-key="${searchListKey}">Play Results</button>
        </div>
        <div class="track-list">${tracks.map((t, i) => renderTrackRow(t, i, state)).join('')}</div>
      </section>
    ` : ''}

    ${artists.length ? `
      <section class="section-block">
        <div class="section-header"><h2 class="section-title">Artists (${artists.length})</h2></div>
        <div class="card-grid">${artists.map((a) => renderArtistCard(a)).join('')}</div>
      </section>
    ` : ''}

    ${albums.length ? `
      <section class="section-block">
        <div class="section-header"><h2 class="section-title">Albums (${albums.length})</h2></div>
        <div class="card-grid">${albums.map((a) => renderAlbumCard(a)).join('')}</div>
      </section>
    ` : ''}

    ${matchedGenres.length ? `
      <section class="section-block">
        <div class="section-header"><h2 class="section-title">Genres (${matchedGenres.length})</h2></div>
        <div class="genre-grid">${matchedGenres.map(renderGenreCard).join('')}</div>
      </section>
    ` : ''}

    ${ytHtml}

    ${webHtml}

    ${similarTracks.length ? `
      <section class="section-block">
        <div class="section-header">
          <div>
            <h2 class="section-title">Similar Suggestions</h2>
            <p class="section-sub">Tracks and artists with matching mood, genre &amp; tempo</p>
          </div>
        </div>
        <div class="card-grid">${similarTracks.map(renderSimilarTrackCard).join('')}</div>
      </section>
    ` : ''}

    ${similarArtists.length ? `
      <section class="section-block">
        <div class="section-header"><h2 class="section-title">Similar Artists to Explore</h2></div>
        <div class="card-grid">${similarArtists.map((r) => renderArtistCard(r.artist, `${r.matchPercent}% match`, r.reasons.join(' · '))).join('')}</div>
      </section>
    ` : ''}

    ${!tracks.length && !artists.length && !albums.length && !matchedGenres.length ? `
      <div class="panel-empty" style="padding:48px 0">
        No local matches for "${escapeHtml(query)}". Try searching a mood like <em>nocturnal</em>, <em>cozy</em>, or browse by Genre or Artist!
      </div>
    ` : ''}
  `;
}

export function renderArtistsView(catalog, { genreFilter, sort }) {
  let list = [...catalog.artists];
  if (genreFilter) list = list.filter((a) => a.genres.includes(genreFilter));
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'tracks') list.sort((a, b) => b.trackCount - a.trackCount);
  else list.sort((a, b) => b.monthlyListeners - a.monthlyListeners);

  return `
    <div class="section-header">
      <div>
        <h1 class="section-title">Browse by Artist</h1>
        <p class="section-sub">Explore ${list.length} studio artists, discographies &amp; similar artist graphs</p>
      </div>
      <select class="sort-select" id="artistSortSelect" aria-label="Sort artists">
        <option value="listeners" ${sort === 'listeners' ? 'selected' : ''}>Sort: Most Listeners</option>
        <option value="name" ${sort === 'name' ? 'selected' : ''}>Sort: A–Z</option>
        <option value="tracks" ${sort === 'tracks' ? 'selected' : ''}>Sort: Most Tracks</option>
      </select>
    </div>
    <div class="filter-bar">
      <div class="chip-row">
        <button class="filter-chip ${!genreFilter ? 'active' : ''}" data-action="artist-filter-genre" data-id="">All Genres</button>
        ${catalog.genres.map((g) => `<button class="filter-chip ${genreFilter === g.id ? 'active' : ''}" data-action="artist-filter-genre" data-id="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`).join('')}
      </div>
    </div>
    <div class="card-grid">${list.map((a) => renderArtistCard(a)).join('')}</div>
  `;
}

export function renderArtistDetailView(data, state, catalog) {
  const { artist, albums, tracks, similarArtists, similarTracks } = data;
  const listKey = registerTrackList(`artist-${artist.id}`, tracks);
  const genreNameMap = new Map((catalog?.genres || []).map((g) => [g.id, g.name]));
  return `
    <div class="detail-hero">
      <img class="detail-cover round" src="${escapeHtml(artist.artUrl)}" alt="${escapeHtml(artist.name)}">
      <div class="detail-info">
        <div class="detail-kicker">ARTIST · ${escapeHtml(artist.primaryGenreName)}</div>
        <h1 class="detail-title">${escapeHtml(artist.name)}</h1>
        <p class="detail-sub">${escapeHtml(artist.bio)}</p>
        <div class="detail-stats">
          <span>${escapeHtml(artist.origin)}</span>
          <span>·</span>
          <span>Formed ${artist.formedYear}</span>
          <span>·</span>
          <span>${formatPlays(artist.monthlyListeners)} monthly listeners</span>
          <span>·</span>
          <span>${albums.length} albums · ${tracks.length} tracks</span>
        </div>
        <div class="hero-actions">
          <button class="btn-primary" data-action="play-list" data-list-key="${listKey}">${PLAY_SVG} Play All</button>
          <button class="btn-secondary" data-action="shuffle-list" data-list-key="${listKey}">Shuffle Artist</button>
          <button class="btn-secondary" data-action="search-youtube-query" data-query="${escapeHtml(artist.name + ' full music')}">YouTube Full Tracks</button>
          ${artist.genres.map((gid) => `<button class="filter-chip" data-nav="genre" data-id="${escapeHtml(gid)}">${escapeHtml(genreNameMap.get(gid) || gid)}</button>`).join('')}
        </div>
      </div>
    </div>

    <section class="section-block">
      <div class="section-header"><h2 class="section-title">Popular Tracks</h2></div>
      <div class="track-list">${tracks.map((t, i) => renderTrackRow(t, i, state)).join('')}</div>
    </section>

    <section class="section-block">
      <div class="section-header"><h2 class="section-title">Albums &amp; Releases</h2></div>
      <div class="card-grid">${albums.map((a) => renderAlbumCard(a)).join('')}</div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Similar Artists</h2>
          <p class="section-sub">Artists sharing genre DNA, mood, and tempo range with ${escapeHtml(artist.name)}</p>
        </div>
      </div>
      <div class="card-grid">
        ${similarArtists.map((r) => renderArtistCard(r.artist, `${r.matchPercent}% match`, r.reasons.join(' · '))).join('')}
      </div>
    </section>

    ${similarTracks.length ? `
      <section class="section-block">
        <div class="section-header">
          <div>
            <h2 class="section-title">Similar Tracks From Other Artists</h2>
            <p class="section-sub">Seamless next listens beyond ${escapeHtml(artist.name)}'s catalog</p>
          </div>
        </div>
        <div class="card-grid">${similarTracks.map(renderSimilarTrackCard).join('')}</div>
      </section>
    ` : ''}
  `;
}

export function renderGenresView(catalog) {
  return `
    <div class="section-header">
      <div>
        <h1 class="section-title">Browse by Genre</h1>
        <p class="section-sub">Choose a sonic world to explore tracks, artists, albums, and related genres</p>
      </div>
    </div>
    <div class="genre-grid">${catalog.genres.map(renderGenreCard).join('')}</div>
  `;
}

export function renderGenreDetailView(data, state) {
  const { genre, tracks, artists, albums, relatedGenres } = data;
  const listKey = registerTrackList(`genre-${genre.id}`, tracks);
  return `
    <div class="detail-hero" style="background: linear-gradient(135deg, ${escapeHtml(genre.color)}44, ${escapeHtml(genre.accent)}2a, rgba(16,16,24,0.94));">
      <img class="detail-cover" src="${escapeHtml(genre.artUrl)}" alt="${escapeHtml(genre.name)}" style="height:150px;width:230px;">
      <div class="detail-info">
        <div class="detail-kicker">GENRE RADIO</div>
        <h1 class="detail-title">${escapeHtml(genre.name)}</h1>
        <p class="detail-sub">${escapeHtml(genre.description)}</p>
        <div class="detail-stats">
          <span>${tracks.length} tracks</span>
          <span>·</span>
          <span>${artists.length} artists</span>
          <span>·</span>
          <span>${albums.length} albums</span>
          <span>·</span>
          <span>${genre.bpmRange[0]}–${genre.bpmRange[1]} BPM</span>
        </div>
        <div class="hero-actions">
          <button class="btn-primary" data-action="play-list" data-list-key="${listKey}">${PLAY_SVG} Stream ${escapeHtml(genre.name)} Radio</button>
          <button class="btn-secondary" data-action="shuffle-list" data-list-key="${listKey}">Shuffle Genre</button>
          <button class="btn-secondary" data-action="search-youtube-query" data-query="${escapeHtml(genre.name + ' music mix')}">YouTube Full Tracks</button>
        </div>
      </div>
    </div>

    <section class="section-block">
      <div class="section-header"><h2 class="section-title">Tracks in ${escapeHtml(genre.name)}</h2></div>
      <div class="track-list">${tracks.map((t, i) => renderTrackRow(t, i, state)).join('')}</div>
    </section>

    <section class="section-block">
      <div class="section-header"><h2 class="section-title">Featured Artists</h2></div>
      <div class="card-grid">${artists.map((a) => renderArtistCard(a)).join('')}</div>
    </section>

    <section class="section-block">
      <div class="section-header"><h2 class="section-title">Albums</h2></div>
      <div class="card-grid">${albums.map((a) => renderAlbumCard(a)).join('')}</div>
    </section>

    ${relatedGenres.length ? `
      <section class="section-block">
        <div class="section-header">
          <div>
            <h2 class="section-title">Similar &amp; Related Genres</h2>
            <p class="section-sub">Continue exploring adjacent styles</p>
          </div>
        </div>
        <div class="genre-grid">${relatedGenres.map(renderGenreCard).join('')}</div>
      </section>
    ` : ''}
  `;
}

export function renderAlbumsView(catalog, { genreFilter, sort }) {
  let list = [...catalog.albums];
  if (genreFilter) list = list.filter((a) => a.genre === genreFilter);
  if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'artist') list.sort((a, b) => a.artistName.localeCompare(b.artistName));
  else list.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  return `
    <div class="section-header">
      <div>
        <h1 class="section-title">Browse by Album</h1>
        <p class="section-sub">Browse all ${list.length} studio albums and EPs</p>
      </div>
      <select class="sort-select" id="albumSortSelect" aria-label="Sort albums">
        <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Sort: Newest First</option>
        <option value="title" ${sort === 'title' ? 'selected' : ''}>Sort: Title A–Z</option>
        <option value="artist" ${sort === 'artist' ? 'selected' : ''}>Sort: Artist A–Z</option>
      </select>
    </div>
    <div class="filter-bar">
      <div class="chip-row">
        <button class="filter-chip ${!genreFilter ? 'active' : ''}" data-action="album-filter-genre" data-id="">All Genres</button>
        ${catalog.genres.map((g) => `<button class="filter-chip ${genreFilter === g.id ? 'active' : ''}" data-action="album-filter-genre" data-id="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`).join('')}
      </div>
    </div>
    <div class="card-grid">${list.map((a) => renderAlbumCard(a)).join('')}</div>
  `;
}

export function renderAlbumDetailView(data, state) {
  const { album, artist, tracks, similarAlbums } = data;
  const listKey = registerTrackList(`album-${album.id}`, tracks);
  return `
    <div class="detail-hero">
      <img class="detail-cover" src="${escapeHtml(album.artUrl)}" alt="${escapeHtml(album.title)}">
      <div class="detail-info">
        <div class="detail-kicker">ALBUM · ${escapeHtml(album.genreName)} · ${album.year}</div>
        <h1 class="detail-title">${escapeHtml(album.title)}</h1>
        <p class="detail-sub">${escapeHtml(album.description)}</p>
        <div class="detail-stats">
          <strong class="inline-link" data-nav="artist" data-id="${escapeHtml(artist.id)}">${escapeHtml(artist.name)}</strong>
          <span>·</span>
          <span>${album.trackCount} tracks</span>
          <span>·</span>
          <span>${formatTime(album.totalDuration)} runtime</span>
          <span>·</span>
          <span>${escapeHtml(album.label)}</span>
        </div>
        <div class="hero-actions">
          <button class="btn-primary" data-action="play-list" data-list-key="${listKey}">${PLAY_SVG} Play Album</button>
          <button class="btn-secondary" data-action="shuffle-list" data-list-key="${listKey}">Shuffle</button>
          <button class="btn-secondary" data-nav="genre" data-id="${escapeHtml(album.genre)}">More ${escapeHtml(album.genreName)}</button>
          <button class="btn-secondary" data-action="search-youtube-query" data-query="${escapeHtml(album.title + ' ' + artist.name)}">YouTube Full Album</button>
        </div>
      </div>
    </div>

    <section class="section-block">
      <div class="section-header"><h2 class="section-title">Tracklist</h2></div>
      <div class="track-list">${tracks.map((t, i) => renderTrackRow(t, i, state)).join('')}</div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Similar Albums You Might Like</h2>
          <p class="section-sub">Matched by sound palette, mood &amp; genre</p>
        </div>
      </div>
      <div class="card-grid">
        ${similarAlbums.map((r) => renderAlbumCard(r.album, `${r.matchPercent}% match`, r.reasons.join(' · '))).join('')}
      </div>
    </section>
  `;
}

export function renderAllTracksView(catalog, { genreFilter, sort }, state) {
  let tracks = [...catalog.tracks];
  if (genreFilter) tracks = tracks.filter((t) => t.genre === genreFilter);
  if (sort === 'title') tracks.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'bpm') tracks.sort((a, b) => b.bpm - a.bpm);
  else tracks.sort((a, b) => b.plays - a.plays);

  const listKey = registerTrackList('all-tracks', tracks);
  return `
    <div class="section-header">
      <div>
        <h1 class="section-title">All Studio Tracks (${tracks.length})</h1>
        <p class="section-sub">Stream any track directly or click Similar to branch into related songs</p>
      </div>
      <div class="hero-actions">
        <button class="btn-primary" data-action="play-list" data-list-key="${listKey}">${PLAY_SVG} Play All</button>
        <select class="sort-select" id="tracksSortSelect" aria-label="Sort tracks">
          <option value="plays" ${sort === 'plays' ? 'selected' : ''}>Sort: Most Streamed</option>
          <option value="title" ${sort === 'title' ? 'selected' : ''}>Sort: Title A–Z</option>
          <option value="bpm" ${sort === 'bpm' ? 'selected' : ''}>Sort: Tempo (BPM)</option>
        </select>
      </div>
    </div>
    <div class="filter-bar">
      <div class="chip-row">
        <button class="filter-chip ${!genreFilter ? 'active' : ''}" data-action="tracks-filter-genre" data-id="">All Genres</button>
        ${catalog.genres.map((g) => `<button class="filter-chip ${genreFilter === g.id ? 'active' : ''}" data-action="tracks-filter-genre" data-id="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`).join('')}
      </div>
    </div>
    <div class="track-list">${tracks.map((t, i) => renderTrackRow(t, i, state)).join('')}</div>
  `;
}

export function renderLibraryView(catalog, recommendations, state) {
  const trackMap = new Map(catalog.tracks.map((t) => [t.id, t]));
  const resolveSaved = (id) => trackMap.get(id) || state.savedYouTubeTracks?.[id] || getRegisteredTrack(id);
  const likedTracks = state.likedIds.map(resolveSaved).filter(Boolean);
  const recentTracks = state.recentIds.map(resolveSaved).filter(Boolean);
  const likedListKey = registerTrackList('liked-tracks', likedTracks);

  return `
    <div class="section-header">
      <div>
        <h1 class="section-title">Liked Tracks &amp; Listening History</h1>
        <p class="section-sub">Your favorites refine Sonora's similar suggestions engine</p>
      </div>
    </div>

    <section class="section-block">
      <div class="section-header">
        <h2 class="section-title">Liked Songs (${likedTracks.length})</h2>
        ${likedTracks.length ? `<button class="btn-secondary" data-action="play-list" data-list-key="${likedListKey}">Play Liked</button>` : ''}
      </div>
      ${
        likedTracks.length
          ? `<div class="track-list">${likedTracks.map((t, i) => renderTrackRow(t, i, state)).join('')}</div>`
          : `<div class="panel-empty">Click ♡ on any track to save it to your liked collection.</div>`
      }
    </section>

    <section class="section-block">
      <div class="section-header"><h2 class="section-title">Recently Streamed (${recentTracks.length})</h2></div>
      ${
        recentTracks.length
          ? `<div class="track-list">${recentTracks.map((t, i) => renderTrackRow(t, i, state)).join('')}</div>`
          : `<div class="panel-empty">Start streaming a track to build your listening history.</div>`
      }
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Recommended Based on Your Taste</h2>
          <p class="section-sub">Similar tracks calculated from your liked &amp; recent plays</p>
        </div>
      </div>
      <div class="card-grid">${recommendations.map(renderSimilarTrackCard).join('')}</div>
    </section>
  `;
}

export function renderYouTubeView({ query, results, loading, keyConfigured, genres, state }) {
  const tracks = results?.tracks || [];
  const listKey = registerTrackList('youtube-view-results', tracks);
  const quickQueries = [
    { label: 'Synthwave Radio', q: 'synthwave retrowave full album music' },
    { label: 'Lo-Fi Study Beats', q: 'lofi hip hop chill beats music' },
    { label: 'Deep House Mix', q: 'melodic deep house music' },
    { label: 'Late Night Jazz', q: 'late night smooth jazz instrumental' },
    { label: 'Indie Alt Rock', q: 'indie rock alternative full songs' },
    { label: 'Ambient Space', q: 'ambient cinematic space music' },
    { label: 'Boom Bap Hip-Hop', q: 'boom bap instrumental hip hop' },
    { label: 'Modern Piano', q: 'modern classical felt piano music' }
  ];

  return `
    <div class="detail-hero" style="background: linear-gradient(135deg, rgba(255,68,68,0.22), rgba(124,92,255,0.18), rgba(16,16,24,0.95));">
      <div class="detail-info">
        <div class="detail-kicker" style="color:#ff7a7a">YOUTUBE DATA API V3 + IFRAME PLAYER</div>
        <h1 class="detail-title">Play Full Music via YouTube</h1>
        <p class="detail-sub">
          Search full-length songs, albums, and live performances via the YouTube Data API v3, or paste any YouTube URL / Video ID below to stream immediately with queue, seek, and similar suggestions.
        </p>
        <div class="hero-actions">
          <button class="btn-secondary" data-action="open-yt-settings">
            ${keyConfigured ? '✓ YouTube API Key Ready' : 'Configure YouTube API Key'}
          </button>
        </div>
      </div>
    </div>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Search Full Music on YouTube</h2>
          <p class="section-sub">Fetches full song durations, thumbnails &amp; playable streams</p>
        </div>
      </div>
      <form id="ytSearchForm" class="yt-inline-bar">
        <input id="ytViewSearchInput" type="search" class="modal-input" placeholder="Search any artist, song, or genre on YouTube (e.g. Daft Punk Instant Crush)..." value="${escapeHtml(query || '')}">
        <button type="submit" class="btn-primary">Search YouTube</button>
      </form>
      <div class="chip-row">
        ${quickQueries.map((item) => `<button class="filter-chip" data-action="search-youtube-query" data-query="${escapeHtml(item.q)}">${escapeHtml(item.label)}</button>`).join('')}
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <div>
          <h2 class="section-title">Stream Any YouTube URL or Video ID Directly</h2>
          <p class="section-sub">Works immediately via YouTube IFrame Player API (even without an API key)</p>
        </div>
      </div>
      <form id="ytDirectForm" class="yt-inline-bar">
        <input id="ytDirectInput" type="text" class="modal-input" placeholder="Paste YouTube URL or 11-char ID (e.g. https://www.youtube.com/watch?v=5qap5aO4i9A)...">
        <button type="submit" class="btn-secondary">${PLAY_SVG} Stream Direct</button>
      </form>
    </section>

    ${
      loading
        ? `<div class="panel-empty" style="padding:36px 0">Searching YouTube Music...</div>`
        : results?.needsKey
          ? `
            <div class="yt-status-box">
              <strong>YouTube Data API v3 key required for search.</strong> Click <em>Configure YouTube API Key</em> above (or set <code>YOUTUBE_API_KEY</code> in <code>.env</code>), or paste any YouTube URL in the direct stream bar!
            </div>
          `
          : results && !results.ok && results.message
            ? `<div class="yt-status-box">${escapeHtml(results.message)}</div>`
            : tracks.length
              ? `
                <section class="section-block">
                  <div class="section-header">
                    <div>
                      <h2 class="section-title">YouTube Results (${tracks.length})</h2>
                      <p class="section-sub">Full-length streams for "${escapeHtml(query)}"</p>
                    </div>
                    <button class="btn-primary" data-action="play-list" data-list-key="${listKey}">${PLAY_SVG} Play All</button>
                  </div>
                  <div class="track-list">${tracks.map((t, i) => renderTrackRow(t, i, state)).join('')}</div>
                </section>
              `
              : query
                ? `<div class="panel-empty">No embeddable YouTube music videos found for "${escapeHtml(query)}".</div>`
                : `
                  <section class="section-block">
                    <div class="section-header"><h2 class="section-title">Browse Genres on YouTube</h2></div>
                    <div class="genre-grid">
                      ${(genres || [])
                        .map(
                          (g) => `
                            <div class="genre-card" data-action="search-youtube-query" data-query="${escapeHtml(g.name + ' music')}"
                              style="background: linear-gradient(135deg, ${escapeHtml(g.color)}, ${escapeHtml(g.accent)});">
                              <div>
                                <h3 class="genre-card-title">${escapeHtml(g.name)}</h3>
                                <div class="genre-card-sub">Search full ${escapeHtml(g.name)} tracks on YouTube</div>
                              </div>
                            </div>
                          `
                        )
                        .join('')}
                    </div>
                  </section>
                `
    }
  `;
}
