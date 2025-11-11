import React from "react";

type StatusBarProps = {
  text?: string;
};

export function StatusBar({ text }: StatusBarProps) {
  return (
    <div
      style={{
        fontSize: 12,
        color: "#374151",
        background: "#F3F4F6",
        padding: "6px 8px",
        borderRadius: 6,
        border: "1px solid #E5E7EB",
      }}
    >
      {text || "대기 중"}
    </div>
  );
}
