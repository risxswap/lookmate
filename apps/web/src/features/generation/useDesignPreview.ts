import { useEffect, useRef, useState } from 'react';
import { request } from '../../api/client';
import type { DesignInput, Preview } from './api';

// A preview only belongs to the latest open confirmation session.
export function useDesignPreview() {
  const [value, setValue] = useState<Preview | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  function invalidate() { sequence.current++; controller.current?.abort(); setLoading(false); setInputKey(''); }
  function close() { invalidate(); setOpen(false); setError(null); setValue(null); }
  async function check(input: DesignInput) {
    controller.current?.abort();
    const current = ++sequence.current;
    const nextController = new AbortController(); controller.current = nextController;
    setOpen(true); setLoading(true); setError(null); setInputKey('');
    try {
      const next = await request<Preview>('/designs/preview', { method: 'POST', body: input, signal: nextController.signal });
      if (current !== sequence.current) return;
      setValue(next); setInputKey(JSON.stringify(input));
    } catch (failure) {
      if (current === sequence.current) setError(failure instanceof Error ? failure : new Error('暂时无法核验本次设计'));
    } finally { if (current === sequence.current) setLoading(false); }
  }
  return { value, inputKey, open, loading, error, check, close, invalidate };
}
