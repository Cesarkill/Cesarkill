// Atualiza o "Diário de voo" (atividade pública recente) entre os marcadores do README.
import { readFileSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER || "Cesarkill";
const TOKEN = process.env.GH_TOKEN || "";
const FILE = process.argv[2] || "README.md";
const MAX = 6;
const START = "<!--LOG:START-->";
const END = "<!--LOG:END-->";

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${USER}-flight-log`,
};
if (TOKEN) {
  headers.Authorization = `bearer ${TOKEN}`;
}

const res = await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, { headers });
if (!res.ok) throw new Error(`events: ${res.status} ${await res.text()}`);
const events = await res.json();

const repo = (e) => `[${e.repo.name.replace(`${USER}/`, "")}](https://github.com/${e.repo.name})`;
const describe = (e) => {
  const p = e.payload;
  switch (e.type) {
    case "PushEvent":
      return `🛰️ Transmitiu ${p.size ? `${p.size} commit${p.size > 1 ? "s" : ""}` : "commits"} para ${repo(e)}`;
    case "CreateEvent":
      if (p.ref_type === "repository" || p.ref === p.master_branch) return `🪐 Mapeou o novo setor ${repo(e)}`;
      if (p.ref_type === "branch") return `🛸 Abriu rota \`${p.ref}\` em ${repo(e)}`;
      return null;
    case "PullRequestEvent":
      if (p.action === "opened") return `📡 Enviou módulo ([PR #${p.number}](${p.pull_request.html_url})) para ${repo(e)}`;
      if (p.action === "closed" && p.pull_request.merged) return `✅ Acoplou módulo ([PR #${p.number}](${p.pull_request.html_url})) em ${repo(e)}`;
      return null;
    case "IssuesEvent":
      if (p.action === "opened") return `📋 Registrou anomalia [#${p.issue.number}](${p.issue.html_url}) em ${repo(e)}`;
      if (p.action === "closed") return `🔧 Resolveu anomalia [#${p.issue.number}](${p.issue.html_url}) em ${repo(e)}`;
      return null;
    case "WatchEvent":
      return `⭐ Marcou coordenada em ${repo(e)}`;
    case "ForkEvent":
      return `🔀 Clonou sonda de ${repo(e)}`;
    case "ReleaseEvent":
      return p.action === "published" ? `🚀 Lançou versão \`${p.release.tag_name}\` de ${repo(e)}` : null;
    default:
      return null;
  }
};

const lines = [];
for (const e of events) {
  const text = describe(e);
  if (!text || lines.at(-1)?.text === text) continue;
  const date = new Date(e.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  lines.push({ text, md: `- \`${date}\` ${text}` });
  if (lines.length === MAX) break;
}
const body = lines.length ? lines.map((l) => l.md).join("\n") : "- 🌌 Sonda em modo de espera na órbita...";

const readme = readFileSync(FILE, "utf8");
const i = readme.indexOf(START);
const j = readme.indexOf(END);
if (i < 0 || j < i) throw new Error(`marcadores ${START} / ${END} não encontrados em ${FILE}`);
writeFileSync(FILE, `${readme.slice(0, i + START.length)}\n${body}\n${readme.slice(j)}`);
console.log(body);
