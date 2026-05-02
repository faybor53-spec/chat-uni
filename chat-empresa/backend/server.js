require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// En producción, podrás cambiar '*' por tu URL de Vercel
const allowedOrigin = process.env.FRONTEND_URL || '*';

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigin } });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Manejador de errores para evitar caídas del servidor
pool.on('error', (err) => {
  console.error('Error inesperado en la base de datos:', err);
});

const JWT_SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido o expirado' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user.is_admin) {
    return res.status(403).json({ message: 'Solo el administrador puede realizar esta acción' });
  }
  next();
}

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT id, username, password, is_admin FROM users WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ success: true, token, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
  } catch (error) {
    console.error('Error en login:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Crear usuario — solo admin autenticado
app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newUsername?.trim() || !newPassword?.trim()) {
    return res.status(400).json({ message: 'Usuario y contraseña son requeridos' });
  }
  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, false) RETURNING id, username, is_admin',
      [newUsername.trim(), hashed]
    );
    
    // Notificar a todos los sockets que hay un nuevo usuario
    io.emit('user_created', { id: result.rows[0].id, username: result.rows[0].username });
    
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Ese nombre de usuario ya existe' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Obtener lista de usuarios (requiere autenticacion)
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username FROM users ORDER BY username ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener historial de mensajes (requiere autenticacion)
app.get('/api/messages', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Middleware de Socket.io para verificar el JWT
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Error de autenticación: No hay token'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    next(new Error('Error de autenticación: Token inválido'));
  }
});

// WebSockets
io.on('connection', (socket) => {
  // Unir automáticamente al usuario a su sala privada basándose en su token seguro
  socket.join(socket.user.id.toString());

  // Emitir la lista actualizada de usuarios conectados
  const updateOnlineUsers = () => {
    const online = new Set();
    for (let [id, s] of io.sockets.sockets) {
      if (s.user?.id) online.add(s.user.id);
    }
    io.emit('online_users', Array.from(online));
  };
  updateOnlineUsers(); // Avisar cuando alguien entra

  socket.on('disconnect', () => {
    updateOnlineUsers(); // Avisar cuando alguien sale
  });

  socket.on('send_message', async ({ senderId, receiverId, content }) => {
    // SEGURIDAD: Asegurar que el remitente sea quien dice ser según su token
    if (senderId !== socket.user.id) return;

    if (!content?.trim()) return;
    try {
      const result = await pool.query(
        'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
        [senderId, receiverId === 'group' ? null : receiverId, content.trim()]
      );
      const newMsg = result.rows[0];
      if (receiverId === 'group') {
        io.emit('receive_message', newMsg);
      } else {
        io.to(receiverId.toString()).emit('receive_message', newMsg);
        io.to(senderId.toString()).emit('receive_message', newMsg);
      }
    } catch (error) {
      console.error('Error al guardar mensaje:', error);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
