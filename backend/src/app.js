require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const db = require('./db/schema');
const { initWhatsApp, getStatus } = require('./whatsapp/client');
const { initSocket } = require('./socket/handlers');
const { authMiddleware, ownerOnly } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const conversationsRoutes = require('./routes/conversations');
const messagesRoutes = require('./routes/messages');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true },
});

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Seed: criar conta do dono se não existir
const owner = db.prepare("SELECT id FROM users WHERE role = 'owner'").get();
if (!owner) {
  const hash = bcrypt.hashSync(process.env.OWNER_PASSWORD || 'admin123', 10);
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'owner')")
    .run(process.env.OWNER_NAME || 'Dono', process.env.OWNER_EMAIL || 'dono@loja.com', hash);
  console.log('Conta do dono criada:', process.env.OWNER_EMAIL || 'dono@loja.com', '/ senha:', process.env.OWNER_PASSWORD || 'admin123');
}

// Rotas
app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/conversations', conversationsRoutes);
app.use('/messages', messagesRoutes);

// WhatsApp status
app.get('/whatsapp/status', authMiddleware, (req, res) => {
  res.json(getStatus());
});

// Socket.io
initSocket(io);

// WhatsApp
initWhatsApp(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor a correr em http://localhost:${PORT}`);
});
