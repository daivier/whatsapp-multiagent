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
        NODE_ENV: 'production',
        PORT: 3002,
        JWT_SECRET: 'muda_esta_chave_secreta_aqui',
        WA_SESSION_PATH: '/home/daivier/clientes/supermercados/session',
        DB_PATH: '/home/daivier/clientes/supermercados/database.sqlite',
        OWNER_NAME: 'Dono',
        OWNER_EMAIL: 'dono@loja.com',
        OWNER_PASSWORD: 'admin123',
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
        NODE_ENV: 'production',
        PORT: 3005,
        JWT_SECRET: 'sucataodejeova_secret_2024',
        WA_SESSION_PATH: '/home/daivier/clientes/sucataodejeova/session',
        DB_PATH: '/home/daivier/clientes/sucataodejeova/database.sqlite',
        OWNER_NAME: 'Dono',
        OWNER_EMAIL: 'dono@loja.com',
        OWNER_PASSWORD: 'admin123',
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
        NODE_ENV: 'production',
        PORT: 3006,
        JWT_SECRET: 'diaristou_secret_2024',
        WA_SESSION_PATH: '/home/daivier/clientes/diaristou/session',
        DB_PATH: '/home/daivier/clientes/diaristou/database.sqlite',
        OWNER_NAME: 'Dono',
        OWNER_EMAIL: 'dono@loja.com',
        OWNER_PASSWORD: 'admin123',
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
        NODE_ENV: 'production',
        PORT: 3007,
        JWT_SECRET: 'sac_supermercados_secret_2024',
        WA_SESSION_PATH: '/home/daivier/clientes/sac-supermercados/session',
        DB_PATH: '/home/daivier/clientes/sac-supermercados/database.sqlite',
        OWNER_NAME: 'Dono',
        OWNER_EMAIL: 'dono@loja.com',
        OWNER_PASSWORD: 'admin123',
        FRONTEND_URL: 'https://atendimentosac.supermercadosfortaleza.com.br',
      },
    },
  ],
};
