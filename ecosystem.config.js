/**
 * PM2 Ecosystem — Multi-cliente WhatsApp
 *
 * Para adicionar um cliente novo:
 *   1. Copiar um bloco app abaixo com novo nome e porta
 *   2. Criar pasta /home/daivier/clientes/nomeCliente/
 *   3. Copiar o frontend/dist para lá (com VITE_TENANT_NAME correcto)
 *   4. Adicionar bloco nginx apontando para a nova porta
 *   5. pm2 startOrRestart ecosystem.config.js && pm2 save
 *
 * Para actualizar o código de TODOS os clientes de uma vez:
 *   pm2 reload ecosystem.config.js
 */

const BASE = '/home/daivier/whatsapp-multiagent/backend';

// Variáveis partilhadas por todos os tenants (whisper.cpp instalado em /opt).
const COMMON_ENV = {
  WHISPER_MODEL: '/opt/whisper.cpp/models/ggml-base.bin',
  WHISPER_LANG: 'pt',
};

// Segredos por tenant (JWT_SECRET, OWNER_PASSWORD) — carregados de
// `secrets.local.js` (gitignored). Gerar com bash deploy/rotate-secrets.sh.
// Se faltar, cair em valores default INSEGUROS apenas para arranque inicial.
let SECRETS;
try {
  SECRETS = require('./secrets.local.js');
} catch (_) {
  console.warn('[ecosystem] secrets.local.js não encontrado — a usar defaults INSEGUROS. Corre deploy/rotate-secrets.sh.');
  SECRETS = {
    supermercados:    { JWT_SECRET: 'change_me_supermercados',    OWNER_PASSWORD: 'admin123' },
    sucataodejeova:   { JWT_SECRET: 'change_me_sucataodejeova',   OWNER_PASSWORD: 'admin123' },
    diaristou:        { JWT_SECRET: 'change_me_diaristou',        OWNER_PASSWORD: 'admin123' },
    'sac-supermercados': { JWT_SECRET: 'change_me_sac',           OWNER_PASSWORD: 'admin123' },
  };
}
const S = (slug) => SECRETS[slug] || { JWT_SECRET: 'unset', OWNER_PASSWORD: 'unset' };

module.exports = {
  apps: [
    // ─── Cliente 1: Supermercados Fortaleza ───────────────────────────────────
    {
      name: 'whatsapp-supermercados',
      script: `${BASE}/src/app.js`,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 8000,
      env: {
        ...COMMON_ENV,
        NODE_ENV: 'production',
        PORT: 3002,
        JWT_SECRET: S('supermercados').JWT_SECRET,
        WA_SESSION_PATH: '/home/daivier/clientes/supermercados/session',
        DB_PATH: '/home/daivier/clientes/supermercados/database.sqlite',
        OWNER_NAME: 'Dono',
        OWNER_EMAIL: 'dono@loja.com',
        OWNER_PASSWORD: S('supermercados').OWNER_PASSWORD,
        FRONTEND_URL: 'https://atendimento.supermercadosfortaleza.com.br',
      },
    },

    // ─── Cliente 2: Sucatão de Jeová ─────────────────────────────────────────
    {
      name: 'whatsapp-sucataodejeova',
      script: `${BASE}/src/app.js`,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 8000,
      env: {
        ...COMMON_ENV,
        NODE_ENV: 'production',
        PORT: 3005,
        JWT_SECRET: S('sucataodejeova').JWT_SECRET,
        WA_SESSION_PATH: '/home/daivier/clientes/sucataodejeova/session',
        DB_PATH: '/home/daivier/clientes/sucataodejeova/database.sqlite',
        OWNER_NAME: 'Dono',
        OWNER_EMAIL: 'dono@loja.com',
        OWNER_PASSWORD: S('sucataodejeova').OWNER_PASSWORD,
        FRONTEND_URL: 'https://diaadia.code2scan.com',
      },
    },

    // ─── Cliente 3: Diaristou ─────────────────────────────────────────────────
    {
      name: 'whatsapp-diaristou',
      script: `${BASE}/src/app.js`,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 8000,
      env: {
        ...COMMON_ENV,
        NODE_ENV: 'production',
        PORT: 3006,
        JWT_SECRET: S('diaristou').JWT_SECRET,
        WA_SESSION_PATH: '/home/daivier/clientes/diaristou/session',
        DB_PATH: '/home/daivier/clientes/diaristou/database.sqlite',
        OWNER_NAME: 'Dono',
        OWNER_EMAIL: 'dono@loja.com',
        OWNER_PASSWORD: S('diaristou').OWNER_PASSWORD,
        FRONTEND_URL: 'https://atendimento.diaristou.com.br',
      },
    },

    // ─── Cliente 4: SAC Supermercados Fortaleza ───────────────────────────────
    {
      name: 'whatsapp-sac-supermercados',
      script: `${BASE}/src/app.js`,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 8000,
      env: {
        ...COMMON_ENV,
        NODE_ENV: 'production',
        PORT: 3007,
        JWT_SECRET: S('sac-supermercados').JWT_SECRET,
        WA_SESSION_PATH: '/home/daivier/clientes/sac-supermercados/session',
        DB_PATH: '/home/daivier/clientes/sac-supermercados/database.sqlite',
        OWNER_NAME: 'Dono',
        OWNER_EMAIL: 'dono@loja.com',
        OWNER_PASSWORD: S('sac-supermercados').OWNER_PASSWORD,
        FRONTEND_URL: 'https://atendimentosac.supermercadosfortaleza.com.br',
      },
    },
  ],
};
