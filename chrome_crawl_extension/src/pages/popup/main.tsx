import React, { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from '@/components/common/Section';
import { Button } from '@/components/common/Button';
import { StatusBar } from '@/components/popup/StatusBar';
import { translateBlocks, containsKorean, shouldKeepBlock, dedupeBlocksGlobal } from '@/lib/text';

function App() {
  const [status, setStatus] = useState<string>('대기 중');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [translated, setTranslated] = useState<string[]>([]);
  const [inFlight, setInFlight] = useState<boolean>(false);

  const filtered = useMemo(() => blocks.filter((b) => shouldKeepBlock(b)), [blocks]);

  const onMockCollect = useCallback(async () => {
    // TODO: 실제 수집 로직 연결 (content script 메시징)
    setBlocks(['지금 가입하면 할인 혜택!', '로그인', '2024-11-11', 'Buy now * Save 10%']);
    setStatus('수집 완료');
  }, []);

  const onTranslate = useCallback(async () => {
    if (!filtered.length) {
      setStatus('번역할 블록이 없습니다.');
      return;
    }
    setInFlight(true);
    try {
      let current = 0;
      const res = await translateBlocks(filtered, (c, t) => {
        current = c;
        setStatus(`번역 중 ${c}/${t}`);
      });
      setTranslated(res);
      setStatus('번역 완료');
    } catch (e: any) {
      setStatus(`번역 실패: ${e?.message || e}`);
    } finally {
      setInFlight(false);
    }
  }, [filtered]);

  const onDedupe = useCallback(() => {
    const merged = dedupeBlocksGlobal(translated);
    setTranslated(merged);
    setStatus(`중복 제거 완료 (${merged.length}/${translated.length})`);
  }, [translated]);

  return (
    <div style={{ padding: 12, minWidth: 360 }}>
      <h3 style={{ margin: '0 0 12px 0' }}>404 DNF</h3>
      <Section title="상태">
        <StatusBar text={status} />
      </Section>
      <Section title="수집 / 처리">
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={onMockCollect} disabled={inFlight}>수집(모의)</Button>
          <Button onClick={onTranslate} disabled={inFlight || filtered.length === 0}>번역</Button>
          <Button onClick={onDedupe} disabled={inFlight || translated.length === 0} variant="secondary">중복제거</Button>
        </div>
      </Section>
      <Section title={`원본 블록 (${blocks.length})`}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {blocks.map((b, i) => (
            <li key={i} style={{ color: containsKorean(b) ? '#111827' : '#6B7280' }}>
              {b}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={`필터링 (${filtered.length})`}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {filtered.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </Section>
      <Section title={`번역 (${translated.length})`}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {translated.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </Section>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);


