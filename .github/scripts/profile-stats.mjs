// Genera tarjetas SVG de estadísticas para el perfil de GitHub.
// Sin dependencias: requiere Node 20+ (fetch nativo).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const LOGIN = process.env.GH_LOGIN;
const TOKEN = process.env.GH_TOKEN;
const OUT = process.env.OUT_DIR || 'profile';
const MOCK = process.env.MOCK_FILE; // solo para pruebas locales

const QUERY = `query($login: String!) {
  user(login: $login) {
    name login
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC,
                 orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function getData() {
  if (MOCK) return JSON.parse(readFileSync(MOCK, 'utf8'));
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (json.errors || !json.data?.user) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);

const C = { bg: '#0D1117', card: '#161B22', border: '#30363D', text: '#E6EDF3', muted: '#8B949E', blue: '#36BCF7', red: '#E4715F' };

const STYLE = `<style>
  .t { font: 700 18px 'Segoe UI', Helvetica, Arial, sans-serif; fill: ${C.text}; }
  .l { font: 500 13px 'Segoe UI', Helvetica, Arial, sans-serif; fill: ${C.muted}; }
  .v { font: 700 22px 'Segoe UI', Helvetica, Arial, sans-serif; fill: ${C.text}; }
  .s { font: 600 12px 'Segoe UI', Helvetica, Arial, sans-serif; fill: ${C.text}; }
  .in { animation: in .8s ease-out both; }
  @keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
</style>`;

const frame = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0078D4"/><stop offset="1" stop-color="#C74634"/></linearGradient></defs>
${STYLE}
<clipPath id="card"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12"/></clipPath>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.card}"/>
<rect x="0" y="0" width="${w}" height="5" fill="url(#g)" clip-path="url(#card)"/>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="none" stroke="${C.border}"/>
<text x="24" y="40" class="t">${esc(title)}</text>
${body}
</svg>`;

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0, i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--; // hoy aún puede estar en 0
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;
  return { current, longest };
}

function statsCard(u, days) {
  const stars = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);
  const cal = u.contributionsCollection.contributionCalendar;
  const { current, longest } = streaks(days);
  const items = [
    ['⭐', 'Estrellas', stars], ['📦', 'Repos públicos', u.repositories.totalCount],
    ['🔨', 'Commits (último año)', u.contributionsCollection.totalCommitContributions], ['🔀', 'Pull requests', u.pullRequests.totalCount],
    ['📅', 'Contribuciones (año)', cal.totalContributions], ['🐞', 'Issues', u.issues.totalCount],
    ['🔥', 'Racha actual (días)', current], ['🏆', 'Racha más larga', longest],
  ];
  const body = items.map(([ico, label, val], k) => {
    const col = k % 2, row = Math.floor(k / 2);
    const x = 24 + col * 236, y = 72 + row * 50;
    return `<g transform="translate(${x},${y})"><g class="in" style="animation-delay:${k * 0.08}s">
  <text x="0" y="24" font-size="20">${ico}</text>
  <text x="32" y="6" class="l">${esc(label)}</text>
  <text x="32" y="32" class="v">${fmt(val)}</text></g></g>`;
  }).join('\n');
  const name = u.name || u.login;
  return frame(495, 280, `Estadísticas de ${name}`, body);
}

function langsCard(u) {
  const map = new Map();
  for (const r of u.repositories.nodes) for (const e of r.languages.edges) {
    const cur = map.get(e.node.name) || { size: 0, color: e.node.color || '#8B949E' };
    cur.size += e.size; map.set(e.node.name, cur);
  }
  const top = [...map.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8);
  const total = top.reduce((a, [, v]) => a + v.size, 0);
  if (!total) return frame(495, 280, 'Lenguajes más usados', `<text x="24" y="90" class="l">Aún no hay código en repositorios públicos.</text>`);
  let x = 24; const W = 447;
  const bar = top.map(([, v], k) => {
    const w = Math.max((v.size / total) * W, 2);
    const seg = `<rect x="${x.toFixed(1)}" y="62" width="${w.toFixed(1)}" height="10" fill="${v.color}"/>`;
    x += w; return seg;
  }).join('');
  const legend = top.map(([name, v], k) => {
    const col = k % 2, row = Math.floor(k / 2);
    const lx = 24 + col * 236, ly = 108 + row * 36;
    return `<g class="in" style="animation-delay:${k * 0.08}s"><circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${v.color}"/>
  <text x="${lx + 20}" y="${ly}" class="s">${esc(name)}</text>
  <text x="${lx + 200}" y="${ly}" class="l" text-anchor="end">${((v.size / total) * 100).toFixed(1)}%</text></g>`;
  }).join('\n');
  return frame(495, 280, 'Lenguajes más usados', `<clipPath id="r"><rect x="24" y="62" width="${W}" height="10" rx="5"/></clipPath><g clip-path="url(#r)">${bar}</g>\n${legend}`);
}

function activityCard(days) {
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7).reduce((a, d) => a + d.contributionCount, 0));
  const W = 1000, H = 260, pl = 50, pr = 24, pt = 70, pb = 40;
  const iw = W - pl - pr, ih = H - pt - pb;
  const max = Math.max(4, ...weeks);
  const step = weeks.length > 1 ? iw / (weeks.length - 1) : iw;
  const pts = weeks.map((v, i) => [pl + i * step, pt + ih - (v / max) * ih]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${(pl + iw).toFixed(1)} ${pt + ih} L${pl} ${pt + ih} Z`;
  const grid = [0, 0.5, 1].map((f) => {
    const y = pt + ih - f * ih;
    return `<line x1="${pl}" x2="${pl + iw}" y1="${y}" y2="${y}" stroke="${C.border}" stroke-dasharray="3 4"/>
<text x="${pl - 10}" y="${y + 4}" class="l" text-anchor="end">${Math.round(max * f)}</text>`;
  }).join('\n');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  let last = -1; const labels = [];
  for (let i = 0; i < weeks.length; i++) {
    const m = new Date(days[i * 7].date + 'T00:00:00Z').getUTCMonth();
    if (m !== last && i > 0) labels.push(`<text x="${(pl + i * step).toFixed(1)}" y="${H - 14}" class="l" text-anchor="middle">${meses[m]}</text>`);
    last = m;
  }
  const len = 4000;
  const body = `<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.blue}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></linearGradient></defs>
<style>.ln { stroke-dasharray: ${len}; stroke-dashoffset: ${len}; animation: draw 2.5s ease-out forwards; } @keyframes draw { to { stroke-dashoffset: 0; } }</style>
${grid}
<path d="${area}" fill="url(#a)" class="in"/>
<path d="${line}" fill="none" stroke="${C.blue}" stroke-width="2.5" stroke-linejoin="round" class="ln"/>
${labels.join('\n')}`;
  return frame(W, H, 'Actividad semanal · últimos 12 meses', body);
}

const u = await getData();
const days = u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stats.svg`, statsCard(u, days));
writeFileSync(`${OUT}/languages.svg`, langsCard(u));
writeFileSync(`${OUT}/activity.svg`, activityCard(days));
console.log(`Tarjetas generadas en ${OUT}/ para ${u.login}`);
