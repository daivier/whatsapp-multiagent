import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import ThreadList from '../components/InternalChat/ThreadList';
import ThreadView from '../components/InternalChat/ThreadView';

export default function InternalChatPage({ socket, onUnreadChange }) {
  const { user } = useAuth();
  const [selectedThread, setSelectedThread] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showThread, setShowThread] = useState(false);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  function handleSelectThread(thread) {
    setSelectedThread(thread);
    if (isMobile) setShowThread(true);
  }

  if (!user) return null;

  const showSidebar = !isMobile || !showThread;
  const showMain = !isMobile || showThread;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Thread list sidebar */}
      {showSidebar && (
        <div style={{ width: isMobile ? '100%' : '260px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ThreadList
            selectedThreadId={selectedThread?.id}
            onSelectThread={handleSelectThread}
            socket={socket}
            onUnreadChange={onUnreadChange}
          />
        </div>
      )}

      {/* Thread view */}
      {showMain && (
        <ThreadView
          thread={selectedThread}
          socket={socket}
          onClose={isMobile ? () => setShowThread(false) : undefined}
          onThreadUpdated={(updated) => setSelectedThread(updated)}
          onChannelDeleted={(id) => { setSelectedThread(null); }}
        />
      )}
    </div>
  );
}
