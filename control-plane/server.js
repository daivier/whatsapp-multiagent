/**
 * Control plane — signup + pagamento (Mercado Pago Pix) + provisionamento.
 *
 * Fase 3a: recebe o formulário da landing, cria um pagamento Pix no Mercado Pago,
 * regista o signup, e ao receber o webhook "approved" marca como pago.
 *
 * Fase 3b: ao aprovar, provisiona o tenant SOZINHO — gera slug + porta livre +
 * senha, dispara o new-tenant.sh em background (clone + build + PM2 + Nginx com
 * cert wildcard *.atendize.com) e, quando termina, expõe URL+login+senha no
 * /status (a landing mostra ao cliente). O operador também recebe tudo no log e
 * na lista /signups.
 *
 * Segredos vêm de .env (NUNCA no git): MP_ACCESS_TOKEN, MP_FALLBACK_PAYER_EMAIL,
 * ADMIN_KEY, PORT, DB_PATH. Provisionamento: REPO_DIR, TENANTS_DIR, ZONE,
 * PORT_BASE, AUTO_PROVISION (=0 para desligar).
 */
require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '4500', 10);
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
const FALLBACK_EMAIL = process.env.MP_FALLBACK_PAYER_EMAIL || 'no-reply@example.com';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// --- Provisionamento automático (Fase 3b) ---
const REPO_DIR = process.env.REPO_DIR || '/home/daivier/whatsapp-multiagent';
const TENANTS_DIR = process.env.TENANTS_DIR || '/home/daivier/whatsapp-tenants';
const ZONE = process.env.ZONE || 'atendize.com';
const PORT_BASE = parseInt(process.env.PORT_BASE || '3031', 10);
const AUTO_PROVISION = process.env.AUTO_PROVISION !== '0'; // ligado por default

// --- Email de boas-vindas (Gmail SMTP por default; tudo configurável por env) ---
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || (SMTP_USER ? `Atendize <${SMTP_USER}>` : '');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* instalar com: npm i nodemailer */ }

// Planos e preços (devem espelhar plan.js do backend)
const PLANS = {
  basico:       { label: 'Básico',       preco: 197 },
  profissional: { label: 'Profissional', preco: 397 },
  empresarial:  { label: 'Empresarial',  preco: 797 },
};

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'signups.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa TEXT NOT NULL,
  responsavel TEXT,
  email TEXT NOT NULL,
  whatsapp TEXT,
  plano TEXT NOT NULL,
  preco REAL NOT NULL,
  mp_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  provisioned INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME
)`);

// Migrações (Fase 3b): dados do tenant provisionado. Append-only — não editar o CREATE.
for (const col of [
  'slug TEXT',
  'port INTEGER',
  'owner_password TEXT',
  'url TEXT',
  'provision_status TEXT',   // null | provisioning | done | error
  'provision_error TEXT',
  'provisioned_at DATETIME',
  'wa_link TEXT',
  'email_sent INTEGER NOT NULL DEFAULT 0',
  'email_error TEXT',
]) {
  try { db.exec(`ALTER TABLE signups ADD COLUMN ${col}`); } catch (_) { /* já existe */ }
}

async function mpCreatePix(amount, description, email) {
  const res = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      transaction_amount: amount,
      description,
      payment_method_id: 'pix',
      payer: { email: email || FALLBACK_EMAIL },
      notification_url: process.env.WEBHOOK_URL || undefined,
    }),
  });
  return res.json();
}

async function mpGetPayment(id) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` },
  });
  return res.json();
}

// ─── Provisionamento (Fase 3b) ──────────────────────────────────────────────

// empresa -> slug seguro (só [a-z0-9-]); evita injeção ao passar ao shell.
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'cliente';
}

function slugTaken(slug) {
  if (fs.existsSync(path.join(TENANTS_DIR, slug))) return true;
  return !!db.prepare('SELECT 1 FROM signups WHERE slug = ?').get(slug);
}

function uniqueSlug(base) {
  let s = base, n = 1;
  while (slugTaken(s)) { n++; s = `${base}-${n}`; }
  return s;
}

function portFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(p, '127.0.0.1');
  });
}

async function findFreePort() {
  const used = new Set(
    db.prepare('SELECT port FROM signups WHERE port IS NOT NULL').all().map((r) => r.port)
  );
  for (let p = PORT_BASE; p < PORT_BASE + 500; p++) {
    if (used.has(p)) continue;
    if (await portFree(p)) return p;
  }
  throw new Error('sem portas livres no intervalo');
}

function genPassword() {
  // 10 chars sem caracteres ambíguos (sem 0/O/1/l/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

// ─── Notificação ao cliente (email + link wa.me) ───────────────────────────

// Link wa.me pré-preenchido para o OPERADOR enviar o boas-vindas com 1 clique.
function waLink(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  // BR: garantir o código de país 55 quando parece número local (10-11 dígitos).
  const num = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

let _mailer;
function getMailer() {
  if (!nodemailer || !SMTP_USER || !SMTP_PASS) return null;
  if (!_mailer) {
    _mailer = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return _mailer;
}

async function sendWelcomeEmail(to, url, login, senha) {
  const t = getMailer();
  if (!t) return { skipped: true };
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#111827">
      <h2 style="color:#25D366">A sua conta Atendize está pronta 🎉</h2>
      <p>Bem-vindo! Já pode entrar no seu painel de atendimento:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Acesso</td><td><a href="${url}">${url}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Login</td><td><b>${login}</b></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Senha</td><td><b>${senha}</b></td></tr>
      </table>
      <p style="color:#6b7280;font-size:14px">Recomendamos alterar a senha após o primeiro acesso. Próximo passo: entrar e ligar o WhatsApp escaneando o QR Code.</p>
    </div>`;
  await t.sendMail({
    from: MAIL_FROM,
    to,
    subject: 'A sua conta Atendize está pronta 🎉',
    text: `A sua conta no Atendize está pronta.\n\nAcesso: ${url}\nLogin: ${login}\nSenha: ${senha}\n\nRecomendamos alterar a senha após o primeiro acesso.`,
    html,
  });
  return { ok: true };
}

// Best-effort: nunca rebenta o provisionamento. Grava wa_link e estado do email.
async function notifyCustomer(id, url, password) {
  const row = db.prepare('SELECT * FROM signups WHERE id = ?').get(id);
  if (!row) return;

  const text =
    `Olá! A sua conta no Atendize está pronta. 🎉\n\n` +
    `Acesso: ${url}\nLogin: ${row.email}\nSenha: ${password}\n\n` +
    `Recomendamos alterar a senha após o primeiro acesso.`;
  const link = waLink(row.whatsapp, text);
  db.prepare('UPDATE signups SET wa_link = ? WHERE id = ?').run(link, id);
  if (link) console.log(`[notify] #${id} WhatsApp boas-vindas (1 clique): ${link}`);

  try {
    const r = await sendWelcomeEmail(row.email, url, row.email, password);
    if (r.skipped) {
      console.log(`[notify] #${id} email não configurado (SMTP_USER/PASS ausentes) — usar o link wa.me`);
    } else {
      db.prepare('UPDATE signups SET email_sent = 1, email_error = NULL WHERE id = ?').run(id);
      console.log(`[notify] #${id} email enviado para ${row.email}`);
    }
  } catch (e) {
    db.prepare('UPDATE signups SET email_error = ? WHERE id = ?').run(String(e.message), id);
    console.error(`[notify] #${id} email FALHOU: ${e.message} (usar o link wa.me)`);
  }
}

// Dispara o new-tenant.sh em background. Idempotente: só um provisionamento por
// signup (lock via UPDATE atómico). Fire-and-forget — não bloqueia a resposta HTTP.
async function provisionTenant(id) {
  // Reivindica o signup: só avança se ainda não provisionado e não em curso.
  const claim = db.prepare(
    `UPDATE signups SET provision_status = 'provisioning'
     WHERE id = ? AND provisioned = 0 AND (provision_status IS NULL OR provision_status = 'error')`
  ).run(id);
  if (claim.changes !== 1) return; // já em curso ou concluído

  const row = db.prepare('SELECT * FROM signups WHERE id = ?').get(id);
  if (!row) return;

  try {
    const slug = uniqueSlug(slugify(row.empresa));
    const port = await findFreePort();
    const password = genPassword();
    const plano = PLANS[row.plano] ? row.plano : 'basico';

    // Grava já slug/porta/senha — a página mostra-os quando o provisionamento terminar.
    db.prepare('UPDATE signups SET slug = ?, port = ?, owner_password = ? WHERE id = ?')
      .run(slug, port, password, id);

    console.log(`[provision] #${id} ${row.empresa} -> ${slug}.${ZONE} (porta ${port}, plano ${plano})`);

    const script = path.join(REPO_DIR, 'new-tenant.sh');
    const logPath = path.join(__dirname, `provision-${id}.log`);
    const logFd = fs.openSync(logPath, 'a');

    // Args via array (não passa por shell) — nome com espaços é seguro.
    const child = spawn(
      'bash',
      [script, slug, String(port), row.empresa, row.email, password, plano],
      {
        cwd: REPO_DIR,
        stdio: ['ignore', logFd, logFd],
        // PATH explícito: o daemon PM2 pode não herdar node/npm/pm2/nginx/sudo.
        env: {
          ...process.env,
          PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH || ''}`,
        },
      }
    );

    child.on('close', (code) => {
      try { fs.closeSync(logFd); } catch (_) {}
      if (code === 0) {
        const url = `https://${slug}.${ZONE}`;
        db.prepare(
          `UPDATE signups SET provisioned = 1, provision_status = 'done', url = ?, provisioned_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(url, id);
        console.log(`[provision] ✅ #${id} PRONTO: ${url}  login ${row.email}  senha ${password}`);
        notifyCustomer(id, url, password); // email de boas-vindas + link wa.me (best-effort)
      } else {
        let tail = '';
        try { tail = fs.readFileSync(logPath, 'utf8').slice(-600); } catch (_) {}
        db.prepare(`UPDATE signups SET provision_status = 'error', provision_error = ? WHERE id = ?`)
          .run(`exit ${code}\n${tail}`, id);
        console.error(`[provision] ❌ #${id} FALHOU (exit ${code}). Ver ${logPath} — provisionar manualmente.`);
      }
    });

    child.on('error', (e) => {
      try { fs.closeSync(logFd); } catch (_) {}
      db.prepare(`UPDATE signups SET provision_status = 'error', provision_error = ? WHERE id = ?`)
        .run(String(e.message), id);
      console.error(`[provision] ❌ #${id} erro ao lançar new-tenant.sh:`, e.message);
    });
  } catch (e) {
    db.prepare(`UPDATE signups SET provision_status = 'error', provision_error = ? WHERE id = ?`)
      .run(String(e.message), id);
    console.error(`[provision] ❌ #${id} erro:`, e.message);
  }
}

const app = express();
app.use(express.json());

// POST /signup — cria pagamento Pix + regista o lead. Devolve o QR para a landing.
app.post('/signup', async (req, res) => {
  const { empresa, responsavel, email, whatsapp, plano } = req.body || {};
  const p = PLANS[plano];
  if (!empresa || !email || !p) {
    return res.status(400).json({ error: 'Preenche empresa, email e um plano válido.' });
  }
  try {
    const pay = await mpCreatePix(p.preco, `${p.label} — WhatsApp Multi-Atendente`, email);
    const td = pay && pay.point_of_interaction && pay.point_of_interaction.transaction_data;
    if (!pay.id || !td) {
      console.error('[signup] MP falhou:', pay && (pay.message || pay.status), JSON.stringify(pay && pay.cause || []));
      return res.status(502).json({ error: 'Não foi possível gerar o Pix. Tenta novamente.' });
    }
    db.prepare(`INSERT INTO signups (empresa, responsavel, email, whatsapp, plano, preco, mp_payment_id, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(empresa.trim(), (responsavel || '').trim(), email.trim(), (whatsapp || '').trim(), plano, p.preco, String(pay.id), pay.status);
    res.json({
      payment_id: pay.id,
      status: pay.status,
      plano: p.label,
      valor: p.preco,
      qr_code: td.qr_code,             // copia-e-cola
      qr_code_base64: td.qr_code_base64, // imagem
      ticket_url: td.ticket_url,
    });
  } catch (e) {
    console.error('[signup]', e.message);
    res.status(500).json({ error: 'Erro interno ao processar o pedido.' });
  }
});

// GET /signup/:id/status — a landing faz polling até "approved" e depois até o
// tenant ficar provisionado. Consulta o Mercado Pago em tempo real (não depende
// só do webhook), atualiza a BD, dispara o provisionamento e, quando pronto,
// devolve URL+login+senha para a landing mostrar ao cliente.
app.get('/signup/:paymentId/status', async (req, res) => {
  const pid = req.params.paymentId;
  let row = db.prepare('SELECT * FROM signups WHERE mp_payment_id = ?').get(pid);
  let status = row ? row.status : 'unknown';

  // Consulta o MP só enquanto ainda não está aprovado — evita roundtrips a cada
  // poll durante os minutos de provisionamento.
  if (row && row.status !== 'approved') {
    try {
      const pay = await mpGetPayment(pid);
      if (pay && pay.status) {
        status = pay.status;
        if (pay.status !== row.status) {
          const paidStamp = pay.status === 'approved' ? 'CURRENT_TIMESTAMP' : 'paid_at';
          db.prepare(`UPDATE signups SET status = ?, paid_at = ${paidStamp} WHERE id = ?`).run(pay.status, row.id);
          row = db.prepare('SELECT * FROM signups WHERE id = ?').get(row.id);
        }
      }
    } catch (_) { /* mantém o status da BD se o MP falhar */ }
  }

  if (row && row.status === 'approved' && AUTO_PROVISION) provisionTenant(row.id);

  // Resposta enriquecida com o estado do provisionamento.
  const resp = { status };
  if (row) {
    const fresh = db.prepare(
      'SELECT provisioned, provision_status, url, email, owner_password, plano FROM signups WHERE id = ?'
    ).get(row.id);
    resp.provisioned = !!fresh.provisioned;
    resp.provision_status = fresh.provision_status || null;
    if (fresh.provisioned && fresh.url) {
      resp.url = fresh.url;
      resp.email = fresh.email;
      resp.senha = fresh.owner_password;
      resp.plano = fresh.plano;
    }
  }
  res.json(resp);
});

// POST /webhook — Mercado Pago notifica alterações de pagamento.
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responder sempre rápido, processar depois
  try {
    const id = (req.body && req.body.data && req.body.data.id) || req.query['data.id'] || req.query.id;
    const topic = (req.body && req.body.type) || req.query.topic || req.query.type;
    if (!id || (topic && topic !== 'payment')) return;
    const pay = await mpGetPayment(id);
    if (!pay || !pay.id) return;
    const row = db.prepare('SELECT * FROM signups WHERE mp_payment_id = ?').get(String(pay.id));
    if (!row) return;
    if (pay.status !== row.status) {
      const paidStamp = pay.status === 'approved' ? "CURRENT_TIMESTAMP" : "paid_at";
      db.prepare(`UPDATE signups SET status = ?, paid_at = ${paidStamp} WHERE id = ?`).run(pay.status, row.id);
    }
    if (pay.status === 'approved' && !row.provisioned && AUTO_PROVISION) {
      provisionTenant(row.id); // provisiona o tenant em background
    }
  } catch (e) {
    console.error('[webhook]', e.message);
  }
});

// GET /signups?key=... — lista para o operador (protegida)
app.get('/signups', (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'forbidden' });
  res.json(db.prepare('SELECT * FROM signups ORDER BY id DESC LIMIT 200').all());
});

app.get('/health', (req, res) => res.json({ ok: true, mp: !!MP_TOKEN, auto_provision: AUTO_PROVISION }));

app.listen(PORT, () => console.log(`[control-plane] a ouvir na porta ${PORT} (auto-provision: ${AUTO_PROVISION})`));
