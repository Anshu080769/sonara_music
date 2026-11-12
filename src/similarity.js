// Multi-factor music similarity & recommendation engine

function jaccard(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function getSharedItems(a = [], b = []) {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

function getTrackProfile(tracks) {
  if (!tracks.length) {
    return { energy: 0.5, valence: 0.5, acousticness: 0.5, bpm: 100, moods: [], subgenres: [], genres: [] };
  }
  let energy = 0;
  let valence = 0;
  let acousticness = 0;
  let bpm = 0;
  const moods = new Set();
  const subgenres = new Set();
  const genres = new Set();

  for (const t of tracks) {
    energy += t.energy;
    valence += t.valence;
    acousticness += t.acousticness;
    bpm += t.bpm;
    genres.add(t.genre);
    (t.moods || []).forEach((m) => moods.add(m));
    (t.subgenres || []).forEach((s) => subgenres.add(s));
  }
  const n = tracks.length;
  return {
    energy: energy / n,
    valence: valence / n,
    acousticness: acousticness / n,
    bpm: bpm / n,
    moods: [...moods],
    subgenres: [...subgenres],
    genres: [...genres]
  };
}

function featureProximity(a, b) {
  const dEnergy = (a.energy - b.energy) * 1.1;
  const dValence = (a.valence - b.valence) * 0.9;
  const dAcoustic = (a.acousticness - b.acousticness) * 1.1;
  const dBpm = ((a.bpm - b.bpm) / 70) * 1.0;
  const dist = Math.sqrt(dEnergy * dEnergy + dValence * dValence + dAcoustic * dAcoustic + dBpm * dBpm);
  return Math.max(0, 1 - dist / 2.2);
}

export function getSimilarTracks(targetTrack, catalog, { limit = 8, excludeIds = [] } = {}) {
  const genreMap = new Map(catalog.genres.map((g) => [g.id, g]));
  const artistMap = new Map(catalog.artists.map((a) => [a.id, a]));
  const albumMap = new Map(catalog.albums.map((a) => [a.id, a]));
  const excluded = new Set([targetTrack.id, ...excludeIds]);
  const targetGenreObj = genreMap.get(targetTrack.genre);
  const relatedSet = new Set(targetGenreObj?.relatedGenres || []);

  const targetTags = [targetTrack.genre, ...(targetTrack.subgenres || [])];

  const scored = [];
  for (const candidate of catalog.tracks) {
    if (excluded.has(candidate.id)) continue;

    const reasons = [];
    let score = 0;

    // 1. Genre & subgenre affinity (0 - 0.34)
    const candidateTags = [candidate.genre, ...(candidate.subgenres || [])];
    if (candidate.genre === targetTrack.genre) {
      score += 0.25;
      reasons.push(`Same genre: ${genreMap.get(candidate.genre)?.name || candidate.genre}`);
    } else if (relatedSet.has(candidate.genre)) {
      score += 0.14;
      reasons.push(`Related genre: ${genreMap.get(candidate.genre)?.name || candidate.genre}`);
    }
    const subOverlap = jaccard(targetTags, candidateTags);
    score += subOverlap * 0.12;

    // 2. Mood alignment (0 - 0.28)
    const sharedMoods = getSharedItems(targetTrack.moods || [], candidate.moods || []);
    const moodSim = jaccard(targetTrack.moods || [], candidate.moods || []);
    score += moodSim * 0.28;
    if (sharedMoods.length > 0) {
      reasons.push(`Shared mood: ${sharedMoods.slice(0, 2).join(', ')}`);
    }

    // 3. Sonic feature vector proximity (0 - 0.32)
    const prox = featureProximity(targetTrack, candidate);
    score += prox * 0.32;
    const bpmDiff = Math.abs(targetTrack.bpm - candidate.bpm);
    if (bpmDiff <= 10) {
      reasons.push(`Matching tempo (${candidate.bpm} BPM)`);
    } else if (Math.abs(targetTrack.energy - candidate.energy) <= 0.12) {
      reasons.push('Similar energy level');
    }

    // 4. Era proximity (0 - 0.05)
    const yearDiff = Math.abs((targetTrack.year || 2024) - (candidate.year || 2024));
    score += Math.max(0, 1 - yearDiff / 6) * 0.05;

    // 5. Discovery diversity bonus for different artist/album so suggestions aren't just the same album
    if (candidate.artistId !== targetTrack.artistId) {
      score += 0.04;
    } else if (candidate.albumId !== targetTrack.albumId) {
      score += 0.02;
    } else {
      score -= 0.04;
    }

    if (reasons.length === 0) {
      reasons.push('Complementary sonic profile');
    }

    const matchPercent = Math.min(99, Math.max(54, Math.round(52 + score * 47)));
    scored.push({
      track: candidate,
      artist: artistMap.get(candidate.artistId),
      album: albumMap.get(candidate.albumId),
      genre: genreMap.get(candidate.genre),
      score,
      matchPercent,
      reasons: reasons.slice(0, 3)
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function getSimilarArtists(targetArtist, catalog, { limit = 6 } = {}) {
  const genreMap = new Map(catalog.genres.map((g) => [g.id, g]));
  const tracksByArtist = new Map();
  for (const t of catalog.tracks) {
    if (!tracksByArtist.has(t.artistId)) tracksByArtist.set(t.artistId, []);
    tracksByArtist.get(t.artistId).push(t);
  }

  const targetProfile = getTrackProfile(tracksByArtist.get(targetArtist.id) || []);
  const targetPrimaryGenre = genreMap.get(targetArtist.primaryGenre);
  const relatedGenres = new Set(targetPrimaryGenre?.relatedGenres || []);

  const scored = [];
  for (const candidate of catalog.artists) {
    if (candidate.id === targetArtist.id) continue;

    const reasons = [];
    let score = 0;

    const sharedGenres = getSharedItems(targetArtist.genres || [], candidate.genres || []);
    const genreSim = jaccard(targetArtist.genres || [], candidate.genres || []);
    score += genreSim * 0.35;

    if (candidate.primaryGenre === targetArtist.primaryGenre) {
      score += 0.12;
      reasons.push(`Same core sound: ${genreMap.get(candidate.primaryGenre)?.name || candidate.primaryGenre}`);
    } else if (sharedGenres.length > 0) {
      const gName = genreMap.get(sharedGenres[0])?.name || sharedGenres[0];
      reasons.push(`Cross-genre overlap: ${gName}`);
    } else if (relatedGenres.has(candidate.primaryGenre)) {
      score += 0.14;
      reasons.push(`Adjacent style: ${genreMap.get(candidate.primaryGenre)?.name || candidate.primaryGenre}`);
    }

    const candProfile = getTrackProfile(tracksByArtist.get(candidate.id) || []);
    const sharedMoods = getSharedItems(targetProfile.moods, candProfile.moods);
    const moodSim = jaccard(targetProfile.moods, candProfile.moods);
    score += moodSim * 0.22;
    if (sharedMoods.length > 0) {
      reasons.push(`Vibe: ${sharedMoods.slice(0, 2).join(', ')}`);
    }

    const tagSim = jaccard(targetArtist.tags || [], candidate.tags || []);
    score += tagSim * 0.12;

    const sonicSim = featureProximity(targetProfile, candProfile);
    score += sonicSim * 0.28;
    if (Math.abs(targetProfile.bpm - candProfile.bpm) <= 14 && reasons.length < 2) {
      reasons.push('Similar tempo & texture');
    }

    if (reasons.length === 0) {
      reasons.push('Complementary listening palette');
    }

    const matchPercent = Math.min(98, Math.max(55, Math.round(52 + score * 46)));
    scored.push({
      artist: candidate,
      score,
      matchPercent,
      reasons: reasons.slice(0, 2)
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function getSimilarAlbums(targetAlbum, catalog, { limit = 6 } = {}) {
  const genreMap = new Map(catalog.genres.map((g) => [g.id, g]));
  const artistMap = new Map(catalog.artists.map((a) => [a.id, a]));
  const tracksByAlbum = new Map();
  for (const t of catalog.tracks) {
    if (!tracksByAlbum.has(t.albumId)) tracksByAlbum.set(t.albumId, []);
    tracksByAlbum.get(t.albumId).push(t);
  }

  const targetProfile = getTrackProfile(tracksByAlbum.get(targetAlbum.id) || []);
  const relatedSet = new Set(genreMap.get(targetAlbum.genre)?.relatedGenres || []);

  const scored = [];
  for (const candidate of catalog.albums) {
    if (candidate.id === targetAlbum.id) continue;

    const reasons = [];
    let score = 0;

    if (candidate.genre === targetAlbum.genre) {
      score += 0.28;
      reasons.push(`Same genre: ${genreMap.get(candidate.genre)?.name || candidate.genre}`);
    } else if (relatedSet.has(candidate.genre)) {
      score += 0.15;
      reasons.push(`Related genre: ${genreMap.get(candidate.genre)?.name || candidate.genre}`);
    }

    const candProfile = getTrackProfile(tracksByAlbum.get(candidate.id) || []);
    const moodSim = jaccard(targetProfile.moods, candProfile.moods);
    const sharedMoods = getSharedItems(targetProfile.moods, candProfile.moods);
    score += moodSim * 0.25;
    if (sharedMoods.length > 0) {
      reasons.push(`Mood: ${sharedMoods.slice(0, 2).join(', ')}`);
    }

    const sonicSim = featureProximity(targetProfile, candProfile);
    score += sonicSim * 0.34;

    if (candidate.artistId !== targetAlbum.artistId) {
      score += 0.05;
    } else {
      reasons.push('Same artist discography');
    }

    if (reasons.length === 0) {
      reasons.push('Similar sonic atmosphere');
    }

    const matchPercent = Math.min(98, Math.max(54, Math.round(52 + score * 46)));
    scored.push({
      album: candidate,
      artist: artistMap.get(candidate.artistId),
      score,
      matchPercent,
      reasons: reasons.slice(0, 2)
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function getPersonalizedRecommendations({ likedIds = [], recentIds = [] }, catalog, { limit = 8 } = {}) {
  const trackMap = new Map(catalog.tracks.map((t) => [t.id, t]));
  const artistMap = new Map(catalog.artists.map((a) => [a.id, a]));
  const albumMap = new Map(catalog.albums.map((a) => [a.id, a]));
  const genreMap = new Map(catalog.genres.map((g) => [g.id, g]));

  const seedTracks = [];
  for (const id of likedIds) {
    const t = trackMap.get(id);
    if (t) seedTracks.push({ track: t, weight: 1.5 });
  }
  for (const id of recentIds) {
    const t = trackMap.get(id);
    if (t && !likedIds.includes(id)) seedTracks.push({ track: t, weight: 1.0 });
  }

  // Fallback for cold start: curated mix across top popular tracks
  if (seedTracks.length === 0) {
    const popular = [...catalog.tracks]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, limit)
      .map((track) => ({
        track,
        artist: artistMap.get(track.artistId),
        album: albumMap.get(track.albumId),
        genre: genreMap.get(track.genre),
        matchPercent: 92,
        reasons: ['Trending across Sonora', `${genreMap.get(track.genre)?.name || track.genre}`]
      }));
    return popular;
  }

  const seenSet = new Set([...likedIds, ...recentIds.slice(0, 3)]);
  const agg = new Map();

  for (const { track: seed, weight } of seedTracks.slice(0, 8)) {
    const recs = getSimilarTracks(seed, catalog, { limit: 12 });
    const seedArtist = artistMap.get(seed.artistId)?.name || 'your history';
    for (const r of recs) {
      if (seenSet.has(r.track.id)) continue;
      const cur = agg.get(r.track.id);
      const weightedScore = r.score * weight;
      if (!cur || weightedScore > cur.bestSeedScore) {
        agg.set(r.track.id, {
          ...r,
          totalScore: (cur?.totalScore || 0) + weightedScore,
          bestSeedScore: weightedScore,
          reasons: [`Inspired by "${seed.title}" · ${seedArtist}`, ...r.reasons.slice(0, 1)]
        });
      } else {
        cur.totalScore += weightedScore * 0.45;
      }
    }
  }

  const results = [...agg.values()].sort((a, b) => b.totalScore - a.totalScore).slice(0, limit);
  if (results.length < limit) {
    const used = new Set([...results.map((r) => r.track.id), ...seenSet]);
    for (const t of [...catalog.tracks].sort((a, b) => b.plays - a.plays)) {
      if (results.length >= limit) break;
      if (used.has(t.id)) continue;
      results.push({
        track: t,
        artist: artistMap.get(t.artistId),
        album: albumMap.get(t.albumId),
        genre: genreMap.get(t.genre),
        matchPercent: 84,
        reasons: ['Popular discovery pick']
      });
    }
  }
  return results;
}
