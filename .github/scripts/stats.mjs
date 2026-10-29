// Gera os cards de stats e linguagens (tema dracula) usando a API GraphQL do GitHub.
import { mkdirSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER;
const TOKEN = process.env.GH_TOKEN;
const OUT = process.argv[2] || "dist";

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const base = await gql(
  `query($login: String!) {
    user(login: $login) {
      name createdAt
      pullRequests { totalCount }
      issues { totalCount }
      repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]) { totalCount }
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }`,
  { login: USER }
);
const u = base.user;

// commits de todos os anos (contributionsCollection cobre no máximo 1 ano por consulta)
let commits = 0;
const now = new Date();
for (let y = new Date(u.createdAt).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
  const from = new Date(Date.UTC(y, 0, 1)).toISOString();
  const to = new Date(Math.min(Date.UTC(y + 1, 0, 1) - 1, now.getTime())).toISOString();
  const d = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) { totalCommitContributions restrictedContributionsCount }
      }
    }`,
    { login: USER, from, to }
  );
  const c = d.user.contributionsCollection;
  commits += c.totalCommitContributions + c.restrictedContributionsCount;
}

const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
// atributos da ficha: [ícone, sigla, nome, valor, valor que enche a barra]
const attrs = [
  ["commit", "FOR", "Commits", commits, 1000],
  ["pr", "INT", "Pull Requests", u.pullRequests.totalCount, 100],
  ["issue", "SAB", "Issues", u.issues.totalCount, 50],
  ["repo", "DES", "Contribuições", u.repositoriesContributedTo.totalCount, 30],
  ["star", "CAR", "Estrelas", stars, 100],
];

// XP vira nível numa curva quadrática: nível n exige XP_STEP * (n-1)² de XP
const XP_STEP = 15;
const xp = commits * 1 + u.pullRequests.totalCount * 4 + u.issues.totalCount * 2 + stars * 6;
const level = Math.floor(Math.sqrt(xp / XP_STEP)) + 1;
const xpFloor = XP_STEP * (level - 1) ** 2, xpNext = XP_STEP * level ** 2;
const pct = ((xp - xpFloor) / (xpNext - xpFloor)) * 100;

// linguagens geradas automaticamente pelo Flutter (pastas windows/linux/ios/android)
const IGNORE = new Set(["CMake", "C++", "C", "Swift", "Kotlin", "Objective-C", "Ruby"]);
const langs = {};
for (const r of u.repositories.nodes)
  for (const e of r.languages.edges.filter((e) => !IGNORE.has(e.node.name))) {
    langs[e.node.name] ??= { size: 0, color: e.node.color || "#8be9fd" };
    langs[e.node.name].size += e.size;
  }
const top = Object.entries(langs).sort((a, b) => b[1].size - a[1].size).slice(0, 8);
const total = top.reduce((s, [, l]) => s + l.size, 0);

// a classe do personagem vem da linguagem mais usada
const CLASSES = {
  JavaScript: "Paladino Web", TypeScript: "Paladino Web", Dart: "Mago Mobile",
  "C#": "Cavaleiro .NET", PHP: "Clérigo PHP", HTML: "Bardo Front-End", CSS: "Bardo Front-End",
  Python: "Alquimista Python", Java: "Guardião Java",
};
const heroClass = CLASSES[top[0]?.[0]] || "Aventureiro";

const C = { bg: "#282a36", title: "#ff79c6", text: "#f8f8f2", icon: "#79dafa", ring: "#ff79c6", attr: "#bd93f9", bar: "#50fa7b", muted: "#6272a4" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const icons = {
  star: "M8 .25l2.3 4.7 5.2.75-3.75 3.65.9 5.15L8 12.07 3.35 14.5l.9-5.15L.5 5.7l5.2-.75z",
  commit: "M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM0 7h4.5v2H0zm11.5 0H16v2h-4.5z",
  pr: "M4 1a2 2 0 0 1 1 3.73v6.54A2 2 0 1 1 3 11.27V4.73A2 2 0 0 1 4 1zm8 10.27V7a2 2 0 0 0-2-2H8.5V3L5.5 5.5 8.5 8V6H10a1 1 0 0 1 1 1v4.27A2 2 0 1 0 12 11.27z",
  issue: "M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 2a5 5 0 1 0 0 10A5 5 0 0 0 8 3zm0 3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  repo: "M2 2.5A2.5 2.5 0 0 1 4.5 0H14v13H4.5a1 1 0 0 0 0 2H14v1H4.5A2.5 2.5 0 0 1 2 13.5zM4.5 11H12V2H4.5a.5.5 0 0 0-.5.5v8.55c.16-.03.33-.05.5-.05z",
};
const font = "font-family=\"'Segoe UI', Ubuntu, Sans-Serif\"";

// barra em escala log, senão os primeiros commits nem aparecem
const fill = (v, max) => Math.min(1, Math.log10(v + 1) / Math.log10(max + 1));
const BAR = 130;
const r = 40, circ = 2 * Math.PI * r;
const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="467" height="195" viewBox="0 0 467 195" ${font}>
  <style>
    .row { animation: fade .6s ease-in-out backwards; }
    @keyframes fade { from { opacity: 0; } }
    @keyframes ring { from { stroke-dashoffset: ${circ}; } }
    @keyframes grow { from { transform: scaleX(0); } }
    .fill { transform-box: fill-box; animation: grow .8s ease-out backwards; }
  </style>
  <rect width="467" height="195" rx="6" fill="${C.bg}"/>
  <text x="25" y="32" fill="${C.title}" font-size="18" font-weight="600">⚔ ${esc(u.name || USER)}</text>
  <text x="25" y="50" fill="${C.icon}" font-size="12" font-weight="600">${heroClass} · Nível ${level}</text>
  ${attrs.map(([ic, abbr, label, val, max], i) => `
  <g class="row" style="animation-delay:${150 + i * 150}ms" transform="translate(25, ${80 + i * 23})">
    <svg x="0" y="-12" width="14" height="14" viewBox="0 0 16 16"><path fill="${C.icon}" d="${icons[ic]}"/></svg>
    <text x="20" y="0" fill="${C.attr}" font-size="12" font-weight="800">${abbr}</text>
    <text x="52" y="0" fill="${C.text}" font-size="12">${label}</text>
    <rect x="145" y="-9" width="${BAR}" height="8" rx="4" fill="${C.muted}" fill-opacity=".35"/>
    <rect class="fill" style="animation-delay:${300 + i * 150}ms" x="145" y="-9" width="${Math.max(4, BAR * fill(val, max)).toFixed(1)}" height="8" rx="4" fill="${C.bar}"/>
    <text x="${145 + BAR + 10}" y="0" fill="${C.text}" font-size="12" font-weight="700">${val}</text>
  </g>`).join("")}
  <g transform="translate(395, 88)">
    <circle r="${r}" fill="none" stroke="${C.ring}" stroke-opacity=".2" stroke-width="6"/>
    <circle r="${r}" fill="none" stroke="${C.ring}" stroke-width="6" stroke-linecap="round"
      transform="rotate(-90)" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct / 100)}"
      style="animation: ring 1s ease-out"/>
    <text y="-8" text-anchor="middle" fill="${C.muted}" font-size="11" font-weight="700">NÍVEL</text>
    <text y="18" text-anchor="middle" fill="${C.text}" font-size="26" font-weight="800">${level}</text>
    <text y="${r + 24}" text-anchor="middle" fill="${C.muted}" font-size="11">XP ${xp} / ${xpNext}</text>
  </g>
</svg>`;

const rows = Math.ceil(top.length / 2);
const langH = 90 + rows * 22;
let x = 25;
const bar = top.map(([, l]) => {
  const w = (l.size / total) * 300;
  const s = `<rect x="${x}" y="0" width="${w}" height="8" fill="${l.color}"/>`;
  x += w;
  return s;
}).join("");
const langSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="${langH}" viewBox="0 0 350 ${langH}" ${font}>
  <rect width="350" height="${langH}" rx="6" fill="${C.bg}"/>
  <text x="25" y="36" fill="${C.title}" font-size="18" font-weight="600">Most Used Languages</text>
  <clipPath id="b"><rect x="25" y="0" width="300" height="8" rx="4"/></clipPath>
  <g transform="translate(0, 55)" clip-path="url(#b)">${bar}</g>
  ${top.map(([name, l], i) => `
  <g transform="translate(${25 + (i % 2) * 150}, ${92 + Math.floor(i / 2) * 22})">
    <circle cx="5" cy="-4" r="5" fill="${l.color}"/>
    <text x="16" y="0" fill="${C.text}" font-size="11" font-weight="400">${esc(name)} ${((l.size / total) * 100).toFixed(2)}%</text>
  </g>`).join("")}
</svg>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stats.svg`, statsSvg);
writeFileSync(`${OUT}/top-langs.svg`, langSvg);
console.log({ stars, commits, xp, level, heroClass, langs: top.map(([n]) => n) });
