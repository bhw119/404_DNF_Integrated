import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div style={{ padding: 12 }}>
      <h3>Sidepanel Analysis</h3>
      <p>분석 패널이 React로 마이그레이션되었습니다.</p>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);


