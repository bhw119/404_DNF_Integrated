import React from 'react';
import { Section } from '@/components/common/Section';

type SummaryViewProps = {
  stats?: { total?: number; dark?: number; percent?: number };
};

export function SummaryView({ stats }: SummaryViewProps) {
  return (
    <div>
      <Section title="요약">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Metric label="총계" value={stats?.total ?? 0} />
          <Metric label="다크패턴" value={stats?.dark ?? 0} />
          <Metric label="비율(%)" value={stats?.percent ?? 0} />
        </div>
      </Section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ padding: 8, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}


