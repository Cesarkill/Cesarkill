// Gera os SVGs animados do perfil "Horizonte / Singularity" (temas dark e light).
// Uso: node .github/scripts/singularity.mjs [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { TECH_ICONS } from "./icons.mjs";

const USER = process.env.GH_USER || "Cesarkill";
const TOKEN = process.env.GH_TOKEN || "";
const OUT = process.argv[2] || "dist";

const IGNORE_LANGS = new Set(["CMake", "C++", "C", "Swift", "Kotlin", "Objective-C", "Ruby"]);
const MONTHS_PT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const SANS = "'Segoe UI', 'Helvetica Neue', ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif";
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }";

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// PRNG determinístico (mulberry32) a partir de uma seed textual
function createRng(seedText) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toRoman(num) {
  const table = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let n = Math.max(1, Math.floor(num));
  let out = "";
  for (const [val, sym] of table) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coleta de dados (GraphQL no CI com GH_TOKEN; REST + série sintetizada local)
// ---------------------------------------------------------------------------

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": `${USER}-profile-generator`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function fetchWithGraphQL(login) {
  const now = new Date();
  // Janela estritamente <= 1 ano para atender o limite da API GraphQL
  const from365 = new Date(now.getTime() - 364 * 86400 * 1000).toISOString();
  const toNow = now.toISOString();

  const baseData = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        login
        name
        createdAt
        followers { totalCount }
        repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges {
                size
                node { name color }
              }
            }
          }
        }
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }`,
    { login, from: from365, to: toNow }
  );

  const u = baseData.user;
  if (!u) throw new Error(`Usuário '${login}' não encontrado no GraphQL.`);

  const createdYear = new Date(u.createdAt).getUTCFullYear();
  const currentYear = now.getUTCFullYear();
  let allTimeCommits = 0;

  for (let y = createdYear; y <= currentYear; y++) {
    const yFrom = new Date(Date.UTC(y, 0, 1)).toISOString();
    const yTo = new Date(Math.min(Date.UTC(y, 11, 31, 23, 59, 59), now.getTime())).toISOString();
    const yData = await gql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            restrictedContributionsCount
          }
        }
      }`,
      { login, from: yFrom, to: yTo }
    );
    const col = yData.user.contributionsCollection;
    allTimeCommits += (col.totalCommitContributions || 0) + (col.restrictedContributionsCount || 0);
  }

  const days = [];
  for (const w of u.contributionsCollection.contributionCalendar.weeks || []) {
    for (const d of w.contributionDays || []) {
      days.push({ date: d.date, count: d.contributionCount });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const last365 = days.slice(-365);

  const langMap = {};
  let stars = 0;
  for (const repo of u.repositories.nodes || []) {
    stars += repo.stargazerCount || 0;
    for (const edge of repo.languages?.edges || []) {
      const name = edge.node?.name;
      if (!name || IGNORE_LANGS.has(name)) continue;
      langMap[name] = (langMap[name] || 0) + edge.size;
    }
  }

  const languages = Object.entries(langMap)
    .map(([name, size]) => ({ name, size }))
    .sort((a, b) => b.size - a.size);

  return {
    login: u.login,
    name: "Cesar Giacomino",
    createdAt: u.createdAt,
    followers: u.followers?.totalCount || 0,
    repoCount: u.repositories?.totalCount ?? (u.repositories?.nodes?.length || 0),
    stars,
    allTimeCommits,
    total12m: u.contributionsCollection.contributionCalendar.totalContributions || last365.reduce((s, d) => s + d.count, 0),
    days: last365,
    languages,
    source: "graphql",
  };
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `${USER}-profile-preview`,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchPublicFallback(login) {
  const [userRes, reposRes, eventsRes] = await Promise.all([
    fetchJsonSafe(`https://api.github.com/users/${login}`),
    fetchJsonSafe(`https://api.github.com/users/${login}/repos?per_page=100&type=owner`),
    fetchJsonSafe(`https://api.github.com/users/${login}/events/public?per_page=100`),
  ]);

  const createdAt = userRes?.created_at || "2025-04-13T15:47:52Z";
  const followers = userRes?.followers ?? 4;

  const ownedRepos = Array.isArray(reposRes) ? reposRes.filter((r) => !r.fork) : [];
  const repoCount = ownedRepos.length || (userRes?.public_repos ?? 10);
  const stars = ownedRepos.reduce((s, r) => s + (r.stargazers_count || 0), 0);

  const langWeights = {};
  for (const r of ownedRepos) {
    if (!r.language || IGNORE_LANGS.has(r.language)) continue;
    langWeights[r.language] = (langWeights[r.language] || 0) + Math.max(20, r.size || 100);
  }
  let languages = Object.entries(langWeights)
    .map(([name, size]) => ({ name, size }))
    .sort((a, b) => b.size - a.size);

  if (!languages.length) {
    languages = [
      { name: "JavaScript", size: 420 },
      { name: "Dart", size: 280 },
      { name: "Python", size: 160 },
      { name: "PHP", size: 90 },
      { name: "HTML", size: 50 },
    ];
  }

  // Mapa de eventos públicos recentes para enriquecer a série sintetizada
  const eventBoost = {};
  if (Array.isArray(eventsRes)) {
    for (const ev of eventsRes) {
      if (!ev.created_at) continue;
      const dayKey = ev.created_at.slice(0, 10);
      const weight = ev.type === "PushEvent" ? Math.max(1, ev.payload?.size || 2) : 1;
      eventBoost[dayKey] = (eventBoost[dayKey] || 0) + weight;
    }
  }

  // Sintetiza 365 dias realistas e determinísticos para preview local
  const rand = createRng(`preview:${login}`);
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400 * 1000);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const wave = 0.55 + 0.45 * Math.sin((365 - i) / 28);
    const activeProb = (dow === 0 || dow === 6 ? 0.28 : 0.48) * wave;
    let count = 0;
    if (rand() < activeProb) {
      count = 1 + Math.floor(Math.pow(rand(), 1.7) * 7);
    }
    if (eventBoost[iso]) {
      count += eventBoost[iso];
    }
    days.push({ date: iso, count });
  }

  const total12m = days.reduce((s, d) => s + d.count, 0);

  return {
    login: userRes?.login || login,
    name: "Cesar Giacomino",
    createdAt,
    followers,
    repoCount,
    stars,
    total12m,
    allTimeCommits: Math.max(total12m, Math.round(total12m * 1.15)),
    days,
    languages,
    source: userRes ? "rest-fallback" : "offline-fallback",
  };
}

async function loadProfile(login) {
  if (TOKEN) {
    return fetchWithGraphQL(login);
  }
  return fetchPublicFallback(login);
}

// ---------------------------------------------------------------------------
// Métricas derivadas
// ---------------------------------------------------------------------------

function computeMetrics(profile) {
  const days = profile.days || [];
  let longestStreak = 0;
  let running = 0;
  let activeDays = 0;

  const monthly = new Array(12).fill(0);
  for (const d of days) {
    if (d.count > 0) {
      activeDays += 1;
      running += 1;
      if (running > longestStreak) longestStreak = running;
    } else {
      running = 0;
    }
    const monthIdx = Number(d.date.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      monthly[monthIdx] += d.count;
    }
  }

  const createdYear = new Date(profile.createdAt).getUTCFullYear();
  const years = Math.max(1, new Date().getUTCFullYear() - createdYear + 1);
  const missionRoman = toRoman(years);
  const yearsLabel = years === 1 ? "1 ANO" : `${years} ANOS`;

  let busiestMonth = 0;
  for (let i = 1; i < 12; i++) {
    if (monthly[i] > monthly[busiestMonth]) busiestMonth = i;
  }

  return {
    years,
    yearsLabel,
    missionName: `HORIZONTE ${missionRoman}`,
    total12m: profile.total12m,
    activeDays,
    longestStreak,
    repoCount: profile.repoCount,
    allTimeCommits: profile.allTimeCommits,
    stars: profile.stars,
    followers: profile.followers,
    monthly,
    busiestMonth,
  };
}

// ---------------------------------------------------------------------------
// Paletas Dark & Light ("chapas astronômicas negativas" no tema claro)
// ---------------------------------------------------------------------------

const THEMES = {
  dark: {
    bg: "#04050c",
    panelBg: "#070911",
    cardBg: "#0b0f1b",
    border: "#1a2234",
    bar: "#000000",
    barBorder: "#141926",
    barText: "#b8c0d4",
    fg: "#f6f2ea",
    muted: "#8a94ad",
    hud: "#7dd3fc",
    radarFill: "#38bdf8",
    star: "#ffffff",
    shadow: "#000000",
    planet: "#05070e",
    diskLo: "#8b4c1c",
    diskMid: "#ffae4c",
    diskHi: "#fff3de",
    photon: "#ffe6be",
    haze: "#ff8f36",
    hazeAlpha: 0.19,
    lensAlpha: 0.85,
    dopplerGlow: "#ffd498",
    dopplerAlpha: 0.24,
    spectrum: ["#7dd3fc", "#38bdf8", "#818cf8", "#fbbf24", "#94a3b8"],
  },
  light: {
    bg: "#f4f1ea",
    panelBg: "#f4f1ea",
    cardBg: "#eae5da",
    border: "#d0cabd",
    bar: "#111319",
    barBorder: "#252a36",
    barText: "#cfd5e2",
    fg: "#12141b",
    muted: "#575e70",
    hud: "#0b5cad",
    radarFill: "#0b5cad",
    star: "#171a23",
    shadow: "#f4f1ea",
    planet: "#e3ded2",
    diskLo: "#a8a093",
    diskMid: "#474139",
    diskHi: "#0d0c0b",
    photon: "#1a1714",
    haze: "#1a1d26",
    hazeAlpha: 0.08,
    lensAlpha: 0.45,
    dopplerGlow: "#181512",
    dopplerAlpha: 0.09,
    spectrum: ["#0b5cad", "#0284c7", "#4f46e5", "#b45309", "#475569"],
  },
};

// ---------------------------------------------------------------------------
// 1. Hero — Buraco Negro Gargantua (1200 x 560)
// ---------------------------------------------------------------------------

function buildHeroSvg(profile, metrics, themeName) {
  const c = THEMES[themeName];
  const W = 1200;
  const H = 560;
  const BAR = 52;
  const cx = 600;
  const cy = 238;
  const Rs = 78;
  const Rin = 104;
  const Rout = 355;
  const TILT = -8;
  const SQUASH = 0.21;

  const rand = createRng(`hero:${profile.login}`);
  const loginUpper = profile.login.toUpperCase();

  // Campo de estrelas com cintilação sutil em parte delas
  let staticStars = "";
  let twinkleStars = "";
  for (let i = 0; i < 200; i++) {
    const sx = r1(18 + rand() * (W - 36));
    const sy = r1(BAR + 8 + rand() * (H - BAR * 2 - 16));
    const isBright = rand() > 0.9;
    const sr = r2(isBright ? 1.15 + rand() * 0.85 : 0.4 + rand() * 0.75);
    const op = r2(0.22 + rand() * 0.7);
    if (i % 7 === 0) {
      const delay = r2(rand() * 4.5);
      const dur = r2(3.4 + rand() * 2.4);
      twinkleStars += `<circle class="tw" style="animation-duration:${dur}s;animation-delay:${delay}s" cx="${sx}" cy="${sy}" r="${sr}" fill="${c.star}" opacity="${op}"/>`;
    } else {
      staticStars += `<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${c.star}" opacity="${op}"/>`;
    }
  }

  // Helper para arcos de plasma no plano local do disco
  const makeArc = (radius, angle, arcLen, width, color, opacity) => {
    const x1 = r1(Math.cos(angle) * radius);
    const y1 = r1(Math.sin(angle) * radius);
    const x2 = r1(Math.cos(angle + arcLen) * radius);
    const y2 = r1(Math.sin(angle + arcLen) * radius);
    return `<path d="M${x1} ${y1}A${r1(radius)} ${r1(radius)} 0 0 1 ${x2} ${y2}" stroke="${color}" stroke-width="${r2(width)}" stroke-opacity="${r2(opacity)}" fill="none" stroke-linecap="round"/>`;
  };

  // 3 faixas keplerianas: interna rápida, média intermediária, externa lenta
  const bands = ["", "", ""];
  const bandStep = (Rout - Rin) / 3;
  const bandIndexFor = (radius) => Math.min(2, Math.max(0, Math.floor((radius - Rin) / bandStep)));

  const days = (profile.days || []).slice(-365);
  const peakDay = Math.max(1, ...days.map((d) => d.count));

  // 365 partículas guiadas pelas contribuições diárias
  for (let i = 0; i < days.length; i++) {
    const count = days[i].count;
    const intensity = count > 0 ? Math.min(1, Math.pow(count / peakDay, 0.65)) : 0;
    // Dias mais intensos orbitam mais próximos do horizonte de eventos
    const radialNorm = count > 0
      ? Math.max(0.02, Math.min(0.95, 0.85 - intensity * 0.72 + (rand() - 0.5) * 0.28))
      : 0.15 + rand() * 0.83;
    const radius = Rin + radialNorm * (Rout - Rin);
    const angle = (i / Math.max(1, days.length)) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const arcLen = count > 0 ? 0.12 + intensity * 0.34 + rand() * 0.12 : 0.05 + rand() * 0.08;
    const width = count > 0 ? 1.5 + intensity * 2.8 : 0.7 + rand() * 0.7;
    const color = intensity > 0.55 ? c.diskHi : count > 0 ? c.diskMid : c.diskLo;
    const opacity = count > 0 ? 0.38 + intensity * 0.58 : 0.14 + rand() * 0.18;
    bands[bandIndexFor(radius)] += makeArc(radius, angle, arcLen, width, color, opacity);
  }

  // Poeira orbital complementar para dar volume contínuo ao disco
  for (let i = 0; i < 255; i++) {
    const t = Math.pow(rand(), 1.35);
    const radius = Rin + t * (Rout - Rin);
    const angle = rand() * Math.PI * 2;
    const arcLen = 0.08 + rand() * 0.28;
    const width = 0.7 + (1 - t) * 1.9 + rand() * 0.9;
    const color = t < 0.26 ? c.diskHi : t < 0.68 ? c.diskMid : c.diskLo;
    const opacity = 0.12 + (1 - t) * 0.34;
    bands[bandIndexFor(radius)] += makeArc(radius, angle, arcLen, width, color, opacity);
  }

  const css = `
    .tw { animation: twinkle 4s ease-in-out infinite; }
    .halo { animation: haloPulse 6.5s ease-in-out infinite; }
    .spin-0 { transform-origin: 0px 0px; animation: spin 20s linear infinite; }
    .spin-1 { transform-origin: 0px 0px; animation: spin 36s linear infinite; }
    .spin-2 { transform-origin: 0px 0px; animation: spin 60s linear infinite; }
    .title-block { animation: rise 1.2s cubic-bezier(0.16, 1, 0.3, 1) .15s backwards; }
    @keyframes twinkle { 0%, 100% { opacity: .22; } 50% { opacity: .95; } }
    @keyframes haloPulse { 0%, 100% { opacity: ${r2(c.lensAlpha * 0.88)}; } 50% { opacity: ${r2(c.lensAlpha)}; } }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
    ${REDUCED_MOTION}
  `;

  const aria = escapeXml(
    `${profile.name} (@${profile.login}): ${metrics.missionName}, ${fmt(metrics.total12m)} contribuições nos últimos 12 meses, ${fmt(metrics.activeDays)} dias ativos, maior sequência de ${metrics.longestStreak} dias.`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">
  <style>${css}</style>
  <defs>
    <clipPath id="frame-clip"><rect width="${W}" height="${H}" rx="14"/></clipPath>
    <clipPath id="disk-back"><rect x="-430" y="-430" width="860" height="430"/></clipPath>
    <clipPath id="disk-front"><rect x="-430" y="0" width="860" height="430"/></clipPath>

    <filter id="lens-blur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="8"/>
    </filter>
    <filter id="photon-blur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.2"/>
    </filter>

    <radialGradient id="ambient-haze" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${c.haze}" stop-opacity="${r2(c.hazeAlpha * 1.4)}"/>
      <stop offset="48%" stop-color="${c.haze}" stop-opacity="${r2(c.hazeAlpha * 0.6)}"/>
      <stop offset="100%" stop-color="${c.haze}" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="doppler-boost" cx="35%" cy="50%" r="48%">
      <stop offset="0%" stop-color="${c.dopplerGlow}" stop-opacity="${c.dopplerAlpha}"/>
      <stop offset="65%" stop-color="${c.diskMid}" stop-opacity="${r2(c.dopplerAlpha * 0.35)}"/>
      <stop offset="100%" stop-color="${c.diskMid}" stop-opacity="0"/>
    </radialGradient>

    <linearGradient id="doppler-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="38%" stop-color="#f2f2f2"/>
      <stop offset="62%" stop-color="#9e9e9e"/>
      <stop offset="100%" stop-color="#5c5c5c"/>
    </linearGradient>

    <linearGradient id="lens-upper-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c.diskLo}" stop-opacity="0"/>
      <stop offset="22%" stop-color="${c.diskMid}" stop-opacity="0.85"/>
      <stop offset="45%" stop-color="${c.diskHi}" stop-opacity="0.98"/>
      <stop offset="78%" stop-color="${c.diskMid}" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="${c.diskLo}" stop-opacity="0"/>
    </linearGradient>

    <linearGradient id="lens-lower-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c.diskLo}" stop-opacity="0"/>
      <stop offset="28%" stop-color="${c.diskMid}" stop-opacity="0.62"/>
      <stop offset="50%" stop-color="${c.diskHi}" stop-opacity="0.78"/>
      <stop offset="76%" stop-color="${c.diskMid}" stop-opacity="0.48"/>
      <stop offset="100%" stop-color="${c.diskLo}" stop-opacity="0"/>
    </linearGradient>

    <mask id="doppler-mask" maskUnits="userSpaceOnUse" x="-430" y="-430" width="860" height="860">
      <rect x="-430" y="-430" width="860" height="860" fill="url(#doppler-grad)"/>
    </mask>

    <g id="band-0">${bands[0]}</g>
    <g id="band-1">${bands[1]}</g>
    <g id="band-2">${bands[2]}</g>
  </defs>

  <g clip-path="url(#frame-clip)">
    <rect width="${W}" height="${H}" fill="${c.bg}"/>

    <!-- Campo estelar -->
    <g>${staticStars}${twinkleStars}</g>

    <!-- Brilho ambiente gravitacional -->
    <ellipse cx="${cx}" cy="${cy}" rx="410" ry="125" fill="url(#ambient-haze)" transform="rotate(${TILT} ${cx} ${cy})"/>

    <!-- Lente gravitacional superior e inferior (luz dobrada ao redor da sombra) -->
    <g class="halo" transform="translate(${cx}, ${cy}) rotate(${TILT})">
      <path d="M -134 -6 C -116 -144, 116 -144, 134 -6" fill="none" stroke="url(#lens-upper-grad)" stroke-width="18" filter="url(#lens-blur)" opacity="0.84"/>
      <path d="M -114 -4 C -98 -126, 98 -126, 114 -4" fill="none" stroke="url(#lens-upper-grad)" stroke-width="5.5" opacity="0.94"/>
      <path d="M -86 0 A 86 86 0 0 1 86 0" fill="none" stroke="${c.diskHi}" stroke-width="2" opacity="0.9"/>

      <path d="M -112 6 C -94 122, 94 122, 112 6" fill="none" stroke="url(#lens-lower-grad)" stroke-width="11" filter="url(#lens-blur)" opacity="0.68"/>
      <path d="M -85 2 A 85 85 0 0 0 85 2" fill="none" stroke="url(#lens-lower-grad)" stroke-width="2.5" opacity="0.8"/>
    </g>

    <!-- Metade traseira do disco de acreção (atrás do horizonte de eventos) -->
    <g transform="translate(${cx}, ${cy}) rotate(${TILT}) scale(1, ${SQUASH})">
      <g clip-path="url(#disk-back)" mask="url(#doppler-mask)">
        <g class="spin-2"><use href="#band-2" xlink:href="#band-2"/></g>
        <g class="spin-1"><use href="#band-1" xlink:href="#band-1"/></g>
        <g class="spin-0"><use href="#band-0" xlink:href="#band-0"/></g>
      </g>
    </g>

    <!-- Horizonte de eventos + anel de fótons -->
    <circle cx="${cx}" cy="${cy}" r="${Rs + 2}" fill="none" stroke="${c.photon}" stroke-width="4" stroke-opacity="0.45" filter="url(#photon-blur)"/>
    <circle cx="${cx}" cy="${cy}" r="${Rs}" fill="${c.shadow}"/>
    <circle cx="${cx}" cy="${cy}" r="${Rs + 0.8}" fill="none" stroke="${c.diskHi}" stroke-width="1.35" stroke-opacity="0.9"/>

    <!-- Metade frontal do disco de acreção (na frente do horizonte de eventos) -->
    <g transform="translate(${cx}, ${cy}) rotate(${TILT}) scale(1, ${SQUASH})">
      <g clip-path="url(#disk-front)" mask="url(#doppler-mask)">
        <ellipse cx="-65" cy="40" rx="285" ry="260" fill="url(#doppler-boost)"/>
        <g class="spin-2"><use href="#band-2" xlink:href="#band-2"/></g>
        <g class="spin-1"><use href="#band-1" xlink:href="#band-1"/></g>
        <g class="spin-0"><use href="#band-0" xlink:href="#band-0"/></g>
        <path d="M -104 4 A 104 104 0 0 0 104 4" fill="none" stroke="${c.diskHi}" stroke-width="3.2" stroke-opacity="0.58"/>
      </g>
    </g>

    <!-- Bloco de identidade -->
    <g class="title-block" text-anchor="middle">
      <text x="${cx + 7}" y="432" font-family="${SANS}" font-weight="300" font-size="38" letter-spacing="14" fill="${c.fg}">${escapeXml(profile.name.toUpperCase())}</text>
      <text x="${cx}" y="466" font-family="${SANS}" font-weight="400" font-size="14.5" letter-spacing="0.8" fill="${c.muted}">Desenvolvedor Web &amp; Full-Stack · React, Next.js &amp; Flutter</text>
    </g>

    <!-- Barras letterbox cinematográficas -->
    <rect x="0" y="0" width="${W}" height="${BAR}" fill="${c.bar}"/>
    <line x1="0" y1="${BAR}" x2="${W}" y2="${BAR}" stroke="${c.barBorder}"/>
    <circle cx="36" cy="26" r="3" fill="${c.hud}"/>
    <text x="48" y="30" font-family="${MONO}" font-size="11.5" letter-spacing="2.4" fill="${c.barText}">REGISTRO DE MISSÃO // ${escapeXml(metrics.missionName)}</text>
    <text x="${W - 36}" y="30" text-anchor="end" font-family="${MONO}" font-size="11.5" letter-spacing="2.2" fill="${c.barText}">T+ ${escapeXml(metrics.yearsLabel)} · @${escapeXml(loginUpper)}</text>

    <rect x="0" y="${H - BAR}" width="${W}" height="${BAR}" fill="${c.bar}"/>
    <line x1="0" y1="${H - BAR}" x2="${W}" y2="${H - BAR}" stroke="${c.barBorder}"/>
    <text x="${cx}" y="${H - 21}" text-anchor="middle" font-family="${MONO}" font-size="11.5" letter-spacing="2.5" fill="${c.barText}">${fmt(metrics.total12m)} CONTRIBUIÇÕES · ${fmt(metrics.activeDays)} DIAS EM ÓRBITA · MAIOR SEQUÊNCIA ${metrics.longestStreak} DIAS</text>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${c.border}"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// 2. Telemetria — Órbita mensal + 6 indicadores + Composição espectral (1200 x 440)
// ---------------------------------------------------------------------------

function cornerBrackets(x, y, w, h, arm, color, opacity = 1) {
  const x2 = x + w;
  const y2 = y + h;
  return `<path d="M${x} ${y + arm}V${y}H${x + arm}M${x2 - arm} ${y}H${x2}V${y + arm}M${x} ${y2 - arm}V${y2}H${x + arm}M${x2 - arm} ${y2}H${x2}V${y2 - arm}" fill="none" stroke="${color}" stroke-width="1.3" stroke-opacity="${opacity}"/>`;
}

// Converte série polar de 12 pontos numa curva fechada suave (Catmull-Rom -> Bézier cúbico)
function buildOrbitPath(points) {
  const n = points.length;
  if (!n) return { d: "", length: 0 };
  const segs = [];
  let approxLen = 0;

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    if (i === 0) segs.push(`M${r1(p1[0])} ${r1(p1[1])}`);
    segs.push(`C${r1(c1x)} ${r1(c1y)},${r1(c2x)} ${r1(c2y)},${r1(p2[0])} ${r1(p2[1])}`);
    approxLen += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  }
  segs.push("Z");
  return { d: segs.join(" "), length: Math.ceil(approxLen * 1.15) };
}

function buildTelemetrySvg(profile, metrics, themeName) {
  const c = THEMES[themeName];
  const W = 1200;
  const H = 440;
  const loginUpper = profile.login.toUpperCase();

  // Radar orbital à esquerda
  const ox = 235;
  const oy = 240;
  const R = 108;
  const maxMonth = Math.max(1, ...metrics.monthly);

  let radarGrid = "";
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    radarGrid += `<circle cx="${ox}" cy="${oy}" r="${r1(R * frac)}" fill="none" stroke="${c.border}" stroke-dasharray="${frac === 1 ? "none" : "3 4"}"/>`;
  }

  let spokes = "";
  const pts = [];
  for (let m = 0; m < 12; m++) {
    const angle = -Math.PI / 2 + (m * Math.PI * 2) / 12;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    spokes += `<line x1="${ox}" y1="${oy}" x2="${r1(ox + cos * R)}" y2="${r1(oy + sin * R)}" stroke="${c.border}" stroke-opacity="0.7"/>`;
    const lx = r1(ox + cos * (R + 21));
    const ly = r1(oy + sin * (R + 21) + 3.5);
    const isPeak = m === metrics.busiestMonth;
    spokes += `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="${MONO}" font-size="9.5" letter-spacing="1" fill="${isPeak ? c.hud : c.muted}" font-weight="${isPeak ? "700" : "400"}">${MONTHS_PT[m]}</text>`;

    const norm = metrics.monthly[m] / maxMonth;
    const rad = R * (0.18 + 0.82 * norm);
    pts.push([ox + cos * rad, oy + sin * rad]);
  }

  const orbit = buildOrbitPath(pts);
  const beacon = pts[metrics.busiestMonth] || pts[0];
  const bx = r1(beacon[0]);
  const by = r1(beacon[1]);

  // Grade 3x2 de cartões de telemetria à direita
  const cards = [
    ["TEMPO DE MISSÃO", fmt(metrics.years), metrics.years === 1 ? "ANO NO GITHUB" : "ANOS NO GITHUB"],
    ["DISTÂNCIA", fmt(metrics.total12m), "CONTRIBUIÇÕES · 12M"],
    ["DIAS EM ÓRBITA", fmt(metrics.activeDays), "DIAS ATIVOS"],
    ["MAIOR SEQUÊNCIA", fmt(metrics.longestStreak), "DIAS SEGUIDOS"],
    ["REPOSITÓRIOS", fmt(metrics.repoCount), "MUNDOS CRIADOS"],
    ["COMMITS TOTAIS", fmt(metrics.allTimeCommits), "HISTÓRICO GERAL"],
  ];

  const rx0 = 470;
  const ry0 = 86;
  const colW = 218;
  const colGap = 16;
  const rowH = 104;
  const rowGap = 14;
  const rightWidth = colW * 3 + colGap * 2; // 686

  let cardsSvg = "";
  cards.forEach(([title, value, sub], idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = rx0 + col * (colW + colGap);
    const y = ry0 + row * (rowH + rowGap);
    const delay = r2(0.15 + idx * 0.08);
    cardsSvg += `
    <g class="card-in" style="animation-delay:${delay}s">
      <rect x="${x}" y="${y}" width="${colW}" height="${rowH}" rx="6" fill="${c.cardBg}"/>
      ${cornerBrackets(x, y, colW, rowH, 10, c.hud, 0.55)}
      <text x="${x + 16}" y="${y + 24}" font-family="${MONO}" font-size="9.5" letter-spacing="1.6" fill="${c.muted}">${title}</text>
      <text x="${x + 16}" y="${y + 66}" font-family="${SANS}" font-weight="300" font-size="31" fill="${c.fg}">${escapeXml(value)}</text>
      <text x="${x + 16}" y="${y + 88}" font-family="${MONO}" font-size="9.5" letter-spacing="1.3" fill="${c.hud}">${sub}</text>
    </g>`;
  });

  // Composição espectral (top 5 linguagens)
  const topLangs = (profile.languages || []).slice(0, 5);
  const langTotal = Math.max(1, topLangs.reduce((s, l) => s + l.size, 0));
  const specY = 358;
  let sx = rx0;
  let barSegs = "";
  let legendItems = "";
  const legendStep = rightWidth / Math.max(1, topLangs.length);

  topLangs.forEach((lang, idx) => {
    const color = c.spectrum[idx % c.spectrum.length];
    const ratio = lang.size / langTotal;
    const segW = idx === topLangs.length - 1 ? rx0 + rightWidth - sx : ratio * rightWidth;
    barSegs += `<rect x="${r1(sx)}" y="${specY}" width="${r1(Math.max(2, segW))}" height="10" fill="${color}"/>`;
    sx += segW;

    const pct = Math.round(ratio * 100);
    const lx = r1(rx0 + idx * legendStep);
    legendItems += `
      <circle cx="${lx + 4}" cy="${specY + 26}" r="3.5" fill="${color}"/>
      <text x="${lx + 14}" y="${specY + 30}" font-family="${MONO}" font-size="10.5" letter-spacing="1.2" fill="${c.muted}">${escapeXml(lang.name.toUpperCase())} ${pct}%</text>`;
  });

  const css = `
    .orbit-path { stroke-dasharray: ${orbit.length}; animation: drawOrbit 1.8s cubic-bezier(0.16, 1, 0.3, 1) .15s backwards; }
    .orbit-fill { animation: fadeIn 1.4s ease-out .4s backwards; }
    .beacon-ping { transform-origin: 0px 0px; animation: beaconPing 2.4s ease-out infinite; }
    .card-in { animation: rise .9s cubic-bezier(0.16, 1, 0.3, 1) backwards; }
    .spec-bar { transform-origin: ${rx0}px ${specY + 5}px; animation: growBar 1.3s cubic-bezier(0.16, 1, 0.3, 1) .35s backwards; }
    .scan { animation: scanSweep 2.6s cubic-bezier(0.16, 1, 0.3, 1) .15s forwards; }
    @keyframes drawOrbit { from { stroke-dashoffset: ${orbit.length}; } to { stroke-dashoffset: 0; } }
    @keyframes fadeIn { from { opacity: 0; } }
    @keyframes beaconPing { 0% { opacity: .9; transform: scale(1); } 100% { opacity: 0; transform: scale(3.1); } }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    @keyframes growBar { from { transform: scaleX(0); } }
    @keyframes scanSweep { 0% { opacity: .85; transform: translateX(0); } 80% { opacity: .45; } 100% { opacity: 0; transform: translateX(${W - 30}px); } }
    ${REDUCED_MOTION}
  `;

  const aria = escapeXml(
    `Telemetria da missão ${metrics.missionName}: ${metrics.years} anos no GitHub, ${metrics.total12m} contribuições em 12 meses, ${metrics.activeDays} dias ativos, maior sequência de ${metrics.longestStreak} dias, ${metrics.repoCount} repositórios, ${metrics.allTimeCommits} commits totais.`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">
  <style>${css}</style>
  <defs>
    <clipPath id="tel-frame"><rect width="${W}" height="${H}" rx="14"/></clipPath>
    <clipPath id="spec-clip"><rect x="${rx0}" y="${specY}" width="${rightWidth}" height="10" rx="5"/></clipPath>
    <linearGradient id="scan-trail" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c.hud}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${c.hud}" stop-opacity="0.28"/>
    </linearGradient>
  </defs>

  <g clip-path="url(#tel-frame)">
    <rect width="${W}" height="${H}" fill="${c.panelBg}"/>
    ${cornerBrackets(14, 14, W - 28, H - 28, 20, c.hud, 0.85)}

    <!-- Cabeçalho do painel -->
    <text x="38" y="46" font-family="${MONO}" font-size="12" letter-spacing="3" fill="${c.hud}">TELEMETRIA DA MISSÃO</text>
    <text x="${W - 38}" y="46" text-anchor="end" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${c.muted}">${escapeXml(metrics.missionName)} · @${escapeXml(loginUpper)}</text>
    <line x1="38" y1="62" x2="${W - 38}" y2="62" stroke="${c.border}"/>

    <!-- Radar orbital -->
    ${radarGrid}
    ${spokes}
    <path class="orbit-fill" d="${orbit.d}" fill="${c.radarFill}" fill-opacity="0.11"/>
    <path class="orbit-path" d="${orbit.d}" fill="none" stroke="${c.hud}" stroke-width="2" stroke-linejoin="round"/>
    <g transform="translate(${bx}, ${by})">
      <circle class="beacon-ping" cx="0" cy="0" r="5" fill="none" stroke="${c.hud}" stroke-width="1.5"/>
      <circle cx="0" cy="0" r="4" fill="${c.hud}"/>
    </g>
    <text x="${ox}" y="406" text-anchor="middle" font-family="${MONO}" font-size="10" letter-spacing="2" fill="${c.muted}">ÓRBITA · CONTRIBUIÇÕES POR MÊS</text>

    <!-- Cards numéricos -->
    ${cardsSvg}

    <!-- Composição espectral -->
    <text x="${rx0}" y="346" font-family="${MONO}" font-size="10.5" letter-spacing="2" fill="${c.muted}">COMPOSIÇÃO ESPECTRAL</text>
    <rect x="${rx0}" y="${specY}" width="${rightWidth}" height="10" rx="5" fill="${c.cardBg}"/>
    <g clip-path="url(#spec-clip)">
      <g class="spec-bar">${barSegs}</g>
    </g>
    ${legendItems}

    <!-- Varredura HUD inicial -->
    <g class="scan" opacity="0">
      <rect x="-70" y="14" width="70" height="${H - 28}" fill="url(#scan-trail)"/>
      <rect x="0" y="14" width="1.5" height="${H - 28}" fill="${c.hud}"/>
    </g>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${c.border}"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// 3. Tecnologias — Painel HUD da stack (1200 x 510)
// ---------------------------------------------------------------------------

const TECH_SECTIONS = [
  {
    title: "FRONT-END",
    ruleX: 136,
    items: [
      ["JavaScript", "javascript"],
      ["TypeScript", "typescript"],
      ["React", "react"],
      ["Next.js", "nextdotjs"],
      ["Vite", "vite"],
      ["Tailwind", "tailwindcss"],
      ["CSS", "css"],
    ],
  },
  {
    title: "BACK-END & DADOS",
    ruleX: 208,
    items: [
      ["Node.js", "nodedotjs"],
      ["Python", "python"],
      ["Supabase", "supabase"],
      ["Firebase", "firebase"],
      ["PostgreSQL", "postgresql"],
    ],
  },
  {
    title: "MOBILE, TESTES & DEPLOY",
    ruleX: 270,
    items: [
      ["Flutter", "flutter"],
      ["Dart", "dart"],
      ["Vitest", "vitest"],
      ["Git", "git"],
      ["Vercel", "vercel"],
    ],
  },
];

function buildTechSvg(profile, metrics, themeName) {
  const c = THEMES[themeName];
  const W = 1200;
  const H = 510;
  const loginUpper = profile.login.toUpperCase();

  const x0 = 38;
  const tileW = 148;
  const tileH = 96;
  const gap = 14;
  const headerYs = [94, 234, 374];
  const rowYs = [108, 248, 388];

  let body = "";
  let tileIdx = 0;

  TECH_SECTIONS.forEach((sec, sIdx) => {
    const hy = headerYs[sIdx];
    const ry = rowYs[sIdx];
    body += `
    <text x="${x0}" y="${hy}" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="2.2" fill="${c.diskMid}">${escapeXml(sec.title)}</text>
    <line x1="${sec.ruleX}" y1="${hy - 4}" x2="${W - 38}" y2="${hy - 4}" stroke="${c.border}"/>`;

    sec.items.forEach(([label, slug], iIdx) => {
      const x = x0 + iIdx * (tileW + gap);
      const y = ry;
      const delay = r2(0.08 + tileIdx * 0.035);
      tileIdx += 1;
      const iconPath = TECH_ICONS[slug];
      if (!iconPath) throw new Error(`Ícone não encontrado para slug '${slug}'`);
      const tx = r1(x + tileW / 2 - 16.2);
      const ty = y + 18;

      body += `
    <g class="tech-tile" style="animation-delay:${delay}s">
      <rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="6" fill="${c.cardBg}" stroke="${c.border}"/>
      <path d="M${x} ${y + 10}V${y}H${x + 10}" fill="none" stroke="${c.hud}" stroke-width="1.3" stroke-opacity="0.75"/>
      <path d="M${x + tileW - 12} ${y + tileH}H${x + tileW}V${y + tileH - 12}" fill="none" stroke="${c.diskMid}" stroke-width="1.3" stroke-opacity="0.85"/>
      <g transform="translate(${tx}, ${ty}) scale(1.35)">
        <path fill="${c.hud}" d="${iconPath}"/>
      </g>
      <text x="${x + tileW / 2}" y="${y + 76}" text-anchor="middle" font-family="${SANS}" font-size="13" font-weight="600" fill="${c.fg}">${escapeXml(label)}</text>
    </g>`;
    });
  });

  const css = `
    .tech-tile { animation: rise .8s cubic-bezier(0.16, 1, 0.3, 1) backwards; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    ${REDUCED_MOTION}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tecnologias: JavaScript, TypeScript, React, Next.js, Vite, Tailwind, CSS, Node.js, Python, Supabase, Firebase, PostgreSQL, Flutter, Dart, Vitest, Git e Vercel.">
  <style>${css}</style>
  <defs>
    <clipPath id="tech-frame"><rect width="${W}" height="${H}" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#tech-frame)">
    <rect width="${W}" height="${H}" fill="${c.panelBg}"/>
    ${cornerBrackets(14, 14, W - 28, H - 28, 20, c.hud, 0.85)}
    <text x="38" y="46" font-family="${MONO}" font-size="12" letter-spacing="3" fill="${c.hud}">TECNOLOGIAS // SISTEMAS DE BORDO</text>
    <text x="${W - 38}" y="46" text-anchor="end" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${c.muted}">${escapeXml(metrics.missionName)} · @${escapeXml(loginUpper)}</text>
    <line x1="38" y1="62" x2="${W - 38}" y2="62" stroke="${c.border}"/>
    ${body}
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${c.border}"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// 4. Projetos — Cards clicáveis em grade 2x2 (590 x 195 cada)
// ---------------------------------------------------------------------------

const PROJECTS = [
  {
    id: "project-1",
    code: "MSN-01",
    title: "Fatura Clara",
    lines: [
      "Análise inteligente de faturas de cartão de crédito",
      "(.OFX) rodando 100% local no navegador.",
    ],
    stack: "JAVASCRIPT · WEB · OFX · FIREBASE",
    url: "https://github.com/Cesarkill/fatura-clara",
  },
  {
    id: "project-2",
    code: "MSN-02",
    title: "Leitor Corte a Laser",
    lines: [
      "App desktop Python que lê folhas de corte a laser",
      "com Google Gemini e digita no ERP WK Radar.",
    ],
    stack: "PYTHON · GEMINI AI · AUTOMAÇÃO",
    url: "https://github.com/Cesarkill/leitor-corte-laser-wkradar",
  },
  {
    id: "project-3",
    code: "MSN-03",
    title: "EcoMap Brasil — Web",
    lines: [
      "Plataforma web colaborativa de mapeamento ambiental",
      "desenvolvida no 4º semestre de DSM na Fatec.",
    ],
    stack: "NEXT.JS · TYPESCRIPT · TAILWIND",
    url: "https://github.com/ecomap-devs/semestre-4-nextjs",
  },
  {
    id: "project-4",
    code: "MSN-04",
    title: "EcoMap Brasil — Mobile",
    lines: [
      "Aplicativo Android do EcoMap Brasil construído em",
      "equipe para monitoramento e rotas sustentáveis.",
    ],
    stack: "FLUTTER · DART · MOBILE",
    url: "https://github.com/ecomap-devs/semestre-4-flutter",
  },
];

function buildProjectSvg(project, index, themeName) {
  const c = THEMES[themeName];
  const W = 590;
  const H = 195;
  const delay = r2(0.1 + index * 0.08);

  const css = `
    .proj-in { animation: rise .85s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s backwards; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    ${REDUCED_MOTION}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(`${project.title}: ${project.lines.join(" ")}`)}">
  <style>${css}</style>
  <defs>
    <clipPath id="proj-clip"><rect width="${W}" height="${H}" rx="12"/></clipPath>
  </defs>
  <g clip-path="url(#proj-clip)">
    <rect width="${W}" height="${H}" fill="${c.panelBg}"/>
    ${cornerBrackets(10, 10, W - 20, H - 20, 16, c.hud, 0.78)}
    <g class="proj-in">
      <circle cx="32" cy="34" r="3.5" fill="${c.diskMid}"/>
      <text x="44" y="38" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="2" fill="${c.diskMid}">${escapeXml(project.code)}</text>
      <path d="M548 38 L558 28 M550 28 H558 V36" fill="none" stroke="${c.hud}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="28" y="72" font-family="${SANS}" font-size="20" font-weight="600" fill="${c.fg}">${escapeXml(project.title)}</text>
      <text x="28" y="100" font-family="${SANS}" font-size="13.5" fill="${c.muted}">${escapeXml(project.lines[0])}</text>
      <text x="28" y="120" font-family="${SANS}" font-size="13.5" fill="${c.muted}">${escapeXml(project.lines[1])}</text>
      <line x1="28" y1="146" x2="562" y2="146" stroke="${c.border}"/>
      <text x="28" y="170" font-family="${MONO}" font-size="11" letter-spacing="1.6" fill="${c.hud}">${escapeXml(project.stack)}</text>
    </g>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${c.border}"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// 5. Sobre mim — Painel de apresentação (1200 x 250)
// ---------------------------------------------------------------------------

function buildAboutSvg(profile, metrics, themeName) {
  const c = THEMES[themeName];
  const W = 1200;
  const H = 250;
  const loginUpper = profile.login.toUpperCase();

  const css = `
    .about-in { animation: rise .9s cubic-bezier(0.16, 1, 0.3, 1) .12s backwards; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    ${REDUCED_MOTION}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sobre mim: Cesar Giacomino, desenvolvedor web e estudante de Desenvolvimento de Software Multiplataforma na Fatec Matão (4º semestre).">
  <style>${css}</style>
  <defs>
    <clipPath id="about-frame"><rect width="${W}" height="${H}" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#about-frame)">
    <rect width="${W}" height="${H}" fill="${c.panelBg}"/>
    ${cornerBrackets(14, 14, W - 28, H - 28, 20, c.hud, 0.85)}
    <text x="38" y="46" font-family="${MONO}" font-size="12" letter-spacing="3" fill="${c.hud}">SOBRE MIM // PERFIL</text>
    <text x="${W - 38}" y="46" text-anchor="end" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${c.muted}">${escapeXml(metrics.missionName)} · @${escapeXml(loginUpper)}</text>
    <line x1="38" y1="62" x2="${W - 38}" y2="62" stroke="${c.border}"/>

    <g class="about-in">
      <text x="38" y="100" font-family="${SANS}" font-size="22" font-weight="600" fill="${c.fg}">Cesar Giacomino</text>
      <text x="${W - 38}" y="99" text-anchor="end" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="1.8" fill="${c.diskMid}">DESENVOLVEDOR WEB &amp; FULL-STACK</text>

      <text x="38" y="132" font-family="${SANS}" font-size="14.5" fill="${c.muted}">Olá! Sou <tspan fill="${c.fg}" font-weight="600">Cesar Giacomino</tspan>, desenvolvedor web e estudante de <tspan fill="${c.hud}" font-weight="600">Desenvolvimento de Software</tspan></text>
      <text x="38" y="156" font-family="${SANS}" font-size="14.5" fill="${c.muted}"><tspan fill="${c.hud}" font-weight="600">Multiplataforma</tspan> na <tspan fill="${c.fg}" font-weight="600">Fatec Matão</tspan> (4º semestre). Construo aplicações web com <tspan fill="${c.fg}">React, Next.js,</tspan></text>
      <text x="38" y="180" font-family="${SANS}" font-size="14.5" fill="${c.muted}"><tspan fill="${c.fg}">Firebase e Supabase</tspan>, além de apps mobile com <tspan fill="${c.fg}">Flutter</tspan> — atuando em equipe na <tspan fill="${c.hud}">ecomap-devs</tspan>.</text>

      <line x1="38" y1="198" x2="${W - 38}" y2="198" stroke="${c.border}"/>
      <text x="38" y="224" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${c.hud}">FATEC MATÃO · DSM (4º SEMESTRE)   ·   ABERTO A ESTÁGIO, FREELA E OPEN SOURCE</text>
    </g>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${c.border}"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// 6. Contato — Cards clicáveis (590 x 110 cada)
// ---------------------------------------------------------------------------

const CONTACTS = [
  {
    id: "contact-linkedin",
    label: "LINKEDIN",
    value: "Cesar Giacomino",
    hint: "CONECTAR NA REDE",
    icon: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
  {
    id: "contact-email",
    label: "E-MAIL",
    value: "cesargiacomino270@gmail.com",
    hint: "ENVIAR MENSAGEM",
    icon: "M2 5.5A1.5 1.5 0 0 1 3.5 4h17A1.5 1.5 0 0 1 22 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5v-13zm2.3.5 7.7 5.5L19.7 6H4.3zm15.7 1.85-7.42 5.3a1 1 0 0 1-1.16 0L4 7.85V18h16V7.85z",
  },
];

function buildContactSvg(contact, index, themeName) {
  const c = THEMES[themeName];
  const W = 590;
  const H = 110;
  const delay = r2(0.1 + index * 0.08);

  const css = `
    .contact-in { animation: rise .8s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s backwards; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    ${REDUCED_MOTION}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(`${contact.label}: ${contact.value}`)}">
  <style>${css}</style>
  <defs>
    <clipPath id="contact-clip"><rect width="${W}" height="${H}" rx="12"/></clipPath>
  </defs>
  <g clip-path="url(#contact-clip)">
    <rect width="${W}" height="${H}" fill="${c.panelBg}"/>
    ${cornerBrackets(10, 10, W - 20, H - 20, 14, c.hud, 0.78)}
    <g class="contact-in">
      <rect x="26" y="27" width="56" height="56" rx="8" fill="${c.cardBg}" stroke="${c.border}"/>
      <path d="M72 83 H82 V73" fill="none" stroke="${c.diskMid}" stroke-width="1.3" stroke-opacity="0.85"/>
      <g transform="translate(42, 43)">
        <path fill="${c.hud}" d="${contact.icon}"/>
      </g>
      <text x="100" y="38" font-family="${MONO}" font-size="10.5" font-weight="700" letter-spacing="2" fill="${c.diskMid}">${escapeXml(contact.label)}</text>
      <text x="100" y="62" font-family="${SANS}" font-size="16" font-weight="600" fill="${c.fg}">${escapeXml(contact.value)}</text>
      <text x="100" y="82" font-family="${MONO}" font-size="10.5" letter-spacing="1.4" fill="${c.muted}">${escapeXml(contact.hint)}</text>
      <path d="M548 34 L558 24 M550 24 H558 V32" fill="none" stroke="${c.hud}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${c.border}"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// 7. Footer — Fim da transmissão / horizonte planetário (1200 x 175)
// ---------------------------------------------------------------------------

function buildFooterSvg(profile, themeName) {
  const c = THEMES[themeName];
  const W = 1200;
  const H = 175;
  const loginUpper = profile.login.toUpperCase();

  const css = `
    .horizon-glow { transform-origin: 600px 136px; animation: horizonGlow 2.4s cubic-bezier(0.16, 1, 0.3, 1) .15s backwards; }
    .end-text { animation: rise 1.3s cubic-bezier(0.16, 1, 0.3, 1) .35s backwards; }
    @keyframes horizonGlow { from { opacity: 0; transform: scale(.5, .25); } }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    ${REDUCED_MOTION}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fim da transmissão. @${escapeXml(loginUpper)}">
  <style>${css}</style>
  <defs>
    <clipPath id="foot-clip"><rect width="${W}" height="${H}" rx="14"/></clipPath>
    <radialGradient id="sunrise" cx="600" cy="136" r="430" gradientUnits="userSpaceOnUse" gradientTransform="translate(600 136) scale(1 0.32) translate(-600 -136)">
      <stop offset="0%" stop-color="${c.diskHi}" stop-opacity="${themeName === "dark" ? 0.92 : 0.32}"/>
      <stop offset="28%" stop-color="${c.diskMid}" stop-opacity="${themeName === "dark" ? 0.42 : 0.12}"/>
      <stop offset="100%" stop-color="${c.diskMid}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="limb" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c.hud}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${c.hud}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${c.hud}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <g clip-path="url(#foot-clip)">
    <rect width="${W}" height="${H}" fill="${c.panelBg}"/>
    <ellipse class="horizon-glow" cx="600" cy="136" rx="430" ry="136" fill="url(#sunrise)"/>
    <circle cx="600" cy="2535" r="2400" fill="${c.planet}"/>
    <circle cx="600" cy="2535" r="2400" fill="none" stroke="url(#limb)" stroke-width="2"/>
    <g class="end-text" text-anchor="middle">
      <text x="605" y="64" font-family="${SANS}" font-weight="300" font-size="21" letter-spacing="11" fill="${c.fg}">FIM DA TRANSMISSÃO</text>
      <text x="600" y="94" font-family="${MONO}" font-size="11" letter-spacing="2.4" fill="${c.muted}">@${escapeXml(loginUpper)} · NOS VEMOS DO OUTRO LADO DO HORIZONTE</text>
    </g>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${c.border}"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// Execução principal
// ---------------------------------------------------------------------------

const profile = await loadProfile(USER);
const metrics = computeMetrics(profile);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/hero-dark.svg`, buildHeroSvg(profile, metrics, "dark"));
writeFileSync(`${OUT}/hero-light.svg`, buildHeroSvg(profile, metrics, "light"));
writeFileSync(`${OUT}/telemetry-dark.svg`, buildTelemetrySvg(profile, metrics, "dark"));
writeFileSync(`${OUT}/telemetry-light.svg`, buildTelemetrySvg(profile, metrics, "light"));
writeFileSync(`${OUT}/about-dark.svg`, buildAboutSvg(profile, metrics, "dark"));
writeFileSync(`${OUT}/about-light.svg`, buildAboutSvg(profile, metrics, "light"));
writeFileSync(`${OUT}/tech-dark.svg`, buildTechSvg(profile, metrics, "dark"));
writeFileSync(`${OUT}/tech-light.svg`, buildTechSvg(profile, metrics, "light"));
for (const [idx, project] of PROJECTS.entries()) {
  writeFileSync(`${OUT}/${project.id}-dark.svg`, buildProjectSvg(project, idx, "dark"));
  writeFileSync(`${OUT}/${project.id}-light.svg`, buildProjectSvg(project, idx, "light"));
}
for (const [idx, contact] of CONTACTS.entries()) {
  writeFileSync(`${OUT}/${contact.id}-dark.svg`, buildContactSvg(contact, idx, "dark"));
  writeFileSync(`${OUT}/${contact.id}-light.svg`, buildContactSvg(contact, idx, "light"));
}
writeFileSync(`${OUT}/footer-dark.svg`, buildFooterSvg(profile, "dark"));
writeFileSync(`${OUT}/footer-light.svg`, buildFooterSvg(profile, "light"));

console.log({
  user: profile.login,
  source: profile.source,
  mission: metrics.missionName,
  total12m: metrics.total12m,
  activeDays: metrics.activeDays,
  longestStreak: metrics.longestStreak,
  repoCount: metrics.repoCount,
  allTimeCommits: metrics.allTimeCommits,
  topLangs: profile.languages.slice(0, 5).map((l) => l.name),
});
