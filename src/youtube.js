// YouTube Data API v3 search, metadata normalization, and similarity helper

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

export function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

export function parseIsoDuration(iso = '') {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso).trim());
  if (!m) return 0;
  const hours = Number(m[1] || 0);
  const mins = Number(m[2] || 0);
  const secs = Number(m[3] || 0);
  return hours * 3600 + mins * 60 + secs;
}

export function extractYouTubeVideoId(input = '') {
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const u = new URL(trimmed);
    if (u.hostname === 'youtu.be') {
      const seg = u.pathname.replace(/^\//, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(seg) ? seg : null;
    }
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live');
      if (embedIdx >= 0 && parts[embedIdx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[embedIdx + 1])) {
        return parts[embedIdx + 1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

function cleanChannelArtist(channelTitle = '') {
  return decodeHtmlEntities(channelTitle)
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .trim();
}

function normalizeYouTubeVideo(item, fallbackGenre = 'YouTube Music') {
  const videoId = typeof item.id === 'string' ? item.id : item.id?.videoId;
  const snippet = item.snippet || {};
  const details = item.contentDetails || {};
  const stats = item.statistics || {};
  const thumbs = snippet.thumbnails || {};
  const artUrl =
    thumbs.maxres?.url ||
    thumbs.standard?.url ||
    thumbs.high?.url ||
    thumbs.medium?.url ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const duration = details.duration ? parseIsoDuration(details.duration) : 0;
  const tags = Array.isArray(snippet.tags) ? snippet.tags.slice(0, 5) : [];

  return {
    id: `yt-${videoId}`,
    videoId,
    isYouTube: true,
    isExternal: true,
    source: 'YouTube Full Track',
    title: decodeHtmlEntities(snippet.title || `YouTube Track (${videoId})`),
    artistId: `yt-ch-${snippet.channelId || 'unknown'}`,
    artistName: cleanChannelArtist(snippet.channelTitle || 'YouTube Artist'),
    albumId: `yt-alb-${videoId}`,
    albumTitle: 'YouTube Music',
    genre: 'youtube',
    genreName: fallbackGenre,
    duration: duration || 210,
    year: snippet.publishedAt ? new Date(snippet.publishedAt).getFullYear() : new Date().getFullYear(),
    bpm: 112,
    key: 'Full Stream',
    moods: tags.length ? tags : ['full-track', 'youtube'],
    plays: Number(stats.viewCount || 0),
    artUrl,
    streamUrl: `youtube:${videoId}`,
    tags
  };
}

async function fetchYouTubeJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.error?.message || `YouTube API HTTP ${resp.status}`;
      const err = new Error(msg);
      err.status = resp.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchYouTubeTracks(query, apiKey, { limit = 12, genreHint = 'YouTube Music' } = {}) {
  if (!apiKey) {
    return {
      ok: false,
      needsKey: true,
      online: true,
      tracks: [],
      message: 'YouTube Data API v3 key is not configured.'
    };
  }
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return { ok: true, needsKey: false, online: true, tracks: [] };
  }

  try {
    const maxResults = Math.min(20, Math.max(1, Number(limit || 12)));
    const searchUrl =
      `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&videoEmbeddable=true` +
      `&maxResults=${maxResults}&q=${encodeURIComponent(cleanQuery)}&key=${encodeURIComponent(apiKey)}`;

    const searchData = await fetchYouTubeJson(searchUrl);
    const videoIds = (searchData.items || []).map((i) => i.id?.videoId).filter(Boolean);

    if (!videoIds.length) {
      return { ok: true, needsKey: false, online: true, query: cleanQuery, tracks: [] };
    }

    const detailsUrl =
      `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,statistics` +
      `&id=${encodeURIComponent(videoIds.join(','))}&key=${encodeURIComponent(apiKey)}`;
    const detailsData = await fetchYouTubeJson(detailsUrl);

    const tracks = (detailsData.items || [])
      .filter((item) => item.status?.embeddable !== false)
      .map((item) => normalizeYouTubeVideo(item, genreHint));

    return {
      ok: true,
      needsKey: false,
      online: true,
      query: cleanQuery,
      tracks
    };
  } catch (err) {
    const isNetwork = err.name === 'AbortError' || err.cause?.code || err.message === 'fetch failed';
    return {
      ok: false,
      needsKey: false,
      online: !isNetwork,
      query: cleanQuery,
      tracks: [],
      message: isNetwork
        ? 'YouTube search unreachable (offline or restricted network).'
        : `YouTube API error: ${err.message}`
    };
  }
}

export async function getYouTubeVideoById(videoId, apiKey) {
  const cleanId = extractYouTubeVideoId(videoId);
  if (!cleanId) return null;

  if (!apiKey) {
    return {
      id: `yt-${cleanId}`,
      videoId: cleanId,
      isYouTube: true,
      isExternal: true,
      source: 'YouTube Direct',
      title: `YouTube Track (${cleanId})`,
      artistId: 'yt-direct',
      artistName: 'YouTube Player',
      albumId: `yt-alb-${cleanId}`,
      albumTitle: 'Direct Stream',
      genre: 'youtube',
      genreName: 'YouTube Full Track',
      duration: 240,
      year: new Date().getFullYear(),
      bpm: 110,
      key: 'Full Stream',
      moods: ['youtube', 'full-track'],
      plays: 0,
      artUrl: `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`,
      streamUrl: `youtube:${cleanId}`
    };
  }

  try {
    const detailsUrl =
      `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,statistics` +
      `&id=${encodeURIComponent(cleanId)}&key=${encodeURIComponent(apiKey)}`;
    const data = await fetchYouTubeJson(detailsUrl);
    const item = data.items?.[0];
    return item ? normalizeYouTubeVideo(item) : null;
  } catch {
    return {
      id: `yt-${cleanId}`,
      videoId: cleanId,
      isYouTube: true,
      isExternal: true,
      source: 'YouTube Direct',
      title: `YouTube Track (${cleanId})`,
      artistId: 'yt-direct',
      artistName: 'YouTube Player',
      albumId: `yt-alb-${cleanId}`,
      albumTitle: 'Direct Stream',
      genre: 'youtube',
      genreName: 'YouTube Full Track',
      duration: 240,
      year: new Date().getFullYear(),
      bpm: 110,
      key: 'Full Stream',
      moods: ['youtube', 'full-track'],
      plays: 0,
      artUrl: `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`,
      streamUrl: `youtube:${cleanId}`
    };
  }
}

export async function getSimilarYouTubeTracks({ videoId = '', title = '', artist = '', apiKey = '', limit = 8 }) {
  if (!apiKey) {
    return {
      ok: false,
      needsKey: true,
      similar: [],
      message: 'Configure a YouTube Data API v3 key to load similar YouTube tracks.'
    };
  }

  let seedTitle = decodeHtmlEntities(title);
  let seedArtist = cleanChannelArtist(artist);
  let seedTags = [];

  if (videoId) {
    try {
      const detailsUrl =
        `${YOUTUBE_API_BASE}/videos?part=snippet` +
        `&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
      const data = await fetchYouTubeJson(detailsUrl);
      const snippet = data.items?.[0]?.snippet;
      if (snippet) {
        if (!seedTitle) seedTitle = decodeHtmlEntities(snippet.title);
        if (!seedArtist) seedArtist = cleanChannelArtist(snippet.channelTitle);
        seedTags = Array.isArray(snippet.tags) ? snippet.tags.slice(0, 3) : [];
      }
    } catch {
      // Proceed with provided title/artist
    }
  }

  // Strip common suffixes like (Official Video) / [Lyrics] for cleaner similarity discovery
  const coreTitle = seedTitle
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/\b(official|music video|audio|lyrics|hd|4k|visualizer)\b/gi, '')
    .trim();

  const searchQuery = [seedArtist, coreTitle, seedTags[0]].filter(Boolean).join(' ').trim() || 'music mix';
  const result = await searchYouTubeTracks(searchQuery, apiKey, { limit: limit + 4 });
  if (!result.ok) {
    return { ok: false, needsKey: result.needsKey, similar: [], message: result.message };
  }

  const filtered = result.tracks.filter((t) => t.videoId !== videoId).slice(0, limit);
  const similar = filtered.map((track, idx) => {
    const sameArtist = seedArtist && track.artistName.toLowerCase().includes(seedArtist.toLowerCase());
    const reasons = [];
    if (sameArtist) reasons.push(`Related to ${seedArtist}`);
    else reasons.push('YouTube Music match');
    if (seedTags[0]) reasons.push(`Style: ${seedTags[0]}`);
    reasons.push('Full stream');
    return {
      track,
      matchPercent: Math.max(76, 95 - idx * 2),
      reasons: reasons.slice(0, 2)
    };
  });

  return { ok: true, needsKey: false, similar };
}
