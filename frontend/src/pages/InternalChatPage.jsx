// Stub temporário criado durante recuperação de 27-mai.
// O ficheiro original nunca foi terminado/deployado ontem.
// SupervisorLayout.jsx importa-o para a tab "Chat" — implementar feature ou
// remover a tab quando se decidir o destino do internal chat.
import React from 'react';

export default function InternalChatPage({ socket, user }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
      <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text)' }}>Chat interno</h2>
      <p style={{ fontSize: '0.9rem' }}>Em desenvolvimento.</p>
    </div>
  );
}
