import React from 'react';

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  style?: React.CSSProperties;
};

export function Button({ children, onClick, disabled, variant = 'primary', style }: ButtonProps) {
  const base: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid',
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1
  };
  const theme: React.CSSProperties =
    variant === 'primary'
      ? { background: '#111827', color: '#ffffff', borderColor: '#111827' }
      : { background: '#ffffff', color: '#111827', borderColor: '#d1d5db' };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...theme, ...(style || {}) }}>
      {children}
    </button>
  );
}


