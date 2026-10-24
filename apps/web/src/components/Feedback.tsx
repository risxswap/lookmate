import { useEffect, useId, useRef, type ReactNode } from 'react';
import { App } from 'antd';

interface FeedbackProps {
  type?: 'success' | 'info' | 'warning' | 'error';
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  /** A new request may fail with exactly the same text. */
  eventKey?: unknown;
}

/** Present request feedback outside page layout, retaining recovery actions. */
export function Feedback({ type = 'info', title, description, action, onClose, eventKey }: FeedbackProps) {
  const { message, notification } = App.useApp();
  const key = useId();
  const previous = useRef<{ title: ReactNode; type: string; eventKey: unknown; detailed: boolean } | null>(null);
  const dismissed = useRef(false);
  const active = useRef(false);
  const detailed = description != null || action != null;

  useEffect(() => {
    active.current = true;
    previous.current = null;
    return () => {
      active.current = false;
      message.destroy(key);
      notification.destroy(key);
    };
  }, [key, message, notification]);

  useEffect(() => {
    const changed = !previous.current || previous.current.title !== title || previous.current.type !== type || previous.current.eventKey !== eventKey || previous.current.detailed !== detailed;
    previous.current = { title, type, eventKey, detailed };
    if (changed) dismissed.current = false;
    if (dismissed.current) return;
    const close = () => {
      if (!active.current) return;
      dismissed.current = true;
      onClose?.();
    };
    if (detailed) {
      message.destroy(key);
      // Update buttons and callbacks with current loading/draft state without stacking notices.
      notification.open({ key, type, title, description, actions: action, placement: 'topRight', duration: 0, onClose: close });
    } else if (changed) {
      notification.destroy(key);
      void message.open({ key, type, content: title, duration: type === 'error' ? 5 : 3, onClose: close });
    }
  });

  return null;
}
