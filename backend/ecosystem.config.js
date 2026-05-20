module.exports = {
  apps: [{
    name: 'whatsapp-backend',
    script: 'src/app.js',
    wait_ready: true,        // Espera pelo process.send('ready') antes de considerar online
    listen_timeout: 60000,   // 60s para o WhatsApp conectar antes de timeout
    kill_timeout: 8000,      // 8s para o graceful shutdown antes de SIGKILL
    max_memory_restart: '500M',
  }],
};
