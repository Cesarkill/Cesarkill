// Escreve o "Diário de batalha" (atividade pública recente) entre os marcadores do README.
import { readFileSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER;
const TOKEN = process.env.GH_TOKEN;
const FILE = process.argv[2] || "README.md";
const MAX = 6;
const START = "<!--LOG:START-->", END = "<!--LOG:END-->";

const res = await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, {
  headers: { Authorization: `bearer ${TOKEN}`, Accept: "application/vnd.github+json" },
});
if (!res.ok) throw new Error(`events: ${res.status} ${await res.text()}`);
const events = await res.json();

const repo = (e) => `[${e.repo.name.replace(`${USER}/`, "")}](https://github.com/${e.repo.name})`;
const describe = (e) => {
  const p = e.payload;
  switch (e.type) {
    case "PushEvent": return `🗡️ Forjou ${p.size ? `${p.size} commit${p.size > 1 ? "s" : ""}` : "commits"} em ${repo(e)}`;
    case "CreateEvent":
      // o primeiro push de um repo novo cria a branch padrão: conta como fundar o repo
      if (p.ref_type === "repository" || p.ref === p.master_branch) return `🏰 Fundou o reino ${repo(e)}`;
      if (p.ref_type === "branch") return `🌿 Abriu a trilha \`${p.ref}\` em ${repo(e)}`;
      return null;
    case "PullRequestEvent":
      if (p.action === "opened") return `🛡️ Enviou reforços ([PR #${p.number}](${p.pull_request.html_url})) para ${repo(e)}`;
      if (p.action === "closed" && p.pull_request.merged) return `🏆 Venceu a batalha ([PR #${p.number}](${p.pull_request.html_url})) em ${repo(e)}`;
      return null;
    case "IssuesEvent":
      if (p.action === "opened") return `📜 Registrou a missão [#${p.issue.number}](${p.issue.html_url}) em ${repo(e)}`;
      if (p.action === "closed") return `✅ Concluiu a missão [#${p.issue.number}](${p.issue.html_url}) em ${repo(e)}`;
      return null;
    case "WatchEvent": return `⭐ Prestou homenagem a ${repo(e)}`;
    case "ForkEvent": return `⚔️ Recrutou uma cópia de ${repo(e)}`;
    case "ReleaseEvent": return p.action === "published" ? `👑 Coroou a versão \`${p.release.tag_name}\` de ${repo(e)}` : null;
    default: return null;
  }
};

const lines = [];
for (const e of events) {
  const text = describe(e);
  // vários pushes seguidos no mesmo repo viram uma linha só
  if (!text || lines.at(-1)?.text === text) continue;
  const date = new Date(e.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  lines.push({ text, md: `- \`${date}\` ${text}` });
  if (lines.length === MAX) break;
}
const body = lines.length ? lines.map((l) => l.md).join("\n") : "- 💤 O cavaleiro está descansando na taverna...";

const readme = readFileSync(FILE, "utf8");
const i = readme.indexOf(START), j = readme.indexOf(END);
if (i < 0 || j < i) throw new Error(`marcadores ${START} / ${END} não encontrados em ${FILE}`);
writeFileSync(FILE, `${readme.slice(0, i + START.length)}\n${body}\n${readme.slice(j)}`);
console.log(body);
