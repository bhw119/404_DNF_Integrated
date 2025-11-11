import React from 'react';
import { createRoot } from 'react-dom/client';
import { SummaryView } from '@/components/sidepanel/SummaryView';

function App() {
  return (
    <div style={{ padding: 12 }}>
      <h3>Sidepanel Summary</h3>
      <SummaryView stats={{ total: 0, dark: 0, percent: 0 }} />
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);


