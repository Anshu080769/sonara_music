import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG } from './catalog.js';
import {
  getSimilarTracks,
  getSimilarArtists,
  getSimilarAlbums,
  getPersonalizedRecommendations
} from './similarity.js';
import { synthesizeTrackWav } from './audio-synth.js';
import { generateAlbumSvg, generateArtistSvg, generateGenreSvg } from './art-gen.js';
import {
  searchYouTubeTracks,
  getYouTubeVideoById,
  getSimilarYouTubeTracks,
  extractYouTubeVideoId
} from './youtube.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Lightweight .env loader (does not overwrite existing process.env)
try {
  const envRaw = fs.readFileSync(path.join(ROOT_DIR, '.env'), 'utf8');
  for (const line of envRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env is optional
}

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const AUDIO_CACHE_DIR =
  process.env.VERCEL || process.env.K_SERVICE || process.env.GAE_ENV
    ? path.join(os.tmpdir(), 'sonora-audio-cache')
    : path.join(ROOT_DIR, 'data', 'audio');

export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || '0.0.0.0';

function getRequestYouTubeKey(req) {
  return (process.env.YOUTUBE_API_KEY || String(req.headers['x-youtube-api-key'] || '')).trim();
}

// Quick lookup indices
const genreMap = new Map(CATALOG.genres.map((g) => [g.id, g]));
const artistMap = new Map(CATALOG.artists.map((a) => [a.id, a]));
const albumMap = new Map(CATALOG.albums.map((a) => [a.id, a]));
const trackMap = new Map(CATALOG.tracks.map((t) => [t.id, t]));

// Bounded in-memory WAV buffer cache (keeps up to 8 most recently streamed tracks)
const memoryWavCache = new Map();
const MAX_MEMORY_WAVS = 8;

async function getTrackWavBuffer(track) {
  if (memoryWavCache.has(track.id)) {
    const buf = memoryWavCache.get(track.id);
    memoryWavCache.delete(track.id);
    memoryWavCache.set(track.id, buf);
    return buf;
  }

  await fsp.mkdir(AUDIO_CACHE_DIR, { recursive: true }).catch(() => {});
  const filePath = path.join(AUDIO_CACHE_DIR, `${track.id}.wav`);
  let buf;
  try {
    buf = await fsp.readFile(filePath);
  } catch {
    buf = synthesizeTrackWav(track);
    fsp.writeFile(filePath, buf).catch(() => {});
  }

  if (memoryWavCache.size >= MAX_MEMORY_WAVS) {
    const oldestKey = memoryWavCache.keys().next().value;
    memoryWavCache.delete(oldestKey);
  }
  memoryWavCache.set(track.id, buf);
  return buf;
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return Promise.resolve(JSON.parse(req.body));
      } catch {
        return Promise.reject(new Error('Invalid JSON'));
      }
    }
    return Promise.resolve(req.body || {});
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function enrichTrack(track) {
  const artist = artistMap.get(track.artistId);
  const album = albumMap.get(track.albumId);
  const genre = genreMap.get(track.genre);
  return {
    ...track,
    artistName: artist?.name || 'Unknown Artist',
    albumTitle: album?.title || 'Single',
    genreName: genre?.name || track.genre,
    artUrl: `/api/art/album/${track.albumId}.svg`,
    streamUrl: `/api/stream/${track.id}`
  };
}

function enrichAlbum(album) {
  const artist = artistMap.get(album.artistId);
  const genre = genreMap.get(album.genre);
  const tracks = CATALOG.tracks.filter((t) => t.albumId === album.id);
  return {
    ...album,
    artistName: artist?.name || 'Unknown Artist',
    genreName: genre?.name || album.genre,
    trackCount: tracks.length,
    totalDuration: tracks.reduce((sum, t) => sum + t.duration, 0),
    artUrl: `/api/art/album/${album.id}.svg`
  };
}

function enrichArtist(artist) {
  const albums = CATALOG.albums.filter((a) => a.artistId === artist.id);
  const tracks = CATALOG.tracks.filter((t) => t.artistId === artist.id);
  return {
    ...artist,
    primaryGenreName: genreMap.get(artist.primaryGenre)?.name || artist.primaryGenre,
    albumCount: albums.length,
    trackCount: tracks.length,
    artUrl: `/api/art/artist/${artist.id}.svg`
  };
}

function enrichGenre(genre) {
  const tracks = CATALOG.tracks.filter((t) => t.genre === genre.id);
  const artistIds = new Set(tracks.map((t) => t.artistId));
  CATALOG.artists.forEach((a) => {
    if (a.genres.includes(genre.id)) artistIds.add(a.id);
  });
  const albumIds = new Set(tracks.map((t) => t.albumId));
  return {
    ...genre,
    trackCount: tracks.length,
    artistCount: artistIds.size,
    albumCount: albumIds.size,
    artUrl: `/api/art/genre/${genre.id}.svg`
  };
}

function scoreMatch(text, query) {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(` ${q}`)) return 65;
  if (t.includes(q)) return 45;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 35;
  return 0;
}

function handleSearch(urlObj) {
  const q = (urlObj.searchParams.get('q') || '').trim();
  const genreFilter = (urlObj.searchParams.get('genre') || '').trim();
  const sort = urlObj.searchParams.get('sort') || 'relevance';

  const tracks = CATALOG.tracks
    .map((t) => {
      const e = enrichTrack(t);
      const genreOk = !genreFilter || t.genre === genreFilter || (t.subgenres || []).includes(genreFilter);
      if (!genreOk) return null;
      if (!q) return { item: e, score: 1 };
      const haystack = `${t.title} ${e.artistName} ${e.albumTitle} ${e.genreName} ${(t.moods || []).join(' ')} ${(t.subgenres || []).join(' ')} ${t.key}`;
      const titleScore = scoreMatch(t.title, q) * 1.6;
      const artistScore = scoreMatch(e.artistName, q) * 1.2;
      const albumScore = scoreMatch(e.albumTitle, q) * 1.0;
      const genreScore = scoreMatch(e.genreName, q) * 0.9;
      const hayScore = scoreMatch(haystack, q) * 0.6;
      const s = Math.max(titleScore, artistScore, albumScore, genreScore, hayScore);
      return s > 0 ? { item: e, score: s } : null;
    })
    .filter(Boolean);

  if (sort === 'plays' || (!q && sort === 'relevance')) {
    tracks.sort((a, b) => b.item.plays - a.item.plays);
  } else if (sort === 'title') {
    tracks.sort((a, b) => a.item.title.localeCompare(b.item.title));
  } else if (sort === 'newest') {
    tracks.sort((a, b) => b.item.year - a.item.year || b.item.plays - a.item.plays);
  } else {
    tracks.sort((a, b) => b.score - a.score || b.item.plays - a.item.plays);
  }

  const artists = CATALOG.artists
    .map((a) => {
      const e = enrichArtist(a);
      if (genreFilter && !a.genres.includes(genreFilter)) return null;
      if (!q) return { item: e, score: 1 };
      const s = Math.max(
        scoreMatch(a.name, q) * 1.5,
        scoreMatch((a.tags || []).join(' '), q) * 0.8,
        scoreMatch(e.primaryGenreName, q) * 0.9
      );
      return s > 0 ? { item: e, score: s } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.item.monthlyListeners - a.item.monthlyListeners);

  const albums = CATALOG.albums
    .map((alb) => {
      const e = enrichAlbum(alb);
      if (genreFilter && alb.genre !== genreFilter) return null;
      if (!q) return { item: e, score: 1 };
      const s = Math.max(
        scoreMatch(alb.title, q) * 1.5,
        scoreMatch(e.artistName, q) * 1.1,
        scoreMatch(e.genreName, q) * 0.8
      );
      return s > 0 ? { item: e, score: s } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.item.year - a.item.year);

  const genres = CATALOG.genres
    .map((g) => {
      const e = enrichGenre(g);
      if (!q) return { item: e, score: 1 };
      const s = Math.max(
        scoreMatch(g.name, q) * 1.5,
        scoreMatch((g.moods || []).join(' '), q) * 0.9,
        scoreMatch(g.tagline, q) * 0.6
      );
      return s > 0 ? { item: e, score: s } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // Build similar suggestions seeded from the best matched track or artist
  let similarTracks = [];
  let similarArtists = [];
  const topTrack = tracks[0]?.item;
  const topArtist = artists[0]?.item;

  if (topTrack) {
    const matchedIds = tracks.slice(0, 4).map((x) => x.item.id);
    similarTracks = getSimilarTracks(trackMap.get(topTrack.id), CATALOG, {
      limit: 6,
      excludeIds: matchedIds
    }).map((r) => ({
      ...r,
      track: enrichTrack(r.track),
      artist: enrichArtist(r.artist),
      album: enrichAlbum(r.album)
    }));
  }
  if (topArtist) {
    similarArtists = getSimilarArtists(artistMap.get(topArtist.id), CATALOG, { limit: 4 }).map((r) => ({
      ...r,
      artist: enrichArtist(r.artist)
    }));
  }

  return {
    query: q,
    tracks: tracks.map((x) => x.item),
    artists: artists.map((x) => x.item),
    albums: albums.map((x) => x.item),
    genres: genres.map((x) => x.item),
    similarTracks,
    similarArtists
  };
}

function handleRangeStream(req, res, buffer, contentType) {
  const total = buffer.length;
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(buffer);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` });
    res.end();
    return;
  }

  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : total - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= total) end = total - 1;

  if (start > end || start >= total) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` });
    res.end();
    return;
  }

  const chunk = buffer.subarray(start, end + 1);
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunk.length,
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600'
  });
  res.end(chunk);
}

async function handleOnlineDiscover(urlObj) {
  const q = (urlObj.searchParams.get('q') || '').trim();
  const limit = Math.min(20, Math.max(1, Number(urlObj.searchParams.get('limit') || 12)));
  if (!q) {
    return { online: true, query: q, tracks: [] };
  }

  try {
    const apiUrl = `https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(q)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      return { online: false, query: q, tracks: [], error: `Upstream HTTP ${resp.status}` };
    }
    const data = await resp.json();
    const tracks = (data.results || [])
      .filter((r) => r.previewUrl)
      .map((r) => ({
        id: `itunes-${r.trackId}`,
        isExternal: true,
        source: 'iTunes Catalog',
        title: r.trackName,
        artistId: `itunes-art-${r.artistId}`,
        artistName: r.artistName,
        albumId: `itunes-alb-${r.collectionId}`,
        albumTitle: r.collectionName || 'Single',
        genre: (r.primaryGenreName || 'pop').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        genreName: r.primaryGenreName || 'Music',
        duration: 30,
        year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : 2024,
        bpm: 110,
        key: 'Live Preview',
        moods: ['live-catalog', (r.primaryGenreName || 'music').toLowerCase()],
        plays: 0,
        artUrl: (r.artworkUrl100 || '').replace('100x100bb', '400x400bb'),
        streamUrl: `/api/proxy-audio?url=${encodeURIComponent(r.previewUrl)}`,
        directPreviewUrl: r.previewUrl
      }));

    return { online: true, query: q, tracks };
  } catch (err) {
    return {
      online: false,
      query: q,
      tracks: [],
      message: 'Live web search unavailable (offline or restricted network); showing local catalog.'
    };
  }
}

function isAllowedPreviewUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname.endsWith('.itunes.apple.com') ||
      u.hostname === 'itunes.apple.com' ||
      u.hostname.endsWith('.mzstatic.com')
    );
  } catch {
    return false;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

async function serveStatic(reqPath, res) {
  let cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  cleanPath = decodeURIComponent(cleanPath.split('?')[0]);
  const fullPath = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let target = fullPath;
  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    // SPA fallback for client routes
    target = path.join(PUBLIC_DIR, 'index.html');
  }

  try {
    const ext = path.extname(target).toLowerCase();
    const content = await fsp.readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=600'
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

export async function handleRequest(req, res) {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        genres: CATALOG.genres.length,
        artists: CATALOG.artists.length,
        albums: CATALOG.albums.length,
        tracks: CATALOG.tracks.length
      });
    }

    if (pathname === '/api/catalog' && req.method === 'GET') {
      return sendJson(res, 200, {
        genres: CATALOG.genres.map(enrichGenre),
        artists: CATALOG.artists.map(enrichArtist),
        albums: CATALOG.albums.map(enrichAlbum),
        tracks: CATALOG.tracks.map(enrichTrack)
      });
    }

    if (pathname === '/api/search' && req.method === 'GET') {
      return sendJson(res, 200, handleSearch(urlObj));
    }

    if (pathname === '/api/discover' && req.method === 'GET') {
      const result = await handleOnlineDiscover(urlObj);
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/youtube/status' && req.method === 'GET') {
      const hasEnvKey = Boolean((process.env.YOUTUBE_API_KEY || '').trim());
      return sendJson(res, 200, {
        configured: hasEnvKey,
        source: hasEnvKey ? 'env' : 'none'
      });
    }

    if (pathname === '/api/youtube/search' && req.method === 'GET') {
      const q = (urlObj.searchParams.get('q') || '').trim();
      const limit = Math.min(20, Math.max(1, Number(urlObj.searchParams.get('limit') || 12)));
      const genreHint = (urlObj.searchParams.get('genre') || 'YouTube Music').trim();
      const result = await searchYouTubeTracks(q, getRequestYouTubeKey(req), { limit, genreHint });
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/youtube/video' && req.method === 'GET') {
      const input = (urlObj.searchParams.get('input') || '').trim();
      const videoId = extractYouTubeVideoId(input);
      if (!videoId) {
        return sendJson(res, 400, { error: 'Please enter a valid YouTube URL or 11-character Video ID.' });
      }
      const track = await getYouTubeVideoById(videoId, getRequestYouTubeKey(req));
      if (!track) {
        return sendJson(res, 404, { error: 'YouTube video not found or unavailable.' });
      }
      return sendJson(res, 200, { ok: true, track });
    }

    if (pathname === '/api/youtube/similar' && req.method === 'GET') {
      const videoId = (urlObj.searchParams.get('videoId') || '').trim();
      const title = (urlObj.searchParams.get('title') || '').trim();
      const artist = (urlObj.searchParams.get('artist') || '').trim();
      const limit = Math.min(16, Math.max(1, Number(urlObj.searchParams.get('limit') || 8)));
      const result = await getSimilarYouTubeTracks({
        videoId,
        title,
        artist,
        apiKey: getRequestYouTubeKey(req),
        limit
      });
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/proxy-audio' && req.method === 'GET') {
      const targetUrl = urlObj.searchParams.get('url') || '';
      if (!isAllowedPreviewUrl(targetUrl)) {
        return sendJson(res, 400, { error: 'Invalid or disallowed preview URL' });
      }
      try {
        const upstream = await fetch(targetUrl, {
          headers: req.headers.range ? { Range: req.headers.range } : {}
        });
        const arrayBuf = await upstream.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        const contentType = upstream.headers.get('content-type') || 'audio/mp4';
        if (upstream.status === 206) {
          res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Range': upstream.headers.get('content-range') || '',
            'Content-Length': buf.length,
            'Accept-Ranges': 'bytes'
          });
          return res.end(buf);
        }
        return handleRangeStream(req, res, buf, contentType);
      } catch {
        return sendJson(res, 502, { error: 'Failed to stream external preview' });
      }
    }

    if (pathname === '/api/recommendations' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const limit = Math.min(16, Math.max(1, Number(body.limit || 8)));
      const recs = getPersonalizedRecommendations(
        {
          likedIds: Array.isArray(body.likedIds) ? body.likedIds : [],
          recentIds: Array.isArray(body.recentIds) ? body.recentIds : []
        },
        CATALOG,
        { limit }
      ).map((r) => ({
        ...r,
        track: enrichTrack(r.track),
        artist: r.artist ? enrichArtist(r.artist) : null,
        album: r.album ? enrichAlbum(r.album) : null
      }));
      return sendJson(res, 200, { recommendations: recs });
    }

    // Artist detail
    const artistMatch = /^\/api\/artists\/([a-z0-9-]+)$/.exec(pathname);
    if (artistMatch && req.method === 'GET') {
      const artist = artistMap.get(artistMatch[1]);
      if (!artist) return sendJson(res, 404, { error: 'Artist not found' });
      const albums = CATALOG.albums.filter((a) => a.artistId === artist.id).map(enrichAlbum);
      const tracks = CATALOG.tracks
        .filter((t) => t.artistId === artist.id)
        .sort((a, b) => b.plays - a.plays)
        .map(enrichTrack);
      const similarArtists = getSimilarArtists(artist, CATALOG, { limit: 5 }).map((r) => ({
        ...r,
        artist: enrichArtist(r.artist)
      }));
      const seedTrack = CATALOG.tracks.find((t) => t.artistId === artist.id);
      const similarTracks = seedTrack
        ? getSimilarTracks(seedTrack, CATALOG, {
            limit: 6,
            excludeIds: tracks.map((t) => t.id)
          }).map((r) => ({
            ...r,
            track: enrichTrack(r.track),
            artist: enrichArtist(r.artist),
            album: enrichAlbum(r.album)
          }))
        : [];
      return sendJson(res, 200, {
        artist: enrichArtist(artist),
        albums,
        tracks,
        similarArtists,
        similarTracks
      });
    }

    // Album detail
    const albumMatch = /^\/api\/albums\/([a-z0-9-]+)$/.exec(pathname);
    if (albumMatch && req.method === 'GET') {
      const album = albumMap.get(albumMatch[1]);
      if (!album) return sendJson(res, 404, { error: 'Album not found' });
      const artist = enrichArtist(artistMap.get(album.artistId));
      const tracks = CATALOG.tracks
        .filter((t) => t.albumId === album.id)
        .sort((a, b) => a.trackNumber - b.trackNumber)
        .map(enrichTrack);
      const similarAlbums = getSimilarAlbums(album, CATALOG, { limit: 5 }).map((r) => ({
        ...r,
        album: enrichAlbum(r.album),
        artist: enrichArtist(r.artist)
      }));
      return sendJson(res, 200, {
        album: enrichAlbum(album),
        artist,
        tracks,
        similarAlbums
      });
    }

    // Genre detail
    const genreMatch = /^\/api\/genres\/([a-z0-9-]+)$/.exec(pathname);
    if (genreMatch && req.method === 'GET') {
      const genre = genreMap.get(genreMatch[1]);
      if (!genre) return sendJson(res, 404, { error: 'Genre not found' });
      const tracks = CATALOG.tracks
        .filter((t) => t.genre === genre.id || (t.subgenres || []).includes(genre.id))
        .sort((a, b) => b.plays - a.plays)
        .map(enrichTrack);
      const artistIdSet = new Set(tracks.map((t) => t.artistId));
      CATALOG.artists.forEach((a) => {
        if (a.genres.includes(genre.id)) artistIdSet.add(a.id);
      });
      const artists = [...artistIdSet].map((id) => enrichArtist(artistMap.get(id))).filter(Boolean);
      const albumIdSet = new Set(tracks.map((t) => t.albumId));
      const albums = [...albumIdSet].map((id) => enrichAlbum(albumMap.get(id))).filter(Boolean);
      const relatedGenres = (genre.relatedGenres || [])
        .map((gid) => genreMap.get(gid))
        .filter(Boolean)
        .map(enrichGenre);
      return sendJson(res, 200, {
        genre: enrichGenre(genre),
        tracks,
        artists,
        albums,
        relatedGenres
      });
    }

    // Track similarity
    const simMatch = /^\/api\/tracks\/([a-z0-9-]+)\/similar$/.exec(pathname);
    if (simMatch && req.method === 'GET') {
      const track = trackMap.get(simMatch[1]);
      if (!track) return sendJson(res, 404, { error: 'Track not found' });
      const limit = Math.min(16, Math.max(1, Number(urlObj.searchParams.get('limit') || 8)));
      const similar = getSimilarTracks(track, CATALOG, { limit }).map((r) => ({
        ...r,
        track: enrichTrack(r.track),
        artist: enrichArtist(r.artist),
        album: enrichAlbum(r.album)
      }));
      return sendJson(res, 200, { sourceTrack: enrichTrack(track), similar });
    }

    // Increment play count
    const playMatch = /^\/api\/tracks\/([a-z0-9-]+)\/play$/.exec(pathname);
    if (playMatch && req.method === 'POST') {
      const track = trackMap.get(playMatch[1]);
      if (!track) return sendJson(res, 404, { error: 'Track not found' });
      track.plays += 1;
      return sendJson(res, 200, { id: track.id, plays: track.plays });
    }

    // Audio streaming with Range support
    const streamMatch = /^\/api\/stream\/([a-z0-9-]+)$/.exec(pathname);
    if (streamMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const track = trackMap.get(streamMatch[1]);
      if (!track) return sendJson(res, 404, { error: 'Track not found' });
      const wavBuf = await getTrackWavBuffer(track);
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': wavBuf.length,
          'Accept-Ranges': 'bytes'
        });
        return res.end();
      }
      return handleRangeStream(req, res, wavBuf, 'audio/wav');
    }

    // Procedural SVG artwork
    const artMatch = /^\/api\/art\/(album|artist|genre)\/([a-z0-9-]+)\.svg$/.exec(pathname);
    if (artMatch && req.method === 'GET') {
      const [, kind, id] = artMatch;
      let svg = null;
      if (kind === 'album') {
        const album = albumMap.get(id);
        if (album) svg = generateAlbumSvg(album, artistMap.get(album.artistId));
      } else if (kind === 'artist') {
        const artist = artistMap.get(id);
        if (artist) svg = generateArtistSvg(artist);
      } else if (kind === 'genre') {
        const genre = genreMap.get(id);
        if (genre) svg = generateGenreSvg(genre);
      }
      if (!svg) {
        res.writeHead(404);
        return res.end('Artwork not found');
      }
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(svg);
    }

    // Static assets
    return await serveStatic(pathname, res);
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

export function createAppServer() {
  return http.createServer(handleRequest);
}
