import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const socket = io(BACKEND, { autoConnect: false });

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('chatToken'));
  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem('chatUser');
    try {
      return savedUser ? JSON.parse(savedUser) : null;
    } catch { return null; }
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [contacts, setContacts] = useState([]);
  const [activeChat, setActiveChat] = useState('group');
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [createFeedback, setCreateFeedback] = useState(null); // { ok: bool, msg: string }

  const messagesEndRef = useRef(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const activeChatRef = useRef(activeChat);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChat]);

  useEffect(() => {
    if (!currentUser || !token) return;

    const headers = { Authorization: `Bearer ${token}` };

    socket.auth = { token };
    socket.connect();

    fetch(`${BACKEND}/api/users`, { headers })
      .then(r => r.json())
      .then(data => Array.isArray(data) && setContacts(data.filter(u => u.id !== currentUser.id)));

    fetch(`${BACKEND}/api/messages`, { headers })
      .then(r => r.json())
      .then(data => Array.isArray(data) && setMessages(data));

    socket.on('receive_message', msg => {
      setMessages(prev => [...prev, msg]);
      
      // Si el mensaje es de otra persona y no tengo su chat abierto, aumento la notificación
      if (msg.sender_id !== currentUser.id) {
        const chatKey = msg.receiver_id === null ? 'group' : msg.sender_id;
        if (activeChatRef.current !== chatKey) {
          setUnreadCounts(prev => ({ ...prev, [chatKey]: (prev[chatKey] || 0) + 1 }));
        }
      }
    });
    socket.on('online_users', users => setOnlineUsers(users));

    socket.on('user_created', newUser => {
      setContacts(prev => {
        if (prev.find(u => u.id === newUser.id)) return prev;
        return [...prev, newUser].sort((a, b) => a.username.localeCompare(b.username));
      });
    });

    return () => {
      socket.off('receive_message');
      socket.off('online_users');
      socket.off('user_created');
      socket.disconnect();
    };
  }, [currentUser, token]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${BACKEND}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        setToken(data.token);
        setCurrentUser(data.user);
        localStorage.setItem('chatToken', data.token);
        localStorage.setItem('chatUser', JSON.stringify(data.user));
      } else {
        setLoginError(data.message || 'Credenciales inválidas');
      }
    } catch {
      setLoginError('No se pudo conectar con el servidor');
    }
  };

  const handleLogout = () => {
    socket.disconnect();
    setCurrentUser(null);
    setToken(null);
    localStorage.removeItem('chatToken');
    localStorage.removeItem('chatUser');
    setMessages([]);
    setContacts([]);
    setActiveChat('group');
    setUsername('');
    setPassword('');
    setOnlineUsers([]);
    setUnreadCounts({});
  };

  const handleSelectChat = (chatId) => {
    setActiveChat(chatId);
    setUnreadCounts(prev => ({ ...prev, [chatId]: 0 })); // Reiniciar contador al leer
  };

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;
    socket.emit('send_message', {
      senderId: currentUser.id,
      receiverId: activeChat,
      content: messageInput,
    });
    setMessageInput('');
  };

  const handleCreateUser = async () => {
    setCreateFeedback(null);
    if (!newUsername.trim() || !newPassword.trim()) {
      setCreateFeedback({ ok: false, msg: 'Completa ambos campos.' });
      return;
    }
    try {
      const res = await fetch(`${BACKEND}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newUsername: newUsername.trim(), newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setCreateFeedback({ ok: true, msg: `Usuario "${data.user.username}" creado correctamente.` });
        setNewUsername('');
        setNewPassword('');
      } else {
        setCreateFeedback({ ok: false, msg: data.message || 'Error al crear el usuario' });
      }
    } catch {
      setCreateFeedback({ ok: false, msg: 'Error de conexión con el servidor' });
    }
  };

  const getDisplayedMessages = () =>
    messages.filter(m => {
      if (activeChat === 'group') return m.receiver_id === null;
      return (
        (m.sender_id === activeChat && m.receiver_id === currentUser.id) ||
        (m.sender_id === currentUser.id && m.receiver_id === activeChat)
      );
    });

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  };

  // --- LOGIN ---
  if (!currentUser) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(135deg, #1a1d20, #2c3034)' }}>
        <form onSubmit={handleLogin} style={{ background: 'white', padding: '40px', borderRadius: '12px', width: '320px', boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
          <h2 style={{ textAlign: 'center', margin: '0 0 6px', color: '#212529', fontSize: '22px' }}>ChatIntranet</h2>
          <p style={{ textAlign: 'center', color: '#6c757d', margin: '0 0 24px', fontSize: '14px' }}>Acceso para empleados</p>
          <input
            type="text" placeholder="Usuario" value={username} onChange={e => setUsername(e.target.value)} required
            style={inputStyle}
          />
          <input
            type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} required
            style={{ ...inputStyle, marginBottom: loginError ? '10px' : '20px' }}
          />
          {loginError && (
            <div style={{ marginBottom: '14px', color: '#dc3545', fontSize: '13px', textAlign: 'center' }}>{loginError}</div>
          )}
          <button type="submit" style={{ width: '100%', padding: '12px', background: '#0d6efd', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
            Ingresar
          </button>
        </form>
      </div>
    );
  }

  // Función para generar un color basado en el ID del usuario (para el nombre en el grupo)
  const getUserColor = (id) => {
    const colors = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b59b6', '#34495e'];
    return colors[id % colors.length];
  };

  // --- APP PRINCIPAL ---
  const isAdmin = currentUser.is_admin;
  const activeChatName =
    activeChat === 'group' ? 'Grupo General' :
    activeChat === 'admin' ? 'Gestionar Usuarios' :
    contacts.find(c => c.id === activeChat)?.username || '';

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Segoe UI, sans-serif' }}>

      {/* SIDEBAR */}
      <div style={{ width: '270px', background: '#1a1d20', color: 'white', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

        {/* Header sidebar */}
        <div style={{ padding: '14px 18px', background: '#111315', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2d3238' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#6c757d' }}>Conectado como</div>
            <div style={{ fontWeight: 'bold', fontSize: '15px' }}>
              {currentUser.username}
              {isAdmin && <span style={{ marginLeft: '6px', fontSize: '11px', background: '#198754', borderRadius: '4px', padding: '1px 5px', color: 'white' }}>Admin</span>}
            </div>
          </div>
          <button onClick={handleLogout} style={{ background: 'transparent', border: '1px solid #3d4349', color: '#adb5bd', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>
            Salir
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Grupo general */}
          <div
            onClick={() => handleSelectChat('group')}
            style={{ ...sidebarItem, background: activeChat === 'group' ? '#0d6efd' : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>Grupo General</span>
            {unreadCounts['group'] > 0 && <span style={badgeStyle}>{unreadCounts['group']}</span>}
          </div>

          {/* Mensajes directos */}
          <div style={sidebarLabel}>Mensajes Directos</div>
          {contacts.length === 0 && (
            <div style={{ padding: '10px 18px', color: '#495057', fontSize: '13px' }}>Sin otros usuarios</div>
          )}
          {contacts.map(contact => (
            <div
              key={contact.id}
              onClick={() => handleSelectChat(contact.id)}
              style={{ ...sidebarItem, background: activeChat === contact.id ? '#0d6efd' : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: onlineUsers.includes(contact.id) ? '#28a745' : '#6c757d', marginRight: 8 }}></div>
                {contact.username}
              </div>
              {unreadCounts[contact.id] > 0 && <span style={badgeStyle}>{unreadCounts[contact.id]}</span>}
            </div>
          ))}

          {/* Admin */}
          {isAdmin && (
            <>
              <div style={sidebarLabel}>Administración</div>
              <div
                onClick={() => handleSelectChat('admin')}
                style={{ ...sidebarItem, color: activeChat === 'admin' ? 'white' : '#51cf66', background: activeChat === 'admin' ? '#198754' : 'transparent' }}
              >
                Gestionar Usuarios
              </div>
            </>
          )}
        </div>
      </div>

      {/* ÁREA PRINCIPAL */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f1f3f5', minWidth: 0 }}>

        {/* Cabecera */}
        <div style={{ padding: '15px 24px', background: 'white', borderBottom: '1px solid #dee2e6', fontWeight: 'bold', fontSize: '17px', color: '#212529', flexShrink: 0 }}>
          {activeChatName}
        </div>

        {/* Panel de admin */}
        {activeChat === 'admin' && isAdmin ? (
          <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
            <div style={{ maxWidth: '420px', background: 'white', borderRadius: '10px', padding: '28px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}>
              <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#212529' }}>Crear nuevo empleado</h3>
              <input
                type="text" placeholder="Nombre de usuario" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                style={{ ...inputStyle, marginBottom: '12px' }}
              />
              <input
                type="password" placeholder="Contraseña" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                style={{ ...inputStyle, marginBottom: '16px' }}
                onKeyDown={e => e.key === 'Enter' && handleCreateUser()}
              />
              <button
                onClick={handleCreateUser}
                style={{ width: '100%', padding: '11px', background: '#198754', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
              >
                Crear Usuario
              </button>
              {createFeedback && (
                <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '6px', fontSize: '14px', background: createFeedback.ok ? '#d1e7dd' : '#f8d7da', color: createFeedback.ok ? '#0a3622' : '#58151c' }}>
                  {createFeedback.msg}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Lista de mensajes */}
            <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {getDisplayedMessages().map((msg, index) => {
                const isMe = msg.sender_id === currentUser.id;
                // Buscamos el nombre del remitente en la lista de contactos o usamos el nuestro si somos nosotros
                const senderName = isMe 
                  ? currentUser.username 
                  : (contacts.find(c => c.id === msg.sender_id)?.username || 'Usuario');

                return (
                  <div key={index} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '65%', marginBottom: '12px' }}>
                    {!isMe && activeChat === 'group' && (
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: getUserColor(msg.sender_id), marginBottom: '2px', marginLeft: '4px' }}>
                        {senderName}
                      </div>
                    )}
                    <div style={{
                      background: isMe ? '#0d6efd' : 'white',
                      color: isMe ? 'white' : '#212529',
                      padding: '10px 14px',
                      borderRadius: '16px',
                      borderTopRightRadius: isMe ? '3px' : '16px',
                      borderTopLeftRadius: isMe ? '16px' : '3px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                      wordBreak: 'break-word',
                    }}>
                      {msg.content}
                    </div>
                    <div style={{ fontSize: '11px', color: '#adb5bd', marginTop: '3px', textAlign: isMe ? 'right' : 'left', paddingLeft: isMe ? 0 : '4px', paddingRight: isMe ? '4px' : 0 }}>
                      {formatTime(msg.created_at)}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input de mensaje */}
            <div style={{ padding: '14px 20px', background: 'white', borderTop: '1px solid #dee2e6', display: 'flex', gap: '10px', flexShrink: 0 }}>
              <input
                type="text"
                placeholder="Escribe un mensaje..."
                value={messageInput}
                onChange={e => setMessageInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                style={{ flex: 1, padding: '11px 18px', borderRadius: '24px', border: '1px solid #dee2e6', outline: 'none', fontSize: '15px' }}
              />
              <button
                onClick={handleSendMessage}
                style={{ padding: '0 24px', background: '#0d6efd', color: 'white', border: 'none', borderRadius: '24px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
              >
                Enviar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  marginBottom: '0',
  border: '1px solid #dee2e6',
  borderRadius: '6px',
  boxSizing: 'border-box',
  fontSize: '15px',
  outline: 'none',
};

const sidebarItem = {
  padding: '13px 18px',
  cursor: 'pointer',
  borderBottom: '1px solid #2d3238',
  fontSize: '14px',
  transition: 'background 0.15s',
};

const sidebarLabel = {
  padding: '12px 18px 4px',
  fontSize: '11px',
  color: '#495057',
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
};

const badgeStyle = {
  background: '#dc3545',
  color: 'white',
  borderRadius: '10px',
  padding: '2px 6px',
  fontSize: '11px',
  fontWeight: 'bold',
};
