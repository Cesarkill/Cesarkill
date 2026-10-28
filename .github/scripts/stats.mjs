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
const stats = [
  ["star", "Total Stars", stars],
  ["commit", "Total Commits", commits],
  ["pr", "Total PRs", u.pullRequests.totalCount],
  ["issue", "Total Issues", u.issues.totalCount],
  ["repo", "Contributed to", u.repositoriesContributedTo.totalCount],
];

const score = commits * 1 + u.pullRequests.totalCount * 4 + u.issues.totalCount * 2 + stars * 6;
const [grade, pct] =
  score >= 1500 ? ["S", 100] : score >= 600 ? ["A++", 90] : score >= 300 ? ["A+", 78] :
  score >= 150 ? ["A", 65] : score >= 60 ? ["B+", 50] : ["B", 35];

const langs = {};
for (const r of u.repositories.nodes)
  for (const e of r.languages.edges) {
    langs[e.node.name] ??= { size: 0, color: e.node.color || "#8be9fd" };
    langs[e.node.name].size += e.size;
  }
const top = Object.entries(langs).sort((a, b) => b[1].size - a[1].size).slice(0, 8);
const total = top.reduce((s, [, l]) => s + l.size, 0);

const C = { bg: "#282a36", title: "#ff79c6", text: "#f8f8f2", icon: "#79dafa", ring: "#ff79c6" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const icons = {
  star: "M8 .25l2.3 4.7 5.2.75-3.75 3.65.9 5.15L8 12.07 3.35 14.5l.9-5.15L.5 5.7l5.2-.75z",
  commit: "M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM0 7h4.5v2H0zm11.5 0H16v2h-4.5z",
  pr: "M4 1a2 2 0 0 1 1 3.73v6.54A2 2 0 1 1 3 11.27V4.73A2 2 0 0 1 4 1zm8 10.27V7a2 2 0 0 0-2-2H8.5V3L5.5 5.5 8.5 8V6H10a1 1 0 0 1 1 1v4.27A2 2 0 1 0 12 11.27z",
  issue: "M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 2a5 5 0 1 0 0 10A5 5 0 0 0 8 3zm0 3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  repo: "M2 2.5A2.5 2.5 0 0 1 4.5 0H14v13H4.5a1 1 0 0 0 0 2H14v1H4.5A2.5 2.5 0 0 1 2 13.5zM4.5 11H12V2H4.5a.5.5 0 0 0-.5.5v8.55c.16-.03.33-.05.5-.05z",
};
const font = "font-family=\"'Segoe UI', Ubuntu, Sans-Serif\"";

const r = 40, circ = 2 * Math.PI * r;
const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="467" height="195" viewBox="0 0 467 195" ${font}>
  <style>
    .row { opacity: 0; animation: fade .6s ease-in-out forwards; }
    @keyframes fade { to { opacity: 1; } }
    @keyframes ring { from { stroke-dashoffset: ${circ}; } }
  </style>
  <rect width="467" height="195" rx="6" fill="${C.bg}"/>
  <text x="25" y="36" fill="${C.title}" font-size="18" font-weight="600">${esc(u.name || USER)}'s GitHub Stats</text>
  ${stats.map(([ic, label, val], i) => `
  <g class="row" style="animation-delay:${150 + i * 150}ms" transform="translate(25, ${62 + i * 25})">
    <svg x="0" y="-12" width="16" height="16" viewBox="0 0 16 16"><path fill="${C.icon}" d="${icons[ic]}"/></svg>
    <text x="25" y="0" fill="${C.text}" font-size="14" font-weight="600">${label}:</text>
    <text x="190" y="0" fill="${C.text}" font-size="14" font-weight="700">${val}</text>
  </g>`).join("")}
  <g transform="translate(375, 98)">
    <circle r="${r}" fill="none" stroke="${C.ring}" stroke-opacity=".2" stroke-width="6"/>
    <circle r="${r}" fill="none" stroke="${C.ring}" stroke-width="6" stroke-linecap="round"
      transform="rotate(-90)" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct / 100)}"
      style="animation: ring 1s ease-out"/>
    <text y="8" text-anchor="middle" fill="${C.text}" font-size="24" font-weight="800">${grade}</text>
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
console.log({ stars, commits, grade, langs: top.map(([n]) => n) });
