// Ejecutar UNA SOLA VEZ: node setup.js
// Agrega columna is_admin, hashea contraseñas existentes, marca admin.
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function setup() {
  const client = await pool.connect();
  try {
    console.log('Agregando columna is_admin...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false
    `);

    console.log('Hasheando contraseñas existentes...');
    const { rows: users } = await client.query('SELECT id, password FROM users');
    for (const user of users) {
      // Solo hashear si aún no está hasheada (bcrypt empieza con $2b$)
      if (!user.password.startsWith('$2b$') && !user.password.startsWith('$2a$')) {
        const hashed = await bcrypt.hash(user.password, 10);
        await client.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user.id]);
        console.log(`  Usuario ID ${user.id}: contraseña hasheada.`);
      } else {
        console.log(`  Usuario ID ${user.id}: ya estaba hasheada, omitida.`);
      }
    }

    console.log('Marcando usuario admin como administrador...');
    const { rowCount } = await client.query(
      "UPDATE users SET is_admin = true WHERE username = 'admin'"
    );
    if (rowCount === 0) {
      console.log('  AVISO: No se encontró un usuario llamado "admin". Créalo primero.');
    } else {
      console.log('  Listo.');
    }

    console.log('\nSetup completado correctamente.');
  } catch (err) {
    console.error('Error durante el setup:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
