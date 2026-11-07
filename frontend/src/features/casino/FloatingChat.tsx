import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MessagesSquare, UsersRound, X } from 'lucide-react';
import { CasinoChatContent } from './Chat';
import './floatingChat.css';

type Channel = { channel: string; title: string };
const ChatRegistration = createContext<((entry: Channel) => () => void) | null>(null);
export const useChatRegistration = () => useContext(ChatRegistration);

export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const dock = useRef<HTMLDivElement>(null),
    hovering = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const register = useCallback((entry: Channel) => {
    setChannels((items) => [...items.filter((item) => item.channel !== entry.channel), entry]);
    return () => {
      setChannels((items) => items.filter((item) => item !== entry));
      setActive((value) => (value === entry.channel ? null : value));
    };
  }, []);
  useEffect(() => cancelClose, [cancelClose]);
  function scheduleClose() {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!hovering.current && !dock.current?.contains(document.activeElement)) setActive(null);
    }, 180);
  }
  const current = channels.find((item) => item.channel === active);
  return (
    <ChatRegistration.Provider value={register}>
      {children}
      {channels.length > 0 &&
        createPortal(
          <div
            className="casino-chat-dock"
            ref={dock}
            onMouseEnter={() => {
              hovering.current = true;
              cancelClose();
            }}
            onMouseLeave={() => {
              hovering.current = false;
              scheduleClose();
            }}
            onFocusCapture={cancelClose}
            onBlurCapture={scheduleClose}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                (document.activeElement as HTMLElement | null)?.blur();
                setActive(null);
              }
            }}
          >
            <div
              className="casino-floating-window"
              hidden={!current}
              role="region"
              aria-label={current?.title}
            >
              <header>
                <div>
                  <small>{active === 'lobby' ? 'ОБЩИЙ' : 'ЛОКАЛЬНЫЙ'}</small>
                  <strong>{current?.title}</strong>
                </div>
                <button aria-label="Закрыть чат" onClick={() => setActive(null)}>
                  <X size={18} />
                </button>
              </header>
              {channels.map((entry) => (
                <div
                  key={entry.channel}
                  hidden={active !== entry.channel}
                  className="casino-floating-content"
                >
                  <CasinoChatContent channel={entry.channel} title={entry.title} floating />
                </div>
              ))}
            </div>
            <div className="casino-chat-launchers">
              {[...channels]
                .sort((a, b) => Number(a.channel === 'lobby') - Number(b.channel === 'lobby'))
                .map((entry) => (
                  <button
                    key={entry.channel}
                    className={`casino-chat-launcher ${entry.channel === 'lobby' ? 'global' : 'local'}`}
                    aria-label={entry.title}
                    title={entry.title}
                    aria-expanded={active === entry.channel}
                    onMouseEnter={() => {
                      cancelClose();
                      setActive(entry.channel);
                    }}
                    onFocus={() => setActive(entry.channel)}
                    onClick={() => setActive(entry.channel)}
                  >
                    {entry.channel === 'lobby' ? (
                      <UsersRound size={22} />
                    ) : (
                      <MessagesSquare size={22} />
                    )}
                    <span>{entry.channel === 'lobby' ? 'Общий' : 'Локальный'}</span>
                  </button>
                ))}
            </div>
          </div>,
          document.body,
        )}
    </ChatRegistration.Provider>
  );
}
