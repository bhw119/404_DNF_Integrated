import React from "react";

type SectionProps = {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export function Section({ title, children, style }: SectionProps) {
  return (
    <section style={{ marginBottom: 12, ...(style || {}) }}>
      {title && <h4 style={{ margin: "0 0 8px 0" }}>{title}</h4>}
      <div>{children}</div>
    </section>
  );
}
