/**
 * Control plane — signup + pagamento (Mercado Pago Pix) + (futuro) provisionamento.
 *
 * Fase 3a: recebe o formulário da landing, cria um pagamento Pix no Mercado Pago,
 * regista o signup, e ao receber o webhook "approved" marca como pago e notifica
 * o operador (o provisionamento automático é a Fase 3b).
 *
 * Segredos vêm de .env (NUNCA no git): MP_ACCESS_TOKEN, MP_FALLBACK_PAYER_EMAIL,
 * ADMIN_KEY, PORT, DB_PATH.
 */
require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const PORT = parseInt(process.env.PORT || '4500', 10);
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
const FALLBACK_EMAIL = process.env.MP_FALLBACK_PAYER_EMAIL || 'no-reply@example.com';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

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

// GET /signup/:id/status — a landing faz polling até "approved"
app.get('/signup/:paymentId/status', async (req, res) => {
  const row = db.prepare('SELECT status FROM signups WHERE mp_payment_id = ?').get(req.params.paymentId);
  res.json({ status: row ? row.status : 'unknown' });
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
    if (pay.status === 'approved' && !row.provisioned) {
      // FASE 3b: aqui dispara o worker de provisionamento do tenant.
      // Por agora (3a): regista e notifica o operador para provisionar.
      console.log(`[signup] PAGO ✅ #${row.id} ${row.empresa} — plano ${row.plano} (R$${row.preco}). Provisionar tenant.`);
      // TODO: notifyOperator(row)  (WhatsApp/email)
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

app.get('/health', (req, res) => res.json({ ok: true, mp: !!MP_TOKEN }));

app.listen(PORT, () => console.log(`[control-plane] a ouvir na porta ${PORT}`));
