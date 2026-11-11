// Automação de DMs do Instagram (substitui o ManyChat) — API oficial da Meta.
// Sem dependências externas: só Node.js 20+.

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const contas = require("./config");

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const APP_SECRET = process.env.APP_SECRET || "";
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const DATA_DIR = process.env.DATA_DIR || "/data";
// Tokens do "login do Instagram" começam com IG → graph.instagram.com.
// Tokens do "login unificado" (token de usuário do sistema, começa com EAA) → graph.facebook.com.
function apiDe(token) {
  return token.startsWith("IG")
    ? "https://graph.instagram.com/v23.0"
    : "https://graph.facebook.com/v23.0";
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const ARQ_ETIQUETAS = path.join(DATA_DIR, "etiquetas.csv");
const ARQ_LOG = path.join(DATA_DIR, "eventos.log");

// ---------- utilidades ----------

function log(...args) {
  const linha = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(linha);
  fs.appendFile(ARQ_LOG, linha + "\n", () => {});
}

function tokenDe(contaId) {
  // remove espaços e aspas que às vezes vêm junto ao colar
  return (process.env[`TOKEN_${contaId}`] || "").trim().replace(/^["']|["']$/g, "");
}

// minúsculas, sem acento, só letras/números
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
  return palavras.some((p) => t.includes(` ${normalizar(p)} `));
}

// evita responder duas vezes ao mesmo evento (a Meta às vezes reenvia)
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

async function primeiroNome(contaId, usuarioId, reserva) {
  try {
    const p = await chamarApi(contaId, `/${usuarioId}?fields=name,username`);
    const nome = (p.name || "").trim().split(/\s+/)[0];
    if (nome) return nome;
  } catch (_) {
    /* sem permissão de perfil ainda — usa a reserva */
  }
  return reserva || "";
}

function montarTexto(modelo, nome) {
  return modelo.replace(" {nome}", nome ? ` ${nome}` : "").replace("{nome}", nome || "");
}

// ---------- envio das mensagens ----------

// destinatario: { id: <usuário> } ou { comment_id: <comentário> } (resposta privada a comentário)
async function enviarMensagem1(contaId, destinatario, nome) {
  const c = contas[contaId];
  return chamarApi(contaId, `/${contaId}/messages`, {
    method: "POST",
    body: {
      recipient: destinatario,
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: montarTexto(c.mensagem1.texto, nome),
            buttons: [{ type: "postback", title: c.mensagem1.botao, payload: "PASSO_2:" + contaId }],
          },
        },
      },
    },
  });
}

async function enviarMensagem2(contaId, usuarioId) {
  const c = contas[contaId];
  const link = BASE_URL
    ? `${BASE_URL}/r/${contaId}/${usuarioId}`
    : c.mensagem2.link;
  return chamarApi(contaId, `/${contaId}/messages`, {
    method: "POST",
    body: {
      recipient: { id: usuarioId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: c.mensagem2.texto,
            buttons: [{ type: "web_url", title: c.mensagem2.botao, url: link }],
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
  if (!c || autor.id === contaId) return; // ignora comentários do próprio perfil
  if (!temPalavra(valor.text, c.gatilhos.comentario)) return;
  if (jaVisto(`c:${valor.id}`)) return;
  log(`[${c.nome}] comentário de @${autor.username || autor.id}: "${valor.text}"`);
  await enviarMensagem1(contaId, { comment_id: valor.id }, "");
  log(`[${c.nome}] mensagem 1 enviada (comentário ${valor.id})`);     try {
       const frases = c.respostaComentario || ["Te mandei no direct! ✨", "Corre no direct que te mandei 💌", "Acabei de te mandar no direct ✨"];
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

  // clique no botão da mensagem 1
  if (ev.postback) {
    if (jaVisto(`p:${ev.postback.mid || usuarioId + ev.timestamp}`)) return;
    if (ev.postback.payload === "PASSO_2:" + contaId) {
      log(`[${c.nome}] ${usuarioId} clicou em "${c.mensagem1.botao}"`);
      await enviarMensagem2(contaId, usuarioId);
      log(`[${c.nome}] mensagem 2 enviada para ${usuarioId}`);
    }
    return;
  }

  const msg = ev.message;
  if (!msg || msg.is_echo || !msg.text) return;
  if (jaVisto(`m:${msg.mid}`)) return;

  const ehStory = !!(msg.reply_to && msg.reply_to.story);
  const palavras = ehStory ? c.gatilhos.story : c.gatilhos.dm;
  if (!temPalavra(msg.text, palavras)) return;

  log(`[${c.nome}] ${ehStory ? "resposta ao story" : "DM"} de ${usuarioId}: "${msg.text}"`);
  const nome = await primeiroNome(contaId, usuarioId);
  await enviarMensagem1(contaId, { id: usuarioId }, nome);
  log(`[${c.nome}] mensagem 1 enviada para ${usuarioId}`);
}

async function processarWebhook(payload) {
  for (const entry of payload.entry || []) {
    const contaId = String(entry.id);
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
      for (const ev of    [...(entry.messaging || []), ...(entry.standby || [])]) {
        await tratarMensagem(contaId, ev);
      }
    } catch (e) {
      log(`[${contas[contaId].nome}] ERRO: ${e.message}`);
    }
  }
}

function assinaturaValida(corpo, cabecalho) {
  if (!APP_SECRET) return true; // sem segredo configurado, não valida (só para testes)
  if (!cabecalho || !cabecalho.startsWith("sha256=")) return false;
  const esperado = crypto.createHmac("sha256", APP_SECRET).update(corpo).digest("hex");
  const recebido = cabecalho.slice(7);
  return (
    esperado.length === recebido.length &&
    crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido))
  );
}

// ---------- servidor HTTP ----------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  // verificação do webhook (feita pela Meta ao salvar a URL de callback)
  if (req.method === "GET" && url.pathname === "/webhook") {
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      VERIFY_TOKEN &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    res.writeHead(ok ? 200 : 403);
    return res.end(ok ? url.searchParams.get("hub.challenge") : "token inválido");
  }

  // eventos (comentários, DMs, cliques)
  if (req.method === "POST" && url.pathname === "/webhook") {
    const partes = [];
    req.on("data", (p) => partes.push(p));
    req.on("end", () => {
      const corpo = Buffer.concat(partes);
      if (!assinaturaValida(corpo, req.headers["x-hub-signature-256"])) {
        log("webhook com assinatura inválida — ignorado");
        res.writeHead(403);
        return res.end();
      }
      res.writeHead(200);
      res.end("ok"); // responde rápido; processa depois
      let payload;
      try {
        payload = JSON.parse(corpo.toString("utf8"));
      } catch {
        return log("webhook com JSON inválido");
      }
      processarWebhook(payload).catch((e) => log("ERRO geral:", e.message));
    });
    return;
  }

  // clique no link da mensagem 2: registra a etiqueta e redireciona para a página de venda
  const m = url.pathname.match(/^\/r\/(\d+)\/([\w-]+)$/);
  if (req.method === "GET" && m && contas[m[1]]) {
    const c = contas[m[1]];
    const linha = `${new Date().toISOString()},${c.nome},${m[2]},${c.etiqueta}\n`;
    fs.appendFile(ARQ_ETIQUETAS, linha, () => {});
    log(`[${c.nome}] ${m[2]} clicou no link → etiqueta ${c.etiqueta}`);
    res.writeHead(302, { Location: c.mensagem2.link });
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
  for (const [id, c] of Object.entries(contas)) {
    const t = tokenDe(id);
    log(`perfil @${c.nome}: ${t ? `token ok (${t.slice(0, 3)}…, ${t.length} caracteres, ${apiDe(t).split("/")[2]})` : "SEM TOKEN (TOKEN_" + id + ")"}`);
  }
});
