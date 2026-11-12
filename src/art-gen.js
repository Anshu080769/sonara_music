// Deterministic procedural SVG artwork generator for albums, artists, and genres

function escapeXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hashStr(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function initials(name = '') {
  const parts = name.trim().split(/[\s&]+/).filter(Boolean);
  if (!parts.length) return 'SN';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function generateAlbumSvg(album, artist) {
  const [c1, c2, c3] = album.palette || ['#7c5cff', '#ff3d8b', '#0f172a'];
  const uid = `alb_${hashStr(album.id)}`;
  const seed = hashStr(album.id + album.title);
  const style = album.artStyle || 'rings';
  const title = escapeXml(album.title);
  const artistName = escapeXml(artist?.name || '');

  let artworkLayer = '';
  if (style === 'grid') {
    const lines = [];
    for (let i = 0; i <= 8; i++) {
      const y = 210 + i * 24;
      lines.push(`<line x1="0" y1="${y}" x2="400" y2="${y}" stroke="${c1}" stroke-opacity="${(0.15 + i * 0.06).toFixed(2)}" stroke-width="1.5"/>`);
    }
    for (let i = -4; i <= 12; i++) {
      const x1 = i * 45;
      const x2 = 200 + (x1 - 200) * 2.7;
      lines.push(`<line x1="${x1}" y1="210" x2="${x2}" y2="400" stroke="${c2}" stroke-opacity="0.38" stroke-width="1.4"/>`);
    }
    artworkLayer = `
      <circle cx="200" cy="175" r="88" fill="url(#${uid}_glow)" opacity="0.95"/>
      <rect x="90" y="160" width="220" height="8" fill="${c3}" opacity="0.65"/>
      <rect x="95" y="178" width="210" height="7" fill="${c3}" opacity="0.72"/>
      <rect x="105" y="195" width="190" height="7" fill="${c3}" opacity="0.8"/>
      <rect x="0" y="210" width="400" height="190" fill="${c3}" opacity="0.88"/>
      ${lines.join('\n')}
    `;
  } else if (style === 'sun') {
    artworkLayer = `
      <circle cx="235" cy="155" r="105" fill="url(#${uid}_glow)" opacity="0.9"/>
      <circle cx="155" cy="240" r="120" fill="${c2}" opacity="0.22"/>
      <path d="M0,260 Q110,210 210,255 T400,240 L400,400 L0,400 Z" fill="${c3}" opacity="0.75"/>
      <path d="M0,300 Q140,265 260,305 T400,285 L400,400 L0,400 Z" fill="${c1}" opacity="0.24"/>
      <circle cx="235" cy="155" r="130" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.5"/>
    `;
  } else if (style === 'rings') {
    const circles = [];
    for (let i = 1; i <= 7; i++) {
      const r = i * 26;
      circles.push(`<circle cx="200" cy="195" r="${r}" fill="none" stroke="${i % 2 === 0 ? c1 : c2}" stroke-opacity="${(0.55 - i * 0.05).toFixed(2)}" stroke-width="${i === 4 ? 3 : 1.6}" stroke-dasharray="${i % 3 === 0 ? '8 6' : 'none'}"/>`);
    }
    artworkLayer = `
      <circle cx="200" cy="195" r="150" fill="url(#${uid}_glow)" opacity="0.35"/>
      ${circles.join('\n')}
      <circle cx="200" cy="195" r="24" fill="${c1}" opacity="0.9"/>
      <circle cx="200" cy="195" r="9" fill="${c3}"/>
    `;
  } else if (style === 'waves') {
    const paths = [];
    for (let i = 0; i < 6; i++) {
      const y = 130 + i * 38;
      const amp = 26 + ((seed + i * 17) % 24);
      paths.push(`<path d="M-20,${y} C100,${y - amp} 260,${y + amp} 420,${y - 10}" fill="none" stroke="${i % 2 === 0 ? c1 : c2}" stroke-opacity="${(0.75 - i * 0.08).toFixed(2)}" stroke-width="${3 - i * 0.25}"/>`);
    }
    artworkLayer = `
      <circle cx="110" cy="120" r="120" fill="${c1}" opacity="0.22"/>
      <circle cx="300" cy="280" r="140" fill="${c2}" opacity="0.2"/>
      ${paths.join('\n')}
    `;
  } else if (style === 'prism') {
    artworkLayer = `
      <polygon points="200,55 335,285 65,285" fill="url(#${uid}_glow)" fill-opacity="0.25" stroke="#ffffff" stroke-opacity="0.45" stroke-width="2"/>
      <polygon points="200,95 295,260 105,260" fill="none" stroke="${c1}" stroke-opacity="0.7" stroke-width="2"/>
      <line x1="20" y1="220" x2="175" y2="175" stroke="#ffffff" stroke-opacity="0.65" stroke-width="3"/>
      <line x1="230" y1="172" x2="390" y2="142" stroke="${c1}" stroke-width="5" stroke-opacity="0.85"/>
      <line x1="238" y1="184" x2="390" y2="178" stroke="${c2}" stroke-width="5" stroke-opacity="0.8"/>
      <line x1="246" y1="196" x2="390" y2="215" stroke="#38bdf8" stroke-width="5" stroke-opacity="0.75"/>
    `;
  } else if (style === 'vinyl') {
    const grooves = [];
    for (let r = 64; r <= 156; r += 10) {
      grooves.push(`<circle cx="200" cy="195" r="${r}" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="1"/>`);
    }
    artworkLayer = `
      <circle cx="200" cy="195" r="162" fill="#0b0b10" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
      ${grooves.join('\n')}
      <circle cx="200" cy="195" r="56" fill="url(#${uid}_glow)"/>
      <circle cx="200" cy="195" r="10" fill="#09090d"/>
      <path d="M90,85 A155,155 0 0,1 305,80" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="5" stroke-linecap="round"/>
    `;
  } else if (style === 'orbit') {
    artworkLayer = `
      <circle cx="200" cy="190" r="130" fill="url(#${uid}_glow)" opacity="0.28"/>
      <ellipse cx="200" cy="190" rx="150" ry="52" transform="rotate(-24 200 190)" fill="none" stroke="${c1}" stroke-opacity="0.7" stroke-width="2"/>
      <ellipse cx="200" cy="190" rx="150" ry="52" transform="rotate(28 200 190)" fill="none" stroke="${c2}" stroke-opacity="0.65" stroke-width="2"/>
      <circle cx="200" cy="190" r="46" fill="url(#${uid}_glow)"/>
      <circle cx="315" cy="138" r="8" fill="#ffffff" opacity="0.9"/>
      <circle cx="95" cy="245" r="6" fill="${c1}" opacity="0.9"/>
    `;
  } else {
    // blocks / geometric bauhaus
    const rects = [];
    for (let i = 0; i < 6; i++) {
      const w = 55 + ((seed + i * 31) % 90);
      const h = 55 + ((seed + i * 47) % 90);
      const x = 40 + ((seed + i * 73) % 210);
      const y = 40 + ((seed + i * 59) % 200);
      const col = i % 2 === 0 ? c1 : c2;
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${col}" fill-opacity="${(0.24 + (i % 3) * 0.14).toFixed(2)}" stroke="#ffffff" stroke-opacity="0.16"/>`);
    }
    artworkLayer = rects.join('\n');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="${uid}_bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c3}"/>
      <stop offset="55%" stop-color="${c2}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${c1}" stop-opacity="0.45"/>
    </linearGradient>
    <linearGradient id="${uid}_glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <linearGradient id="${uid}_fade" x1="0%" y1="55%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#08080c" stop-opacity="0"/>
      <stop offset="100%" stop-color="#08080c" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="${c3}"/>
  <rect width="400" height="400" fill="url(#${uid}_bg)"/>
  ${artworkLayer}
  <rect width="400" height="400" fill="url(#${uid}_fade)"/>
  <text x="26" y="346" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="22" font-weight="700" fill="#ffffff" letter-spacing="-0.4">${title.slice(0, 26)}</text>
  <text x="26" y="372" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="13" font-weight="500" fill="#d1d5db" letter-spacing="0.6">${artistName.toUpperCase()}</text>
</svg>`;
}

export function generateArtistSvg(artist) {
  const [c1, c2, c3] = artist.palette || ['#7c5cff', '#ec4899', '#111827'];
  const uid = `art_${hashStr(artist.id)}`;
  const abbr = escapeXml(initials(artist.name));
  const bars = [];
  const seed = hashStr(artist.id);
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const len = 18 + ((seed + i * 29) % 34);
    const x1 = 200 + Math.cos(angle) * 102;
    const y1 = 188 + Math.sin(angle) * 102;
    const x2 = 200 + Math.cos(angle) * (102 + len);
    const y2 = 188 + Math.sin(angle) * (102 + len);
    bars.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${i % 2 === 0 ? c1 : '#ffffff'}" stroke-opacity="0.55" stroke-width="4" stroke-linecap="round"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <radialGradient id="${uid}_rg" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="${c1}" stop-opacity="0.85"/>
      <stop offset="55%" stop-color="${c2}" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="${c3}"/>
    </radialGradient>
    <linearGradient id="${uid}_ring" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.75"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="${c3}"/>
  <rect width="400" height="400" fill="url(#${uid}_rg)"/>
  ${bars.join('\n')}
  <circle cx="200" cy="188" r="92" fill="#0d0d14" fill-opacity="0.55" stroke="url(#${uid}_ring)" stroke-width="3"/>
  <text x="200" y="210" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="68" font-weight="800" fill="#ffffff" letter-spacing="2">${abbr}</text>
  <text x="200" y="358" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="16" font-weight="600" fill="#f3f4f6" opacity="0.9">${escapeXml(artist.name)}</text>
</svg>`;
}

export function generateGenreSvg(genre) {
  const c1 = genre.color || '#7c5cff';
  const c2 = genre.accent || '#06b6d4';
  const uid = `gen_${hashStr(genre.id)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" width="400" height="240">
  <defs>
    <linearGradient id="${uid}_g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="240" fill="url(#${uid}_g)"/>
  <circle cx="330" cy="40" r="110" fill="#ffffff" fill-opacity="0.12"/>
  <circle cx="355" cy="195" r="85" fill="#000000" fill-opacity="0.18"/>
  <path d="M0,180 Q110,120 220,175 T400,145 L400,240 L0,240 Z" fill="#000000" fill-opacity="0.22"/>
</svg>`;
}
