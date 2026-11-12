// Automação de DMs do Instagram (substitui o ManyChat) — API oficial da Meta.
// Com painel em /painel. Sem dependências externas: só Node.js 20+.

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const APP_SECRET = process.env.APP_SECRET || "";
const PAINEL_SENHA = process.env.PAINEL_SENHA || "";
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const DATA_DIR = process.env.DATA_DIR || "/data";

fs.mkdirSync(DATA_DIR, { recursive: true });
const ARQ_AUTOMACOES = path.join(DATA_DIR, "automacoes.json");
const ARQ_CONTATOS = path.join(DATA_DIR, "contatos.json");
const ARQ_LOG = path.join(DATA_DIR, "eventos.log");

// ---------- dados ----------

// Automações: na primeira vez vêm do config.js; depois o painel salva em /data/automacoes.json
function lerJson(arq, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arq, "utf8"));
  } catch {
    return padrao;
  }
}
let contas = lerJson(ARQ_AUTOMACOES, null) || require("./config");

// Formato: contas[contaId] = { nome, automacoes: [ { id, nome, ativo, direto, gatilhos, mensagem1, mensagem2, etiqueta, respostaComentario } ] }
// Converte o formato antigo (uma automação por perfil) sem perder nada.
for (const [id, c] of Object.entries(contas)) {
  if (!Array.isArray(c.automacoes)) {
    const { nome, ...resto } = c;
    contas[id] = { nome, automacoes: [{ id: "a1", nome: "Principal", ...resto }] };
  }
}
function acharAutomacao(contaId, autoId) {
  const c = contas[contaId];
  if (!c) return null;
  return c.automacoes.find((a) => a.id === autoId) || (autoId ? null : c.automacoes[0]) || null;
}
function salvarAutomacoes() {
  fs.writeFileSync(ARQ_AUTOMACOES, JSON.stringify(contas, null, 2));
}

// Contatos: uma entrada por pessoa em cada perfil
let contatos = lerJson(ARQ_CONTATOS, {});
let salvarTimer = null;
function salvarContatos() {
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(() => fs.writeFile(ARQ_CONTATOS, JSON.stringify(contatos), () => {}), 1000);
}
function registrar(contaId, autoId, usuarioId, etapa, extra = {}) {
  if (!usuarioId) return;
  const chave = `${contaId}:${usuarioId}`;
  const agora = new Date().toISOString();
  const ct = (contatos[chave] ||= { conta: contaId, id: usuarioId, primeiro: agora, etapas: {}, etiquetas: [] });
  ct.ultimo = agora;
  if (extra.username) ct.username = extra.username;
  if (extra.nome) ct.nome = extra.nome;
  if (extra.origem && !ct.origem) ct.origem = extra.origem;
  ct.etapas[etapa] = (ct.etapas[etapa] || 0) + 1;
  ct.autos ||= {};
  const pa = (ct.autos[autoId] ||= {});
  pa[etapa] = (pa[etapa] || 0) + 1;
  if (extra.etiqueta && !ct.etiquetas.includes(extra.etiqueta)) ct.etiquetas.push(extra.etiqueta);
  salvarContatos();
}

// ---------- utilidades ----------

function log(...args) {
  const linha = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(linha);
  fs.appendFile(ARQ_LOG, linha + "\n", () => {});
}

function tokenDe(contaId) {
  return (process.env[`TOKEN_${contaId}`] || "").trim().replace(/^["']|["']$/g, "");
}

// Tokens do login do Instagram começam com IG → graph.instagram.com; os demais (EAA…) → graph.facebook.com
function apiDe(token) {
  return token.startsWith("IG") ? "https://graph.instagram.com/v23.0" : "https://graph.facebook.com/v23.0";
}

function normalizar(txt) {
  return (txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// a palavra-chave precisa aparecer como palavra inteira ("comente" não dispara "mente")
function temPalavra(texto, palavras) {
  const t = ` ${normalizar(texto)} `;
  return (palavras || []).some((p) => p && t.includes(` ${normalizar(p)} `));
}

const vistos = new Map();
function jaVisto(id) {
  if (!id) return false;
  const agora = Date.now();
  for (const [k, t] of vistos) if (agora - t > 24 * 3600e3) vistos.delete(k);
  if (vistos.has(id)) return true;
  vistos.set(id, agora);
  return false;
}

async function chamarApi(contaId, caminho, { method = "GET", body } = {}) {
  const token = tokenDe(contaId);
  if (!token) throw new Error(`sem TOKEN_${contaId}`);
  const res = await fetch(`${apiDe(token)}${caminho}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function perfil(contaId, usuarioId) {
  try {
    const p = await chamarApi(contaId, `/${usuarioId}?fields=name,username`);
    return { nome: (p.name || "").trim().split(/\s+/)[0], username: p.username };
  } catch {
    return {};
  }
}

function montarTexto(modelo, nome) {
  return (modelo || "").replace(" {nome}", nome ? ` ${nome}` : "").replace("{nome}", nome || "");
}

// ---------- envio das mensagens ----------

async function enviarMensagem1(contaId, a, destinatario, nome) {
  return chamarApi(contaId, `/${contaId}/messages`, {
    method: "POST",
    body: {
      recipient: destinatario,
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: montarTexto(a.mensagem1.texto, nome),
            buttons: [{ type: "postback", title: a.mensagem1.botao, payload: `PASSO_2:${contaId}:${a.id}` }],
          },
        },
      },
    },
  });
}

async function enviarMensagem2(contaId, a, usuarioId, destinatario, nome) {
  const link = BASE_URL && usuarioId ? `${BASE_URL}/r/${contaId}/${a.id}/${usuarioId}` : a.mensagem2.link;
  return chamarApi(contaId, `/${contaId}/messages`, {
    method: "POST",
    body: {
      recipient: destinatario || { id: usuarioId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: montarTexto(a.mensagem2.texto, nome),
            buttons: [{ type: "web_url", title: a.mensagem2.botao, url: link }],
          },
        },
      },
    },
  });
}

// ---------- tratamento dos eventos da Meta ----------

async function tratarComentario(contaId, valor) {
  const c = contas[contaId];
  const autor = valor.from || {};
  if (!c || autor.id === contaId) return;
  const a = c.automacoes.find((x) => x.ativo !== false && temPalavra(valor.text, x.gatilhos.comentario));
  if (!a) return;
  if (jaVisto(`c:${valor.id}`)) return;
  log(`[${c.nome} · ${a.nome}] comentário de @${autor.username || autor.id}: "${valor.text}"`);
  registrar(contaId, a.id, autor.id, "gatilho", { username: autor.username, origem: "comentário" });
  if (a.direto) await enviarMensagem2(contaId, a, autor.id, { comment_id: valor.id });
  else await enviarMensagem1(contaId, a, { comment_id: valor.id }, "");
  log(`[${c.nome} · ${a.nome}] mensagem 1 enviada (comentário ${valor.id})`);
  const frases = (a.respostaComentario || []).filter(Boolean);
  if (!frases.length) return;
  try {
    const frase = frases[Math.floor(Math.random() * frases.length)];
    await chamarApi(contaId, `/${valor.id}/replies`, { method: "POST", body: { message: frase } });
    log(`[${c.nome}] respondeu o comentário ${valor.id}`);
  } catch (e) {
    log(`[${c.nome}] não conseguiu responder o comentário: ${e.message}`);
  }
}

async function tratarMensagem(contaId, ev) {
  const c = contas[contaId];
  if (!c) return;
  const usuarioId = ev.sender && ev.sender.id;
  if (!usuarioId || usuarioId === contaId) return;

  // clique no botão da mensagem 1 — payload "PASSO_2:<conta>:<automação>" (ou o antigo "PASSO_2:<conta>")
  if (ev.postback) {
    if (jaVisto(`p:${ev.postback.mid || usuarioId + ev.timestamp}`)) return;
    const [tipo, conta, autoId] = String(ev.postback.payload || "").split(":");
    if (tipo !== "PASSO_2" || conta !== contaId) return;
    const a = acharAutomacao(contaId, autoId);
    if (!a) return;
    log(`[${c.nome} · ${a.nome}] ${usuarioId} clicou em "${a.mensagem1.botao}"`);
    registrar(contaId, a.id, usuarioId, "botao");
    await enviarMensagem2(contaId, a, usuarioId);
    log(`[${c.nome} · ${a.nome}] mensagem 2 enviada para ${usuarioId}`);
    return;
  }

  const msg = ev.message;
  if (!msg || msg.is_echo || !msg.text) return;
  if (jaVisto(`m:${msg.mid}`)) return;

  const ehStory = !!(msg.reply_to && msg.reply_to.story);
  const a = c.automacoes.find((x) => x.ativo !== false && temPalavra(msg.text, ehStory ? x.gatilhos.story : x.gatilhos.dm));
  if (!a) {
    const lista = c.automacoes.map((x) => `${x.nome}${x.ativo === false ? " (desligada)" : ""}: [${((ehStory ? x.gatilhos.story : x.gatilhos.dm) || []).join(", ")}]`).join(" | ");
    log(`[${c.nome}] ${ehStory ? "resposta ao story" : "DM"} de ${usuarioId} sem palavra-chave: "${msg.text}" — gatilhos de ${ehStory ? "story" : "DM"}: ${lista}`);
    return;
  }

  log(`[${c.nome} · ${a.nome}] ${ehStory ? "resposta ao story" : "DM"} de ${usuarioId}: "${msg.text}"`);
  const p = await perfil(contaId, usuarioId);
  registrar(contaId, a.id, usuarioId, "gatilho", { ...p, origem: ehStory ? "story" : "DM" });
  if (a.direto) await enviarMensagem2(contaId, a, usuarioId, null, p.nome);
  else await enviarMensagem1(contaId, a, { id: usuarioId }, p.nome);
  log(`[${c.nome} · ${a.nome}] mensagem 1 enviada para ${usuarioId}`);
}

async function processarWebhook(payload) {
  for (const entry of payload.entry || []) {
    const contaId = String(entry.id);
    const tipos = [...(entry.changes || []).map((ch) => ch.field), ...(entry.messaging || []).map(() => "messaging"), ...(entry.standby || []).map(() => "standby")];
    log(`webhook recebido · conta ${contaId}${contas[contaId] ? ` (@${contas[contaId].nome})` : ""} · ${tipos.join(", ") || "vazio"}`);
    if (!contas[contaId]) {
      log(`evento de conta não configurada: ${contaId}`);
      continue;
    }
    try {
      for (const ch of entry.changes || []) {
        if (ch.field === "comments" || ch.field === "live_comments") {
          await tratarComentario(contaId, ch.value || {});
        }
      }
      for (const ev of [...(entry.messaging || []), ...(entry.standby || [])]) {
        await tratarMensagem(contaId, ev);
      }
    } catch (e) {
      log(`[${contas[contaId].nome}] ERRO: ${e.message}`);
    }
  }
}

function assinaturaValida(corpo, cabecalho) {
  if (!APP_SECRET) return true;
  if (!cabecalho || !cabecalho.startsWith("sha256=")) return false;
  const esperado = crypto.createHmac("sha256", APP_SECRET).update(corpo).digest("hex");
  const recebido = cabecalho.slice(7);
  return esperado.length === recebido.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

// ---------- painel ----------

function autorizado(req) {
  if (!PAINEL_SENHA) return false;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const senha = Buffer.from(h.slice(6), "base64").toString().split(":").slice(1).join(":");
  const a = Buffer.from(senha), b = Buffer.from(PAINEL_SENHA);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function pedirSenha(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Painel Lari", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(PAINEL_SENHA ? "Senha necessária" : "Defina PAINEL_SENHA no EasyPanel (Ambiente) para usar o painel.");
}

function lerCorpo(req) {
  return new Promise((ok, erro) => {
    const partes = [];
    req.on("data", (p) => partes.push(p));
    req.on("end", () => ok(Buffer.concat(partes)));
    req.on("error", erro);
  });
}

function json(res, status, dados) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(dados));
}

function numeros() {
  const r = {};
  const hoje = new Date().toISOString().slice(0, 10);
  for (const [id, c] of Object.entries(contas)) {
    r[id] = { hoje: 0, autos: {} };
    for (const a of c.automacoes) r[id].autos[a.id] = { gatilho: 0, botao: 0, link: 0 };
  }
  for (const ct of Object.values(contatos)) {
    const n = r[ct.conta];
    if (!n) continue;
    if ((ct.ultimo || "").startsWith(hoje)) n.hoje++;
    // contatos antigos (antes de existir mais de uma automação) contam na primeira
    const autos = ct.autos || { [contas[ct.conta].automacoes[0]?.id]: ct.etapas };
    for (const [aid, et] of Object.entries(autos)) {
      const na = n.autos[aid];
      if (!na) continue;
      if (et.gatilho) na.gatilho++;
      if (et.botao) na.botao++;
      if (et.link) na.link++;
    }
  }
  return r;
}

function limparAutomacao(a, id) {
  const lista = (v) =>
    (Array.isArray(v) ? v : String(v || "").split(","))
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 20);
  const txt = (v, max) => String(v || "").slice(0, max);
  return {
    id,
    nome: txt(a.nome, 40) || "Sem nome",
    ativo: a.ativo !== false,
    direto: !!a.direto,
    gatilhos: {
      comentario: lista(a.gatilhos && a.gatilhos.comentario),
      story: lista(a.gatilhos && a.gatilhos.story),
      dm: lista(a.gatilhos && a.gatilhos.dm),
    },
    mensagem1: { texto: txt(a.mensagem1 && a.mensagem1.texto, 640), botao: txt(a.mensagem1 && a.mensagem1.botao, 20) },
    mensagem2: {
      texto: txt(a.mensagem2 && a.mensagem2.texto, 640),
      botao: txt(a.mensagem2 && a.mensagem2.botao, 20),
      link: txt(a.mensagem2 && a.mensagem2.link, 500),
    },
    etiqueta: txt(a.etiqueta, 60),
    respostaComentario: lista(a.respostaComentario).slice(0, 10),
  };
}

function csv() {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [["perfil", "username", "nome", "origem", "comentou/mandou", "clicou botão", "clicou link", "etiquetas", "primeiro contato", "último contato"]];
  for (const ct of Object.values(contatos)) {
    linhas.push([
      contas[ct.conta] ? "@" + contas[ct.conta].nome : ct.conta,
      ct.username ? "@" + ct.username : ct.id,
      ct.nome || "",
      ct.origem || "",
      ct.etapas.gatilho ? "sim" : "",
      ct.etapas.botao ? "sim" : "",
      ct.etapas.link ? "sim" : "",
      ct.etiquetas.join(" "),
      ct.primeiro,
      ct.ultimo,
    ]);
  }
  return "﻿" + linhas.map((l) => l.map(esc).join(";")).join("\n");
}

async function rotasPainel(req, res, url) {
  if (!autorizado(req)) return pedirSenha(res);

  if (req.method === "GET" && (url.pathname === "/painel" || url.pathname === "/painel/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(fs.readFileSync(path.join(__dirname, "painel.html")));
  }
  if (req.method === "GET" && url.pathname === "/painel/api/dados") {
    const tokens = {};
    for (const id of Object.keys(contas)) tokens[id] = !!tokenDe(id);
    return json(res, 200, { contas, numeros: numeros(), contatos: Object.values(contatos), tokens });
  }
  // salvar / excluir uma automação, ou criar uma nova
  const m = url.pathname.match(/^\/painel\/api\/conta\/(\d+)\/(nova|automacao\/([\w-]+)(\/excluir)?)$/);
  if (req.method === "POST" && m && contas[m[1]]) {
    const c = contas[m[1]];
    try {
      if (m[2] === "nova") {
        const nova = limparAutomacao(
          {
            nome: "Nova automação",
            ativo: false,
            gatilhos: { comentario: [], story: [], dm: [] },
            mensagem1: { texto: "Oiee {nome} ✨\n\n", botao: "Quero sim" },
            mensagem2: { texto: "", botao: "Quero garantir", link: "https://" },
            etiqueta: "",
            respostaComentario: ["Te mandei no direct! ✨", "Corre no direct que te mandei 💌"],
          },
          "a" + crypto.randomBytes(3).toString("hex")
        );
        c.automacoes.push(nova);
        salvarAutomacoes();
        log(`[${c.nome}] nova automação criada pelo painel`);
        return json(res, 200, { ok: true, automacao: nova });
      }
      const i = c.automacoes.findIndex((a) => a.id === m[3]);
      if (i < 0) return json(res, 404, { ok: false });
      if (m[4]) {
        const [fora] = c.automacoes.splice(i, 1);
        salvarAutomacoes();
        log(`[${c.nome}] automação "${fora.nome}" excluída pelo painel`);
        return json(res, 200, { ok: true });
      }
      const dados = JSON.parse((await lerCorpo(req)).toString("utf8"));
      c.automacoes[i] = limparAutomacao(dados, m[3]);
      salvarAutomacoes();
      log(`[${c.nome}] automação "${c.automacoes[i].nome}" editada pelo painel`);
      return json(res, 200, { ok: true, automacao: c.automacoes[i] });
    } catch (e) {
      return json(res, 400, { ok: false, erro: e.message });
    }
  }
  if (req.method === "GET" && url.pathname === "/painel/api/contatos.csv") {
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="contatos.csv"',
    });
    return res.end(csv());
  }
  res.writeHead(404);
  res.end();
}

// ---------- servidor HTTP ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname.startsWith("/painel")) {
    try {
      return await rotasPainel(req, res, url);
    } catch (e) {
      log("ERRO painel:", e.message);
      return json(res, 500, { ok: false });
    }
  }

  if (req.method === "GET" && url.pathname === "/webhook") {
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      VERIFY_TOKEN &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    res.writeHead(ok ? 200 : 403);
    return res.end(ok ? url.searchParams.get("hub.challenge") : "token inválido");
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    const corpo = await lerCorpo(req);
    if (!assinaturaValida(corpo, req.headers["x-hub-signature-256"])) {
      log("webhook com assinatura inválida — ignorado");
      res.writeHead(403);
      return res.end();
    }
    res.writeHead(200);
    res.end("ok");
    let payload;
    try {
      payload = JSON.parse(corpo.toString("utf8"));
    } catch {
      return log("webhook com JSON inválido");
    }
    processarWebhook(payload).catch((e) => log("ERRO geral:", e.message));
    return;
  }

  // clique no link da mensagem 2: registra a etiqueta e redireciona para a página de venda
  // /r/<conta>/<automação>/<usuário>  (e o formato antigo /r/<conta>/<usuário>)
  const m = url.pathname.match(/^\/r\/(\d+)\/([\w-]+)(?:\/([\w-]+))?$/);
  if (req.method === "GET" && m && contas[m[1]]) {
    const autoId = m[3] ? m[2] : null;
    const usuarioId = m[3] || m[2];
    const a = acharAutomacao(m[1], autoId) || contas[m[1]].automacoes[0];
    if (!a) {
      res.writeHead(404);
      return res.end();
    }
    registrar(m[1], a.id, usuarioId, "link", { etiqueta: a.etiqueta });
    log(`[${contas[m[1]].nome} · ${a.nome}] ${usuarioId} clicou no link → etiqueta ${a.etiqueta}`);
    res.writeHead(302, { Location: a.mensagem2.link });
    return res.end();
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Automação Lari — no ar ✨");
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  log(`servidor no ar na porta ${PORT}`);
  if (!VERIFY_TOKEN) log("AVISO: VERIFY_TOKEN não definido");
  if (!APP_SECRET) log("AVISO: APP_SECRET não definido — assinaturas não serão verificadas");
  if (!PAINEL_SENHA) log("AVISO: PAINEL_SENHA não definida — o painel fica bloqueado");
  for (const [id, c] of Object.entries(contas)) {
    const t = tokenDe(id);
    log(`perfil @${c.nome}: ${t ? `token ok (${t.slice(0, 3)}…, ${t.length} caracteres)` : "SEM TOKEN (TOKEN_" + id + ")"}`);
    if (t) assinarWebhook(id, c.nome, t);
  }
});

// Pede para a Meta mandar comentários e DMs deste perfil para o app (e mostra o que ficou assinado)
async function assinarWebhook(id, nome, token) {
  const campos = "comments,messages,messaging_postbacks";
  for (const alvo of [id, "me"]) {
    try {
      const url = `${apiDe(token)}/${alvo}/subscribed_apps?subscribed_fields=${campos}&access_token=${encodeURIComponent(token)}`;
      const r = await fetch(url, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && !j.error) {
        const g = await fetch(`${apiDe(token)}/${alvo}/subscribed_apps?access_token=${encodeURIComponent(token)}`);
        const gj = await g.json().catch(() => ({}));
        log(`perfil @${nome}: assinatura de webhook ok · ${JSON.stringify(gj.data || gj)}`);
        return;
      }
      log(`perfil @${nome}: assinatura via /${alvo} falhou · ${(j.error && j.error.message) || r.status}`);
    } catch (e) {
      log(`perfil @${nome}: assinatura via /${alvo} falhou · ${e.message}`);
    }
  }
}
