import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { handleRequest } from '../src/app-server.js';
import vercelHandler from '../api/index.js';
import {
  parseIsoDuration,
  decodeHtmlEntities,
  extractYouTubeVideoId
} from '../src/youtube.js';
import {
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
  renderYouTubeView
} from '../public/js/views.js';

function invokeRequest({ method = 'GET', url = '/', headers = {}, body = null, preParsedBody = undefined, fn = handleRequest }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1:3000', ...headers };
    if (preParsedBody !== undefined) req.body = preParsedBody;
    req.destroy = () => {};

    let statusCode = 200;
    const resHeaders = {};
    const chunks = [];

    const res = {
      writeHead(code, hdrs = {}) {
        statusCode = code;
        for (const [k, v] of Object.entries(hdrs)) {
          resHeaders[k.toLowerCase()] = v;
        }
      },
      setHeader(k, v) {
        resHeaders[k.toLowerCase()] = v;
      },
      end(chunk) {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        const buf = Buffer.concat(chunks);
        resolve({
          status: statusCode,
          headers: resHeaders,
          buffer: buf,
          text: () => buf.toString('utf8'),
          json: () => JSON.parse(buf.toString('utf8'))
        });
      }
    };

    fn(req, res).catch(reject);

    process.nextTick(() => {
      if (body !== null) {
        req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      }
      req.emit('end');
    });
  });
}

async function runTests() {
  // 1. Health & Catalog
  const healthRes = await invokeRequest({ url: '/api/health' });
  assert.equal(healthRes.status, 200);
  const health = healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.genres, 8);
  assert.equal(health.artists, 12);
  assert.equal(health.albums, 17);
  assert.equal(health.tracks, 36);

  const catalog = (await invokeRequest({ url: '/api/catalog' })).json();
  assert.equal(catalog.tracks.length, 36);
  assert.ok(catalog.tracks[0].streamUrl.startsWith('/api/stream/'));

  // 2. Search + similar suggestions
  const search = (await invokeRequest({ url: '/api/search?q=neon' })).json();
  assert.ok(search.tracks.length > 0);
  assert.ok(search.artists.some((a) => a.id === 'neon-horizon'));
  assert.ok(search.similarTracks.length > 0, 'Search should include similar track suggestions');
  assert.ok(search.similarArtists.length > 0, 'Search should include similar artist suggestions');

  // 3. Artist, Album, Genre detail endpoints
  const artistDetail = (await invokeRequest({ url: '/api/artists/neon-horizon' })).json();
  assert.equal(artistDetail.artist.name, 'Neon Horizon');
  assert.ok(artistDetail.albums.length >= 2);
  assert.ok(artistDetail.similarArtists.length >= 3);

  const albumDetail = (await invokeRequest({ url: '/api/albums/midnight-expressway' })).json();
  assert.equal(albumDetail.album.title, 'Midnight Expressway');
  assert.ok(albumDetail.tracks.length >= 2);
  assert.ok(albumDetail.similarAlbums.length >= 3);

  const genreDetail = (await invokeRequest({ url: '/api/genres/synthwave' })).json();
  assert.equal(genreDetail.genre.name, 'Synthwave');
  assert.ok(genreDetail.tracks.length >= 4);
  assert.ok(genreDetail.relatedGenres.length >= 2);

  // 4. Track similarity & personalized recommendations
  const sim = (await invokeRequest({ url: '/api/tracks/trk-01/similar?limit=5' })).json();
  assert.equal(sim.similar.length, 5);
  assert.ok(sim.similar[0].matchPercent >= 50);
  assert.ok(sim.similar[0].reasons.length >= 1);

  const recsRes = await invokeRequest({
    method: 'POST',
    url: '/api/recommendations',
    headers: { 'content-type': 'application/json' },
    body: { likedIds: ['trk-05'], recentIds: ['trk-01'], limit: 6 }
  });
  assert.equal(recsRes.status, 200);
  const recs = recsRes.json();
  assert.equal(recs.recommendations.length, 6);

  // 5. WAV Audio Streaming + HTTP 206 Partial Content Range seek across genres
  for (const tid of ['trk-01', 'trk-05', 'trk-09', 'trk-12', 'trk-15', 'trk-18', 'trk-21', 'trk-24']) {
    const fullRes = await invokeRequest({ url: `/api/stream/${tid}` });
    assert.equal(fullRes.status, 200);
    assert.equal(fullRes.headers['content-type'], 'audio/wav');
    assert.equal(fullRes.headers['accept-ranges'], 'bytes');
    assert.equal(fullRes.buffer.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(fullRes.buffer.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.ok(fullRes.buffer.length > 100000);
  }

  const rangeRes = await invokeRequest({
    url: '/api/stream/trk-01',
    headers: { range: 'bytes=0-1023' }
  });
  assert.equal(rangeRes.status, 206);
  assert.match(String(rangeRes.headers['content-range'] || ''), /^bytes 0-1023\//);
  assert.equal(rangeRes.buffer.length, 1024);

  // 6. Procedural SVG art (album, artist, genre)
  const albumArt = await invokeRequest({ url: '/api/art/album/midnight-expressway.svg' });
  assert.equal(albumArt.status, 200);
  assert.match(String(albumArt.headers['content-type']), /image\/svg\+xml/);
  assert.ok(albumArt.text().includes('<svg') && albumArt.text().includes('Midnight Expressway'));

  const artistArt = await invokeRequest({ url: '/api/art/artist/kuro-and-tea.svg' });
  assert.equal(artistArt.status, 200);
  assert.ok(artistArt.text().includes('Kuro &amp; Tea'));

  const genreArt = await invokeRequest({ url: '/api/art/genre/lofi.svg' });
  assert.equal(genreArt.status, 200);
  assert.ok(genreArt.text().includes('<svg'));

  // 7. Static HTML / CSS / JS
  const htmlRes = await invokeRequest({ url: '/' });
  assert.equal(htmlRes.status, 200);
  assert.ok(htmlRes.text().includes('<title>Sonora'));
  assert.equal((await invokeRequest({ url: '/styles.css' })).status, 200);
  assert.equal((await invokeRequest({ url: '/js/app.js' })).status, 200);
  assert.equal((await invokeRequest({ url: '/js/player.js' })).status, 200);
  assert.equal((await invokeRequest({ url: '/js/views.js' })).status, 200);

  // 8. Graceful offline fallback on /api/discover & SSRF protection on /api/proxy-audio
  const discover = (await invokeRequest({ url: '/api/discover?q=daft%20punk' })).json();
  assert.equal(typeof discover.online, 'boolean');
  assert.ok(Array.isArray(discover.tracks));

  const badProxy = await invokeRequest({ url: '/api/proxy-audio?url=http://127.0.0.1:8080/secret' });
  assert.equal(badProxy.status, 400);

  // 9. Frontend view renderers verification
  const mockState = {
    currentTrack: catalog.tracks[0],
    isPlaying: true,
    likedIds: ['trk-01', 'trk-05'],
    recentIds: ['trk-01', 'trk-09']
  };
  const renderedViews = [
    renderHomeView(catalog, recs.recommendations, mockState),
    renderSearchView({
      query: 'neon',
      localResults: search,
      webResults: discover,
      webEnabled: true,
      genreFilter: '',
      sort: 'relevance',
      genres: catalog.genres,
      state: mockState
    }),
    renderArtistsView(catalog, { genreFilter: '', sort: 'listeners' }),
    renderArtistDetailView(artistDetail, mockState, catalog),
    renderGenresView(catalog),
    renderGenreDetailView(genreDetail, mockState),
    renderAlbumsView(catalog, { genreFilter: '', sort: 'newest' }),
    renderAlbumDetailView(albumDetail, mockState),
    renderAllTracksView(catalog, { genreFilter: '', sort: 'plays' }, mockState),
    renderLibraryView(catalog, recs.recommendations, mockState)
  ];

  // 10. YouTube API utilities, endpoints & view rendering
  assert.equal(parseIsoDuration('PT3M45S'), 225);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(decodeHtmlEntities('Guns N&#39; Roses &amp; More'), "Guns N' Roses & More");
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtu.be/5qap5aO4i9A?t=10'), '5qap5aO4i9A');
  assert.equal(extractYouTubeVideoId('5qap5aO4i9A'), '5qap5aO4i9A');
  assert.equal(extractYouTubeVideoId('not-a-valid-url'), null);

  const ytStatus = (await invokeRequest({ url: '/api/youtube/status' })).json();
  assert.equal(typeof ytStatus.configured, 'boolean');

  const ytNoKey = (await invokeRequest({ url: '/api/youtube/search?q=synthwave' })).json();
  assert.equal(ytNoKey.ok, false);
  assert.equal(ytNoKey.needsKey, true);

  const ytDirectValid = await invokeRequest({ url: '/api/youtube/video?input=https://youtu.be/5qap5aO4i9A' });
  assert.equal(ytDirectValid.status, 200);
  assert.equal(ytDirectValid.json().track.videoId, '5qap5aO4i9A');
  assert.equal(ytDirectValid.json().track.isYouTube, true);

  const ytDirectBad = await invokeRequest({ url: '/api/youtube/video?input=invalid' });
  assert.equal(ytDirectBad.status, 400);

  // Mock YouTube Data API v3 fetch responses to verify normalization & similarity
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/youtube/v3/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: { videoId: 'abc12345678' } }, { id: { videoId: 'xyz98765432' } }]
        })
      };
    }
    if (s.includes('/youtube/v3/videos')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'abc12345678',
              snippet: {
                title: 'Midnight &amp; Synthwave (Official Audio)',
                channelId: 'ch1',
                channelTitle: 'The Midnight - Topic',
                publishedAt: '2024-05-01T00:00:00Z',
                tags: ['synthwave', 'retrowave'],
                thumbnails: { high: { url: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg' } }
              },
              contentDetails: { duration: 'PT4M12S' },
              statistics: { viewCount: '1250000' },
              status: { embeddable: true }
            },
            {
              id: 'xyz98765432',
              snippet: {
                title: 'Sunset Highway &#39;84',
                channelId: 'ch2',
                channelTitle: 'Timecop1983VEVO',
                publishedAt: '2023-03-10T00:00:00Z',
                tags: ['synthwave'],
                thumbnails: { high: { url: 'https://i.ytimg.com/vi/xyz98765432/hqdefault.jpg' } }
              },
              contentDetails: { duration: 'PT3M50S' },
              statistics: { viewCount: '840000' },
              status: { embeddable: true }
            }
          ]
        })
      };
    }
    return realFetch(url);
  };

  let ytSearchRes;
  let ytSimRes;
  try {
    ytSearchRes = (
      await invokeRequest({
        url: '/api/youtube/search?q=synthwave',
        headers: { 'x-youtube-api-key': 'test-key-123' }
      })
    ).json();
    assert.equal(ytSearchRes.ok, true);
    assert.equal(ytSearchRes.tracks.length, 2);
    assert.equal(ytSearchRes.tracks[0].title, 'Midnight & Synthwave (Official Audio)');
    assert.equal(ytSearchRes.tracks[0].artistName, 'The Midnight');
    assert.equal(ytSearchRes.tracks[0].duration, 252);
    assert.equal(ytSearchRes.tracks[1].title, "Sunset Highway '84");

    ytSimRes = (
      await invokeRequest({
        url: '/api/youtube/similar?videoId=abc12345678&title=Midnight&artist=The%20Midnight',
        headers: { 'x-youtube-api-key': 'test-key-123' }
      })
    ).json();
    assert.equal(ytSimRes.ok, true);
    assert.ok(ytSimRes.similar.every((r) => r.track.videoId !== 'abc12345678'));
    assert.equal(ytSimRes.similar.length, 1);
    assert.equal(ytSimRes.similar[0].track.videoId, 'xyz98765432');
  } finally {
    globalThis.fetch = realFetch;
  }

  renderedViews.push(
    renderSearchView({
      query: 'synthwave',
      localResults: search,
      webResults: discover,
      youtubeResults: ytSearchRes,
      webEnabled: true,
      genreFilter: '',
      sort: 'relevance',
      genres: catalog.genres,
      state: mockState
    }),
    renderYouTubeView({
      query: 'synthwave',
      results: ytSearchRes,
      loading: false,
      keyConfigured: true,
      genres: catalog.genres,
      state: mockState
    }),
    renderYouTubeView({
      query: '',
      results: ytNoKey,
      loading: false,
      keyConfigured: false,
      genres: catalog.genres,
      state: mockState
    })
  );

  for (const html of renderedViews) {
    assert.ok(html.length > 200);
    assert.ok(!html.includes('NaN'), 'Rendered view must not contain NaN');
    assert.ok(!html.includes('>undefined<'), 'Rendered view must not contain undefined');
  }

  // 11. Vercel serverless handler rewrite & pre-parsed JSON body verification
  const vercelHealth = await invokeRequest({
    url: '/api/index.js?__apiPath=/api/health',
    fn: vercelHandler
  });
  assert.equal(vercelHealth.status, 200);
  assert.equal(vercelHealth.json().ok, true);

  const vercelSearch = await invokeRequest({
    url: '/api/index.js?__apiPath=/api/search&q=neon',
    fn: vercelHandler
  });
  assert.equal(vercelSearch.status, 200);
  assert.ok(vercelSearch.json().tracks.length > 0);

  const vercelRecs = await invokeRequest({
    method: 'POST',
    url: '/api/index.js?__apiPath=/api/recommendations',
    preParsedBody: { likedIds: ['trk-01'], recentIds: ['trk-05'], limit: 4 },
    fn: vercelHandler
  });
  assert.equal(vercelRecs.status, 200);
  assert.equal(vercelRecs.json().recommendations.length, 4);

  console.log('All Sonora smoke tests passed!', {
    tracks: catalog.tracks.length,
    albums: catalog.albums.length,
    artists: catalog.artists.length,
    genres: catalog.genres.length,
    similarCount: sim.similar.length,
    ytTracksTested: ytSearchRes.tracks.length,
    viewsChecked: renderedViews.length
  });
}

runTests().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
