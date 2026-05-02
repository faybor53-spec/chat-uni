require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setupAdmin() {
  try {
    // 1. Asegurar que exista la columna de administrador en la tabla
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;');
    
    // 2. Encriptar la contraseña y guardar/actualizar el usuario 'admin'
    const hashed = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO users (username, password, is_admin) VALUES ('admin', $1, true)
       ON CONFLICT (username) DO UPDATE SET password = $1, is_admin = true`,
      [hashed]
    );
    
    console.log('✅ Administrador configurado correctamente en la base de datos.');
    console.log('👉 Credenciales listas: Usuario: admin | Contraseña: admin123');
  } catch (err) {
    console.error('❌ Error configurando al administrador:', err);
  } finally {
    pool.end();
  }
}

setupAdmin();