// A TELA do Loreforge — e, desde a spec 044, SÓ a tela.
//
// Ela mostra a cena e recebe o sussurro. NÃO PENSA: nenhuma chamada a modelo sai
// daqui, e nenhuma credencial é guardada aqui. Quem interpreta, propõe ao mundo e
// narra é O CONECTOR, que roda na máquina de quem joga — e é por isso que ninguém
// mais precisa colar a própria chave num site de terceiro.
//
// Duas conversas, e só duas:
//   · com o MUNDO  — leitura da cena, do inventário, das memórias (GET)
//   · com o CONECTOR — o sussurro sobe, os beats e a prosa descem (SSE)

// Endereço do server do mundo. Vazio = mesma origem (quando o client é servido
// pelo próprio server). Ao distribuir o client standalone, defina no ⚙ o endereço
// do seu server (ex.: http://192.168.0.10:8777). Fica só no navegador.
function serverBase() {
  try {
    return (localStorage.getItem("loreforge.serverBase") || "").replace(/\/$/, "");
  } catch (_) {
    return "";
  }
}

// Endereço do CONECTOR — o processo que roda A Mente na máquina de quem joga.
// Endereço local de propósito: ele guarda a credencial do modelo e não tem por
// que estar visível na rede de ninguém.
function conectorBase() {
  try {
    return (localStorage.getItem("loreforge.conectorBase")
            || "http://127.0.0.1:8899").replace(/\/$/, "");
  } catch (_) {
    return "http://127.0.0.1:8899";
  }
}

async function conectorPost(caminho, corpo) {
  const headers = { "Content-Type": "application/json" };
  const jwt = getJwt();
  if (jwt) headers["Authorization"] = "Bearer " + jwt;
  const res = await fetch(conectorBase() + caminho, {
    method: "POST",
    headers,
    body: JSON.stringify(corpo || {}),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.erro || `o conector respondeu ${res.status}`);
  }
  return res.json();
}

const el = {
  select: document.getElementById("character-select"),
  scene: document.getElementById("scene"),
  log: document.getElementById("log"),
  form: document.getElementById("act-form"),
  input: document.getElementById("act-input"),
  downBanner: document.getElementById("down-banner"),
  selfCard: document.getElementById("self-card"),
  tree: document.getElementById("tree"),
  memories: document.getElementById("memories"),
  detail: document.getElementById("detail"),
  settings: document.getElementById("settings"),
  settingsToggle: document.getElementById("settings-toggle"),
  settingsSave: document.getElementById("settings-save"),
  serverBase: document.getElementById("server-base"),
  // spec 044: os campos de modelo/chave SAÍRAM da tela. Configurar modelo passa
  // a ser assunto do conector — deixar o formulário aqui manteria a credencial
  // exatamente no lugar que esta spec existe para esvaziar.
  conectorBase: document.getElementById("conector-base"),
  testToggle: document.getElementById("test-toggle"),
  testConns: document.getElementById("test-conns"),
  dotServer: document.getElementById("dot-server"),
  dotMente: document.getElementById("dot-mente"),
  statusServer: document.getElementById("status-server"),
  statusMente: document.getElementById("status-mente"),
  runtimeBanner: document.getElementById("runtime-banner"),
  runtimeMsg: document.getElementById("runtime-msg"),
  runtimeConfig: document.getElementById("runtime-config"),
};

let currentCharacter = null;
let currentSelfName = null; // nome diegético do personagem atual (para "X: observa Y")

// Sessão por personagem: histórico (entries) e estado de ocupado (busy) são de CADA
// personagem, não globais. A tela (log, lock, cena) reflete sempre o personagem atual.
// O histórico de cada personagem sobrevive ao recarregar a página: fica no
// localStorage, por personagem. É TRANSCRIÇÃO, não estado de mundo — o mundo pode
// ter andado desde então (chegadas acontecem sozinhas). Por isso o histórico
// restaurado entra marcado, e nada aqui é lido de volta como verdade: quem diz o
// que é o mundo continua sendo o server, a cada consulta.
const LOG_PREFIX = "loreforge.log.";
const LOG_MAX_ENTRIES = 300;   // localStorage é pequeno; guarda o passado recente

function logKey(id) {
  return LOG_PREFIX + id;
}

function loadEntries(id) {
  try {
    const raw = localStorage.getItem(logKey(id));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.text === "string");
  } catch (_) {
    return []; // storage indisponível ou conteúdo corrompido: começa limpo
  }
}

function saveEntries(id) {
  try {
    const entries = sessions[id] ? sessions[id].entries.slice(-LOG_MAX_ENTRIES) : [];
    localStorage.setItem(logKey(id), JSON.stringify(entries));
  } catch (_) {
    // cota estourada ou storage bloqueado: o jogo segue, só não lembra
  }
}

// Compara o mundo ANTES da ação com o mundo DEPOIS da ação
function gerarDiffTextual(ctxVelho, ctxNovo) {
  const eventos = [];
  
  if (!ctxVelho || !ctxNovo) return eventos;

  // 1. Quem chegou e quem saiu
  const charsVelhos = (ctxVelho.characters_present || []).map(c => c.name);
  const charsNovos = (ctxNovo.characters_present || []).map(c => c.name);
  
  const chegaram = charsNovos.filter(n => !charsVelhos.includes(n));
  const sairam = charsVelhos.filter(v => !charsNovos.includes(v));
  
  chegaram.forEach(c => eventos.push(`${c} chegou ao local.`));
  sairam.forEach(c => eventos.push(`${c} saiu do local.`));

  // 2. Itens que apareceram ou sumiram do chão
  const itensVelhos = (ctxVelho.items_present || []).map(i => i.name);
  const itensNovos = (ctxNovo.items_present || []).map(i => i.name);

  const cairam = itensNovos.filter(n => !itensVelhos.includes(n));
  const sumiram = itensVelhos.filter(v => !itensNovos.includes(v));

  cairam.forEach(i => eventos.push(`Um(a) ${i} apareceu no chão.`));
  sumiram.forEach(i => eventos.push(`Um(a) ${i} sumiu do chão.`));

  return eventos;
}

const sessions = {};
function session(id) {
  if (!sessions[id]) {
    const anteriores = loadEntries(id);
    if (anteriores.length) {
      anteriores.push({
        kind: "system",
        text: "— daqui em diante, esta sessão —",
      });
    }
    // spec 044: `autoPaused`/`autoRemainingMs` sairam daqui junto com o relogio
    // da autonomia, que agora e do conector. O que sobra e de tela: o historico,
    // o "ocupado" e o estado de caido, todos por personagem.
    sessions[id] = {
      entries: anteriores, busy: false, down: null, wasInTransit: undefined,
    };
  }
  return sessions[id];
}

function getJwt() {
  return localStorage.getItem('loreforge.jwt');
}

function setJwt(token) {
  localStorage.setItem('loreforge.jwt', token);
}

function clearJwt() {
  localStorage.removeItem('loreforge.jwt');
}

async function api(path) {
  const headers = {};
  const jwt = getJwt();
  if (jwt) headers["Authorization"] = "Bearer " + jwt;
  
  const res = await fetch(serverBase() + path, { headers });
  if (res.status === 401) {
    if (typeof showLogin === "function") showLogin();
    throw new Error("Não autorizado");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "erro na requisição");
  }
  return res.json();
}

async function apiPost(path, body) {
  const headers = { "Content-Type": "application/json" };
  const jwt = getJwt();
  if (jwt) headers["Authorization"] = "Bearer " + jwt;
  
  const res = await fetch(serverBase() + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    if (typeof showLogin === "function") showLogin();
    throw new Error("Não autorizado");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "erro na requisição");
  }
  return res.json();
}

// spec 022: /api/act responde em STREAM NDJSON (uma linha JSON por evento, viva).
// Consome com fetch + ReadableStream (nativo), ignora heartbeat, e devolve o
// desfecho do evento `done`. `onBeat` recebe op_applied/failed (narração por beats,
// Fase 2). A conexão pode cair no meio: sem `done`, quem chama re-sincroniza do mundo.
// `origem` (spec 026, FR-015): "manual" | "autonoma" — SÓ para observabilidade
// (devlog do servidor). O Árbitro nunca lê isto; não é sinal funcional.
async function postActStream(actor, intent, onBeat, origem, plano) {
  const res = await fetch(serverBase() + "/api/act", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // fatia C (item 38): `plano` (ações-do-livro ordenadas + narrativa) é
    // TELEMETRIA — modo sombra, o server só loga; nunca desce à arbitragem.
    body: JSON.stringify({ character_id: actor, intent, origem,
                           plano: plano || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "erro na requisição");
  }
  // MODO NÃO-STREAMADO (server.stream = false): a resposta é um JSON único = o
  // outcome. Detecta pelo Content-Type e trata como se fosse o evento `done`.
  const ctype = res.headers.get("Content-Type") || "";
  if (!ctype.includes("x-ndjson")) {
    const outcome = await res.json().catch(() => ({}));
    return { outcome, rejected: null, sawDone: true };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let outcome = null, rejected = null, sawDone = false;
  const handle = (ev) => {
    if (!ev || !ev.ev) return;
    if (ev.ev === "done") { outcome = ev.outcome || {}; sawDone = true; }
    else if (ev.ev === "rejected") { rejected = ev; }
    else if (ev.ev === "op_applied" || ev.ev === "failed") { if (onBeat) onBeat(ev); }
    // turn_start / heartbeat: sinal de vida — nada a fazer aqui
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { handle(JSON.parse(line)); } catch (_) { /* linha parcial/ruído */ }
    }
  }
  return { outcome, rejected, sawDone };
}

// --------------------------------------------------------------------------- //
// Render
// --------------------------------------------------------------------------- //

// Botão de observar (tool consultiva do server): 👁 ao lado de cada entidade
// percebida. Clique dispara /api/observe — leitura pura, sem gastar o turno.
function obsBtnHtml(id, name) {
  if (!id) return "";
  return (
    ` <button class="observe-btn" title="Observar" type="button"` +
    ` data-oid="${escapeAttr(id)}" data-oname="${escapeAttr(name || id)}">👁</button>`
  );
}

function obsBtnEl(id, name) {
  const b = document.createElement("button");
  b.className = "observe-btn";
  b.type = "button";
  b.title = "Observar";
  b.textContent = "👁";
  b.addEventListener("click", (e) => {
    e.stopPropagation(); // não seleciona o nó ao lado
    observeEntity(id, name);
  });
  return b;
}

async function observeEntity(id, name) {
  const actor = currentCharacter;
  if (!actor || !id) return;
  const who = currentSelfName || "Você";
  appendLog(actor, "you", `${who}: observa ${name || id}`);
  // Reconhecer (spec 018) é NARRADO — o que se vê tecido com a vivência. Narrar
  // é trabalho da Mente, e a Mente não mora mais aqui: o pedido vai ao conector,
  // e a prosa volta pelo canal como qualquer outra.
  try {
    const obs = await api(
      `/api/observe?character_id=${encodeURIComponent(actor)}&id=${encodeURIComponent(id)}`
    );
    try {
      await conectorPost("/observar", { observacao: obs });
    } catch (_) {
      // sem conector, o olhar não fica mudo: mostra o que o mundo mesmo diz.
      // É menos do que a Mente teceria, e é honesto — não inventa vivência.
      const texto = (obs.description || "").trim() ||
        `${obs.name || name} não revela nada além do que se vê.`;
      appendLog(actor, "narration", texto);
    }
  } catch (e) {
    appendLog(actor, "system", `Algo interrompeu o olhar: ${e.message}`);
  }
}

// spec 035: `location.pertence_a` é uma ESTRUTURA aninhada (o nível mais
// próximo primeiro, cada um apontando de novo pra `pertence_a` de quem o
// contém — mesma chave em cada nível, é a MESMA relação repetida) — não uma
// lista. Achata pra exibir a trilha "região > cidade > lugar", na ordem de
// leitura de fora pra dentro (o oposto da ordem de aninhamento).
function flattenLineage(node) {
  const chain = [];
  while (node) {
    chain.push(node.name || node.id);
    node = node.pertence_a;
  }
  return chain.reverse();
}

function renderScene(context) {
  const loc = context.location || {};
  // Trilha da hierarquia de location (spec 035: região > cidade > lugar > quarto)
  // — só orientação, sem obsBtnHtml para não poluir a trilha de olhos.
  const breadcrumbChain = flattenLineage(loc.pertence_a);
  const breadcrumbHtml = breadcrumbChain.length
    ? `<div class="breadcrumb">${breadcrumbChain
        .map((n) => escapeHtml(n))
        .join('<span class="crumb-sep">\u203a</span>')}</div>`
    : "";
  const others = (context.characters_present || []).filter(
    (c) => c.state !== "self"
  );
  const presentHtml = others.length
    ? `<div class="present-label">Também aqui</div><ul class="present-list">${others
        .map(
          (c) =>
            `<li>${escapeHtml(c.name)}${
              c.action ? ` <span class="meta">\u2014 ${escapeHtml(c.action)}</span>` : ""
            }${obsBtnHtml(c.id, c.name)}</li>`
        )
        .join("")}</ul>`
    : `<div class="present-empty">Você está sozinho aqui.</div>`;
  // Objects presentes na cena (spec 002, US3) — mesma lista, categoria própria.
  const objects = context.objects_present || [];
  const objectsHtml = objects.length
    ? `<div class="present-label">Há também</div><ul class="objects-list">${objects
        .map((o) => `<li>${escapeHtml(o.name)}${obsBtnHtml(o.id, o.name)}</li>`)
        .join("")}</ul>`
    : "";
  const items = context.items_present || [];
  const itemsHtml = items.length
    ? `<div class="present-label">No chão</div><ul class="items-list">${items
        .map((it) => `<li>${escapeHtml(it.name)}${obsBtnHtml(it.id, it.name)}</li>`)
        .join("")}</ul>`
    : "";
  const routes = context.routes || [];
  // O que ele SABE de caminhos não vem no contexto (memória de rota é maquinaria
  // de viagem e não desce ao client): o mapa se pede à parte, e por isso é botão.
  const mapaBtn =
    ` <button class="map-btn" type="button" title="O que sei dos caminhos">` +
    `\u25c6 caminhos que conheço</button>`;
  let exitsHtml = "";
  if (context.in_transit) {
    exitsHtml = `<div class="exits-empty">Você está a caminho.${mapaBtn}</div>`;
  } else if (routes.length) {
    exitsHtml =
      `<div class="present-label">Daqui partem caminhos</div>` +
      `<ul class="exits-list">${routes
        .map(
          (r) =>
            `<li>${escapeHtml(r.destination_name)} ` +
            `<span class="meta">(${escapeHtml(r.name)})</span>${obsBtnHtml(r.id, r.name)}</li>`
        )
        .join("")}</ul>` +
      `<div class="exits-foot">${mapaBtn}</div>`;
  } else {
    exitsHtml = `<div class="exits-empty">Nenhum caminho parte daqui.${mapaBtn}</div>`;
  }
  el.scene.innerHTML =
    breadcrumbHtml +
    `<h3>${escapeHtml(loc.name || "Lugar desconhecido")}${obsBtnHtml(loc.id, loc.name)}</h3>` +
    `<div class="loc-narrative">${escapeHtml(loc.narrative || "")}</div>` +
    presentHtml +
    objectsHtml +
    itemsHtml +
    exitsHtml;
}

// "Você" tem painel próprio (RF-034 raiz da árvore = o personagem). Continua
// clicável, como qualquer outro nó, para abrir o detalhe dele.
function renderSelf(inventory) {
  el.selfCard.innerHTML = "";
  const card = document.createElement("div");
  card.className = "self-node";
  card.textContent = inventory.name || inventory.id;
  card.dataset.id = inventory.id;
  card.addEventListener("click", () => selectNode(card, inventory.id));
  card.appendChild(obsBtnEl(inventory.id, inventory.name || inventory.id));
  el.selfCard.appendChild(card);
}

// "Pertences": só os filhos da raiz (os itens), separados de "Você" — mesmo
// padrão de seção isolada que já existe para Memórias.
function renderTree(inventory) {
  el.tree.innerHTML = "";
  const children = inventory.children || [];
  if (!children.length) {
    const li = document.createElement("li");
    li.className = "mem-empty";
    li.textContent = "Você não carrega nada.";
    el.tree.appendChild(li);
    return;
  }
  children.forEach((child) => el.tree.appendChild(buildNode(child)));
}

// Rótulo diegético do acoplamento ao corpo (spec 004): onde o pertence está
// vestido/segurado. Itens aninhados (guardados) já aparecem recuados na árvore.
const SLOT_LABELS = {
  mao: "na mão", cabeca: "na cabeça", rosto: "no rosto", pescoco: "ao pescoço",
  torso: "no torso", costas: "às costas", bracos: "nos braços",
  dedo: "no dedo", cintura: "à cintura", pernas: "vestindo", pes: "calçando",
};

function buildNode(node) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.className = "node item";
  span.textContent = node.name || node.id;
  span.dataset.id = node.id;
  span.addEventListener("click", () => selectNode(span, node.id));
  if (node.slot && SLOT_LABELS[node.slot]) {
    const tag = document.createElement("em");
    tag.className = "slot-tag";
    tag.textContent = SLOT_LABELS[node.slot];
    span.appendChild(tag);
  }
  if (node.fechado) {
    const lockTag = document.createElement("em");
    lockTag.className = "slot-tag";
    lockTag.textContent = "(fechado)";
    span.appendChild(lockTag);
  }
  span.appendChild(obsBtnEl(node.id, node.name || node.id));
  li.appendChild(span);
  if (node.children && node.children.length) {
    const ul = document.createElement("ul");
    node.children.forEach((child) => ul.appendChild(buildNode(child)));
    li.appendChild(ul);
  }
  return li;
}

function clearSelection() {
  document
    .querySelectorAll(".node.selected, .mem-node.selected, .self-node.selected")
    .forEach((n) => n.classList.remove("selected"));
}

async function selectNode(span, id) {
  clearSelection();
  span.classList.add("selected");
  try {
    const detail = await api(`/api/entity?id=${encodeURIComponent(id)}`);
    renderDetail(detail);
  } catch (e) {
    el.detail.innerHTML = `<p class="detail-empty">${escapeHtml(e.message)}</p>`;
  }
}

// Memórias na lateral: seção própria, ordem cronológica (as expiradas o server nem
// devolve). Cada linha mostra o resumo (summary); clicar abre o conteúdo no detalhe,
// como um item. Os dados já vêm no contexto — não precisa de outra chamada ao server.
function renderMemories(memories) {
  const list = (memories || [])
    .slice()
    .sort((a, b) => (a.timestamp_start || 0) - (b.timestamp_start || 0)); // cronológica
  el.memories.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "mem-empty";
    li.textContent = "Nenhuma lembrança viva.";
    el.memories.appendChild(li);
    return;
  }
  list.forEach((mem) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "mem-node";
    span.textContent = mem.summary || "(lembrança)";
    span.title = mem.recency || "";
    span.addEventListener("click", () => selectMemory(span, mem));
    li.appendChild(span);
    // QUANDO foi. A lista é cronológica, mas sem a data era preciso contar
    // linhas para saber a ordem — e "há dias", repetido em quinze lembranças
    // seguidas, não distingue nenhuma delas.
    const quando = document.createElement("span");
    quando.className = "mem-quando";
    quando.textContent = dataDaMemoria(mem);
    li.appendChild(quando);
    li.appendChild(buildMemoryBar(mem));
    el.memories.appendChild(li);
  });
}

// "12/08 08:14 · há pouco" — a data absoluta ancora, a relativa que o mundo já
// manda dá o peso. Hoje é omitido: no dia de hoje só a hora importa, e repetir a
// data em toda linha da sessão atual só faz ruído.
function dataDaMemoria(mem) {
  const t = Number(mem.timestamp_start);
  const rec = mem.recency || "";
  if (!t) return rec;
  const d = new Date(t * 1000);
  const dois = (n) => String(n).padStart(2, "0");
  const hora = `${dois(d.getHours())}:${dois(d.getMinutes())}`;
  const hoje = new Date();
  const mesmoDia = d.getFullYear() === hoje.getFullYear()
                   && d.getMonth() === hoje.getMonth()
                   && d.getDate() === hoje.getDate();
  const quando = mesmoDia ? hora
                          : `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${hora}`;
  return rec ? `${quando} · ${rec}` : quando;
}

// Barra de frescor: cheia = acabou de acontecer, vazia = prestes a expirar.
// Calculada localmente a partir da janela timestamp_start..timestamp_end que o
// server já manda (o mesmo prazo que decide quando a memória some do contexto).
function buildMemoryBar(mem) {
  const bar = document.createElement("div");
  bar.className = "mem-bar";
  const fill = document.createElement("div");
  fill.className = "mem-bar-fill";
  fill.style.width = `${memoryFreshness(mem) * 100}%`;
  bar.appendChild(fill);
  return bar;
}

function memoryFreshness(mem) {
  const start = mem.timestamp_start;
  const end = mem.timestamp_end;
  if (!start || !end || end <= start) return 1;
  const now = Date.now() / 1000;
  const frac = 1 - (now - start) / (end - start);
  return Math.max(0, Math.min(1, frac));
}

function selectMemory(span, mem) {
  clearSelection();
  span.classList.add("selected");
  renderMemoryDetail(mem);
}

function renderMemoryDetail(mem) {
  let html = `<span class="kind">Memória · ${escapeHtml(mem.recency || "")}</span>`;
  html += `<h3>${escapeHtml(mem.summary || "Lembrança")}</h3>`;
  html += `<p>${escapeHtml(mem.content || "")}</p>`;
  el.detail.innerHTML = html;
}

function renderDetail(d) {
  let html = `<span class="kind">${escapeHtml(d.kind || "")}</span>`;
  html += `<h3>${escapeHtml(d.name || "")}</h3>`;
  html += `<p>${escapeHtml(d.description || "")}</p>`;
  if (d.status || d.attributes) {
    html += "<dl>";
    if (d.status && d.status.action) html += `<dt>Agora</dt><dd>${escapeHtml(d.status.action)}</dd>`;
    if (d.status && d.status.mood) html += `<dt>Humor</dt><dd>${escapeHtml(d.status.mood)}</dd>`;
    html += "</dl>";
  }
  el.detail.innerHTML = html;
}

// Anexa ao histórico do personagem `charId`. Só desenha na tela se ele for o atual —
// assim a narração de uma ação que terminou depois de você trocar vai para o log do
// dono, não para a tela do personagem que você está vendo agora.
function appendLog(charId, kind, text, badge) {
  const s = session(charId);
  s.entries.push({ kind, text, badge: badge || null });
  if (s.entries.length > LOG_MAX_ENTRIES) {
    s.entries.splice(0, s.entries.length - LOG_MAX_ENTRIES);
  }
  saveEntries(charId);
  if (charId === currentCharacter) renderLogEntry(kind, text, badge);
}

// Desenha o mapa que o personagem traz na cabeça como árvore textual. O mundo
// devolve só o que ELE lembra — dois personagens no mesmo lugar veem árvores
// diferentes, e é isso que faz o mapa ser dele e não do cenário.
function mapaEmArvore(mapa) {
  const linhas = [];
  const raiz = mapa.raiz_nome || "algum lugar";
  linhas.push(mapa.em_transito ? `${raiz} (para onde vai)` : `${raiz} (onde está)`);

  function ramo(ns, prefixo) {
    ns.forEach((n, i) => {
      const ultimo = i === ns.length - 1;
      const vago = n.certeza === "vago" ? "  — de memória vaga" : "";
      linhas.push(
        `${prefixo}${ultimo ? "└─ " : "├─ "}${n.route_name} → ${n.destination_name}${vago}`
      );
      if (n.ramos && n.ramos.length) {
        ramo(n.ramos, prefixo + (ultimo ? "   " : "│  "));
      }
    });
  }
  ramo(mapa.ramos || [], "");
  return linhas.join("\n");
}

async function showKnownRoutes() {
  const actor = currentCharacter;
  if (!actor) return;
  const who = currentSelfName || "Você";
  appendLog(actor, "you", `${who}: recorda os caminhos que conhece`);
  try {
    const mapa = await api(
      `/api/known_routes?character_id=${encodeURIComponent(actor)}`
    );
    if (!mapa.ramos || !mapa.ramos.length) {
      appendLog(
        actor, "narration",
        mapa.total
          ? "Você conhece caminhos, mas nenhum deles parte daqui."
          : "Nenhum caminho lhe vem à cabeça. Você ainda não andou o bastante."
      );
      return;
    }
    appendLog(actor, "map", mapaEmArvore(mapa));
  } catch (e) {
    appendLog(actor, "system", `A memória falhou: ${e.message}`);
  }
}

function renderLogEntry(kind, text, badge) {
  const entry = document.createElement("div");
  entry.className = "entry";
  // spec 043: o marcador de "consultou as regras" saiu junto com o livro de
  // regras. Ele era um sinal FALSO - vinha de uma funcao `async`, entao era uma
  // Promise, entao era sempre truthy: o selo aparecia em TODO turno. `badge`
  // fica no lugar para quem quiser marcar outra coisa depois.
  const mark = "";
  entry.innerHTML = `${mark}<span class="${kind}">${escapeHtml(text)}</span>`;
  el.log.appendChild(entry);
  el.log.scrollTop = el.log.scrollHeight;
}

function renderLog(charId) {
  el.log.innerHTML = "";
  for (const e of session(charId).entries) renderLogEntry(e.kind, e.text, e.badge);
}

// spec 043: uma entrada de log que CRESCE — a narração aparece palavra a palavra
// conforme A Mente a gera, em vez de um vazio até o fim. Só existe na tela; o log
// persistido (`appendLog`) recebe o texto final UMA vez, no `fim()`.
//
// Se o personagem em foco mudar no meio, a escrita continua no dono correto: o
// `charId` é fixado aqui, e o DOM só é tocado enquanto ele estiver em foco.
function abrirEntradaViva(charId, kind) {
  let texto = "";
  let span = null;
  if (charId === currentCharacter) {
    const entry = document.createElement("div");
    entry.className = "entry";
    span = document.createElement("span");
    span.className = kind;
    entry.appendChild(span);
    el.log.appendChild(entry);
  }
  return {
    escrever(pedaco) {
      texto += pedaco;
      if (span && charId === currentCharacter) {
        span.textContent = texto;
        el.log.scrollTop = el.log.scrollHeight;
      }
    },
    // Troca o rascunho vivo pela entrada de verdade (persistida, com o texto
    // aparado). Sem isto a prosa some ao trocar de personagem e voltar.
    fim(textoFinal) {
      if (span) span.parentElement.remove();
      appendLog(charId, kind, textoFinal);
    },
    // Só apaga o rascunho — para quem vai escrever a versão final por outro
    // caminho (a intenção passa por `appendIntent`, que monta a fala junto).
    descartar() {
      if (span) span.parentElement.remove();
    },
  };
}

// Mostra a ação que o personagem decidiu tomar (a intenção interpretada por
// A Mente), evidenciando o filtro de personalidade entre o sussurro e o resultado.
// Casa o "movement" que A Mente propôs com uma rota real da cena. Aceita id, nome da
// rota ou nome do destino (modelos pequenos erram o formato) e canoniza para o id.
// Sem correspondência -> movement = null (o Árbitro resolve como ação comum).
function sanitizeMovement(intent, routes) {
  if (!intent) return;
  const mv = intent.movement;
  const wanted = mv && (mv.enter_route || mv.route || mv.destino || mv.para);
  if (!wanted) {
    intent.movement = null;
    return;
  }
  const w = String(wanted).trim().toLowerCase();
  const eq = (a) => (a || "").trim().toLowerCase() === w;
  const has = (a) => {
    const s = (a || "").trim().toLowerCase();
    return s && (s.includes(w) || w.includes(s));
  };
  const match =
    routes.find((r) => eq(r.id)) ||
    routes.find((r) => eq(r.destination_name)) ||
    routes.find((r) => eq(r.name)) ||
    routes.find((r) => has(r.destination_name)) ||
    routes.find((r) => has(r.name));
  intent.movement = match ? { enter_route: match.id } : null;
}

function appendIntent(charId, name, intent) {
  if (!intent) return;
  const who = name || "O personagem";
  const action = (intent.action || "").trim();
  let text = action ? `${who} ${action}` : `${who} age.`;
  if (intent.utterance) text += ` — diz: “${intent.utterance}”`;
  appendLog(charId, "intent", text);
}

// --------------------------------------------------------------------------- //
// Fluxo
// --------------------------------------------------------------------------- //

async function loadCharacter(id) {
  currentCharacter = id;
  renderConectorInfo();   // o aviso de "a Mente joga outro" muda com a seleção
  // A tela passa a ser deste personagem: histórico e lock são os DELE.
  renderLog(id);
  applyBusy(session(id).busy);

  const [context, inventory] = await Promise.all([
    api(`/api/context?character_id=${encodeURIComponent(id)}`),
    api(`/api/inventory?character_id=${encodeURIComponent(id)}`),
  ]);
  if (currentCharacter !== id) return; // trocou de novo durante o fetch: aborta

  setDown(id, context.self && context.self.status && context.self.status.conditions);
  currentSelfName = (context.self && context.self.name) || inventory.name || null;
  renderScene(context);
  renderSelf(inventory);
  renderTree(inventory);
  renderMemories(context.memories);
  el.detail.innerHTML = `<p class="detail-empty">Selecione algo à esquerda para ver os detalhes.</p>`;

  // spec 044: a chegada de viagem deixou de ser gatilho DESTA tela. Quem decide
  // se ha algo a fazer e a Mente, e ela vive no conector com relogio proprio -
  // inclusive quando ninguem esta com a aba aberta, que era o furo de antes.
  session(id).wasInTransit = context.in_transit;

}

// O LAÇO DO TURNO NÃO MORA MAIS AQUI (spec 044).
//
// Isto era `runWhisper` + `runPropostas`: a tela interpretava o sussurro, propunha
// as capacidades ao mundo, encadeava os atos e narrava. Tudo migrou para
// `connector/laco.js`, e a mudança não foi de arquivo — foi de DONO. Enquanto o
// laço vivia aqui, o personagem só existia enquanto uma aba estivesse aberta.
//
// O que sobrou nesta tela: mandar o sussurro e pintar o que voltar.

async function onAct(event) {
  event.preventDefault();
  const actor = currentCharacter;
  if (!actor) return;
  const text = el.input.value.trim();
  if (!text) return;

  // O conector serve UM personagem. Sussurrar olhando outro mandava a ordem para
  // a Mente errada e a resposta voltava na boca de quem estava na tela.
  if (conectorPersonagem && conectorPersonagem !== actor) {
    appendLog(actor, "system",
      `A Mente conectada joga ${nomeDe(conectorPersonagem)}, não ${nomeDe(actor)}. ` +
      `Selecione-o para agir, ou aponte o conector para este personagem.`);
    return;
  }
  if (session(actor).busy) return;   // já há turno correndo: não enfileira

  el.input.value = "";
  // TRAVA JÁ, aqui. Antes eu esperava o evento `estado` voltar do conector, e
  // entre o clique e a resposta da rede dava tempo de sussurrar de novo.
  setBusy(actor, true);
  appendLog(actor, "you", `Você sussurra: \u201c${text}\u201d`);
  try {
    // Volta na hora (202): o turno corre no conector e se conta pelo canal de
    // eventos. Esperar aqui seria uma requisicao pendurada por dezenas de
    // segundos - e foi para nao depender disso que o canal existe.
    await conectorPost("/sussurro", { texto: text });
  } catch (e) {
    // a trava local só cai aqui: se o sussurro NÃO subiu, não virá `estado`
    // nenhum para destravar, e o botão ficaria preso para sempre.
    setBusy(actor, false);
    appendLog(actor, "system",
      `A Mente não respondeu: ${e.message}. O conector está rodando?`);
    checkConector();
  }
}

// A AUTONOMIA SAIU DAQUI POR INTEIRO (spec 044).
//
// Primeiro o relógio mudou de dono — ele vivia nesta aba, o que fazia o
// personagem existir só enquanto alguém estivesse olhando. A tela ficou com a
// barra, mostrando uma contagem que já não era dela.
//
// Agora sai também a barra: um mostrador de relógio alheio é enfeite, e enfeite
// que parece controle engana. Quem conta o tempo e quem liga ou desliga o laço é
// o conector, no painel dele — que é onde o botão de fato faz alguma coisa.

// O "ocupado" é de CADA personagem. setBusy grava no dono e, se ele for o atual,
// reflete no botão/entrada. Ao trocar de personagem, applyBusy reaplica o lock do novo.
function setBusy(charId, busy) {
  session(charId).busy = busy;
  if (charId === currentCharacter) applyBusy(busy);
}

// Quem caiu não é instruído: o sussurro sai da tela e o motivo fica à vista, para
// o player não gastar um turno para descobrir. É CORTESIA — quem barra de verdade
// é o server, que recusa a ação venha ela de onde vier.
const DOWN_REASONS = {
  morto: "Está morto. Nada mais o alcança — escolha outro personagem para guiar.",
  incapacitado:
    "Caiu, e não tem forças para agir. Só outra pessoa pode tirá-lo daí — " +
    "escolha outro personagem para guiar.",
};

function setDown(charId, conditions) {
  const conds = conditions || [];
  const estado = conds.includes("morto")
    ? "morto"
    : conds.includes("incapacitado")
      ? "incapacitado"
      : null;
  session(charId).down = estado;
  if (charId === currentCharacter) applyBusy(session(charId).busy);
}

function applyBusy(busy) {
  const down = currentCharacter ? session(currentCharacter).down : null;
  const bloqueado = busy || Boolean(down);
  el.input.disabled = bloqueado;
  el.form.querySelector("button").disabled = bloqueado;
  el.input.placeholder = down
    ? "Este personagem não age mais."
    : busy
      ? "O personagem está agindo…"
      : "O que você faz? (linguagem natural)";
  if (down) {
    el.downBanner.textContent = DOWN_REASONS[down];
    el.downBanner.hidden = false;
  } else {
    el.downBanner.hidden = true;
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// AS CONFIGURACOES DE MODELO SAIRAM DA TELA (spec 044).
//
// Aqui havia runtime, endpoint, modelo e DUAS CHAVES DE API. Sair nao foi
// arrumacao: enquanto o formulario existisse, a credencial continuaria morando
// numa pagina servida por terceiro - que e exatamente a coisa que a cisao existe
// para desfazer. Quem configura modelo agora e o conector, na maquina de quem
// joga (`loreforge --configurar`).
//
// Sobraram dois enderecos, e nenhum e segredo: o do MUNDO e o do CONECTOR.

function initSettings() {
  try {
    el.serverBase.value = localStorage.getItem("loreforge.serverBase") || "";
    if (el.conectorBase) {
      el.conectorBase.value = localStorage.getItem("loreforge.conectorBase") || "";
    }
  } catch (_) { /* storage bloqueado: segue com o padrao */ }

  el.settingsToggle.addEventListener("click", () => {
    el.settings.hidden = !el.settings.hidden;
    if (!el.settings.hidden) testConnections();
  });
  el.testToggle.addEventListener("click", () => {
    el.settings.hidden = false;
    testConnections();
  });
  el.testConns.addEventListener("click", testConnections);

  el.settingsSave.addEventListener("click", () => {
    try {
      localStorage.setItem("loreforge.serverBase", el.serverBase.value.trim());
      if (el.conectorBase) {
        localStorage.setItem("loreforge.conectorBase",
                             el.conectorBase.value.trim());
      }
    } catch (_) { /* ignora se o navegador bloquear storage */ }
    // NAO esconde o painel: quem acabou de mudar um endereco quer VER se pegou.
    loadWorld();
    ligarAoConector();
    testConnections();
  });
}

// Sem conector nao ha Mente - e a tela precisa DIZER isso, nao adivinhar. Ela
// continua util em leitura: o mundo esta la, so nao ha quem aja nele.
async function checkConector() {
  try {
    const res = await fetch(conectorBase() + "/estado");
    if (!res.ok) throw new Error(`respondeu ${res.status}`);
    const e = await res.json();
    el.runtimeBanner.hidden = true;
    conectorPersonagem = e.personagem || null;
    renderConectorInfo();
    const bom = { ok: true,
                  reason: `${nomeDe(e.personagem)} · ${e.turnos} turnos` };
    setDot(el.dotMente, el.statusMente, bom);
    return bom;
  } catch (e) {
    el.runtimeMsg.textContent =
      "Nenhuma Mente conectada. O conector roda na SUA maquina, com o SEU modelo " +
      "e a SUA chave - a tela sozinha mostra o mundo, mas ninguem age nele. " +
      `Tentei em ${conectorBase()}.`;
    el.runtimeBanner.hidden = false;
    const ruim = { ok: false, reason: e.message };
    setDot(el.dotMente, el.statusMente, ruim);
    return ruim;
  }
}

// O CANAL: o conector empurra beats e prosa, a tela pinta. Reconecta sozinho -
// fechar o conector e reabrir nao pode obrigar a recarregar a pagina.
let _fonte = null;
let _vivaNarracao = null;
let _vivaIntencao = null;
// QUEM o conector joga. Um conector serve UM personagem — a tela deixa você
// PASSEAR por todos, e essa diferença precisa estar visível, não implícita.
let conectorPersonagem = null;
let _ultimaChecagem = 0;

// O nome de exibição de um personagem, tirado da própria lista já carregada.
function nomeDe(id) {
  if (!id) return "O personagem";
  const op = [...(el.select.options || [])].find((o) => o.value === id);
  return (op && op.textContent) || id;
}

// Diz, na cara do jogador, quem a Mente conectada está jogando — e avisa quando
// ele está olhando outro. Sem isso, sussurrar parecia funcionar e a resposta
// aparecia noutro lugar.
function renderConectorInfo() {
  const fora = conectorPersonagem && currentCharacter
               && conectorPersonagem !== currentCharacter;
  if (el.input) {
    el.input.disabled = !!fora;
    el.input.placeholder = fora
      ? `A Mente conectada joga ${nomeDe(conectorPersonagem)} — selecione-o para agir`
      : "O que ele faz?";
  }
  if (el.statusMente && conectorPersonagem) {
    el.statusMente.title = `o conector joga ${nomeDe(conectorPersonagem)}`;
  }
}

function ligarAoConector() {
  if (_fonte) { try { _fonte.close(); } catch (_) {} }
  checkConector();
  try {
    // `EventSource` nativo não manda headers — o JWT viaja na query (spec 056,
    // FR-023), e só vai se existir (mundo sem login: nada muda).
    const jwt = getJwt();
    const url = conectorBase() + "/eventos" +
      (jwt ? "?token=" + encodeURIComponent(jwt) : "");
    _fonte = new EventSource(url);
  } catch (_) {
    return;
  }
  // O DONO DO EVENTO VEM NO EVENTO. Antes eu pintava em `currentCharacter`, o que
  // fazia a resposta de um sussurro aparecer na boca de quem você tivesse
  // selecionado no meio do turno — e escondia por completo o que o personagem do
  // conector fazia sozinho enquanto você olhava outro.
  //
  // `appendLog` já guarda por personagem e só desenha se for o da tela: passando
  // o dono certo, o log do Coppo continua crescendo enquanto você vê a Nerissa, e
  // está lá quando você voltar.
  const dono = (d) => d.personagem || conectorPersonagem || currentCharacter;

  const ouvir = (nome, fn) => _fonte.addEventListener(nome, (ev) => {
    let d = {};
    try { d = JSON.parse(ev.data); } catch (_) {}
    fn(d, dono(d));
  });

  ouvir("beat", (d, quem) => appendLog(quem, "beat", d.texto));
  ouvir("recusa", (d, quem) => appendLog(quem, "beat", d.texto));
  ouvir("decidiu", (d, quem) =>
    appendLog(quem, "you", `Ele decidiu agir: \u201c${d.texto}\u201d`));
  ouvir("sistema", (d, quem) => appendLog(quem, "system", d.texto));
  ouvir("erro", (d, quem) => appendLog(quem, "system", d.texto));

  // O RASCUNHO DA AÇÃO, palavra a palavra. Isto tinha se perdido na cisão: o
  // conector emitia e a tela não escutava. É a parte que mais deixava a tela muda
  // — a primeira chamada do turno é longa, e ver a frase nascer é o que tira a
  // sensação de travamento.
  ouvir("intencao_inicio", (d, quem) => {
    _vivaIntencao = abrirEntradaViva(quem, "intent");
    _vivaIntencao.escrever(nomeDe(quem) + " ");
  });
  ouvir("intencao", (d) => {
    if (_vivaIntencao) _vivaIntencao.escrever(d.pedaco || "");
  });
  ouvir("intencao_fim", () => {
    // o rascunho SEMPRE sai: meia frase na tela seria pior que o silêncio.
    if (_vivaIntencao) _vivaIntencao.descartar();
    _vivaIntencao = null;
  });

  ouvir("narracao_inicio", (d, quem) => {
    _vivaNarracao = abrirEntradaViva(quem, "narration");
  });
  ouvir("narracao", (d) => {
    if (_vivaNarracao) _vivaNarracao.escrever(d.pedaco || "");
  });
  ouvir("narracao_fim", (d, quem) => {
    if (_vivaNarracao) {
      if (d.texto) _vivaNarracao.fim(d.texto);
      else _vivaNarracao.descartar();
      _vivaNarracao = null;
    }
    if (quem === currentCharacter) loadCharacter(quem);   // o mundo mudou: releia
  });

  ouvir("estado", (d, quem) => {
    if (d.personagem) conectorPersonagem = d.personagem;
    setBusy(quem, !!d.ocupado);
    renderConectorInfo();
  });
  // O `EventSource` re-tenta sozinho, em laço, quando não alcança. Cada erro
  // disparando um `fetch` virava enxurrada de requisições e engasgava a
  // interface inteira — que foi o "travando" relatado. Uma checagem a cada 5s
  // basta para contar a verdade.
  _fonte.onerror = () => {
    const agora = Date.now();
    if (agora - _ultimaChecagem < 5000) return;
    _ultimaChecagem = agora;
    checkConector();
  };
  _fonte.onopen = () => {
    el.runtimeBanner.hidden = true;
    setDot(el.dotMente, el.statusMente, { ok: true, reason: "canal aberto" });
  };
}

// Duas bolinhas, e nenhuma delas e um modelo: o MUNDO e o CONECTOR.
function setDot(dotEl, statusEl, res) {
  if (!dotEl) return;
  dotEl.className = "dot " + (res.ok ? "ok" : "bad");
  statusEl.textContent = res.reason || (res.ok ? "ok" : "falhou");
}
async function serverCheck() {
  try {
    const list = await api("/api/characters");
    const n = Array.isArray(list) ? list.length : ((list && list.characters) || []).length;
    return { ok: true, reason: `${n} personagens` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
async function testConnections() {
  for (const d of [el.dotServer, el.dotMente]) if (d) d.className = "dot checking";
  el.statusServer.textContent = el.statusMente.textContent = "testando...";
  const [srv, con] = await Promise.all([
    serverCheck(),
    checkConector().catch((e) => ({ ok: false, reason: e.message })),
  ]);
  setDot(el.dotServer, el.statusServer, srv);
  setDot(el.dotMente, el.statusMente, con);
}

const elModal = {
  login: document.getElementById("login-screen"),
  select: document.getElementById("select-screen"),
  myChars: document.getElementById("my-characters"),
  availChars: document.getElementById("available-characters"),
  logoutBtn: document.getElementById("logout-btn"),
  pairingKey: document.getElementById("pairing-key"),
  btnPair: document.getElementById("btn-pair"),
  pairStatus: document.getElementById("pair-status"),
};

function showLogin() {
  if (!elModal.login) return;
  elModal.login.hidden = false;
  elModal.select.hidden = true;
  document.querySelector(".layout").hidden = true;
  
  api("/api/auth/config").then(cfg => {
    if (cfg.google_client_id && window.google) {
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: handleGoogleCredential
      });
      window.google.accounts.id.renderButton(
        document.getElementById("g_id_signin"),
        { theme: "outline", size: "large" }
      );
    } else if (!cfg.google_client_id) {
       showGame();
    }
  }).catch(() => showGame());
}

function handleGoogleCredential(response) {
  apiPost("/api/auth/login", { id_token: response.credential })
    .then(data => {
      setJwt(data.jwt);
      showSelection();
    }).catch(e => alert(e.message));
}

// `image_url` é opcional no frontmatter do personagem (character.md) — sem ela,
// o card fica só com nome/local, igual antes. `onerror` remove a tag em vez de
// deixar o ícone quebrado do navegador se a URL cair.
function charImgHtml(c) {
  if (!c.image_url) return "";
  // Relativa (retrato servido pelo próprio server, ex.: /api/character/image)
  // resolve contra o serverBase() do client — absoluta (http.../https...) vai
  // como veio.
  const src = /^https?:\/\//i.test(c.image_url)
    ? c.image_url : serverBase() + c.image_url;
  return `<img class="char-avatar" src="${escapeHtml(src)}" alt="" onerror="this.remove()">`;
}

function showSelection() {
  elModal.login.hidden = true;
  elModal.select.hidden = false;
  document.querySelector(".layout").hidden = true;
  
  Promise.all([
    api("/api/characters/mine"),
    api("/api/characters/available")
  ]).then(([mine, avail]) => {
    elModal.myChars.innerHTML = "";
    mine.forEach(c => {
      const d = document.createElement("div");
      d.className = "char-card";
      d.innerHTML = `${charImgHtml(c)}<h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.location || "Mundo")}</p>
        <button onclick="playCharacter('${c.id}')">Jogar</button>
        <button onclick="apiPost('/api/auth/release-character', {character_id: '${c.id}'}).then(showSelection)">Desassociar</button>`;
      elModal.myChars.appendChild(d);
    });

    elModal.availChars.innerHTML = "";
    avail.forEach(c => {
      const d = document.createElement("div");
      d.className = "char-card";
      d.innerHTML = `${charImgHtml(c)}<h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.location || "Mundo")}</p>
        <button onclick="apiPost('/api/auth/claim-character', {character_id: '${c.id}'}).then(showSelection)">Associar</button>`;
      elModal.availChars.appendChild(d);
    });
  }).catch(e => alert(e.message));
}

window.playCharacter = function(id) {
  elModal.select.hidden = true;
  document.querySelector(".layout").hidden = false;
  el.select.innerHTML = `<option value="${id}">${id}</option>`;
  loadCharacter(id);
};

function showGame() {
  if (elModal.login) elModal.login.hidden = true;
  if (elModal.select) elModal.select.hidden = true;
  document.querySelector(".layout").hidden = false;
  loadWorld();
}

async function loadWorld() {
  try {
    api("/api/world/health").then((h) => {
      if (h && !h.ok) console.warn("Loreforge — arquivos inválidos:", h.problems);
    }).catch(() => {});

    const characters = await api("/api/characters");
    el.select.innerHTML = "";
    characters.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name + (c.location ? ` — ${c.location}` : "");
      el.select.appendChild(opt);
    });
    if (characters.length) await loadCharacter(characters[0].id);
  } catch (e) {
    el.scene.innerHTML = `<p class="detail-empty">Não foi possível falar com o server: ${escapeHtml(e.message)}</p>`;
  }
}

function init() {
  el.form.addEventListener("submit", onAct);
  el.select.addEventListener("change", () => loadCharacter(el.select.value));
  el.scene.addEventListener("click", (e) => {
    const b = e.target.closest(".observe-btn");
    if (b) return observeEntity(b.dataset.oid, b.dataset.oname);
    if (e.target.closest(".map-btn")) showKnownRoutes();
  });
  el.runtimeConfig.addEventListener("click", () => el.settings.hidden = false);
  
  if (elModal.logoutBtn) elModal.logoutBtn.addEventListener("click", () => {
    clearJwt();
    showLogin();
  });
  
  // O pareamento (spec 056) é direto client→conector: o código só existe na
  // memória do PRÓPRIO conector (gerado por `--parear` ou pelo painel dele), e
  // é ele quem confere o JWT com o mundo — o loreforge-server nunca entra
  // nesse meio, então isto NÃO passa por `apiPost`/`serverBase()`.
  if (elModal.btnPair) elModal.btnPair.addEventListener("click", () => {
    const codigo = elModal.pairingKey.value.trim();
    if (!codigo) return;
    const jwt = getJwt();
    if (!jwt) {
      elModal.pairStatus.textContent = "Faça login antes de parear.";
      return;
    }
    elModal.pairStatus.textContent = "Pareando...";
    conectorPost("/parear", { codigo, jwt })
      .then(res => {
        elModal.pairStatus.textContent = `Pareado como ${res.email}! O conector está vinculado.`;
      })
      .catch(e => {
        elModal.pairStatus.textContent = "Erro: " + e.message;
      });
  });

  initSettings();
  ligarAoConector();

  api("/api/auth/config").then(cfg => {
    if (cfg.google_client_id) {
      if (getJwt()) showSelection();
      else showLogin();
    } else {
      showGame();
    }
  }).catch(() => showGame());
}

init();
