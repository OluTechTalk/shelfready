import { ImageResponse } from "next/og";

// Link preview for every page (LinkedIn, X, Slack…). Pages without their own image inherit this one.
export const alt = "ShelfReady — making a Shopify store usable by AI shopping agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STATS = [
  { value: "94 → 98", label: "catalog agent-readiness" },
  { value: "99.4%", label: "agent found the right product" },
  { value: "0", label: "wrong products bought" },
];

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#f6f6f4", color: "#161616", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: "#2a78d6", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 700 }}>S</div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>ShelfReady</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1 }}>Making a Shopify store usable by AI shopping agents</div>
          <div style={{ fontSize: 30, color: "#5c5c58" }}>Audit the catalog · fix it with human approval · open it to agents over MCP</div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {STATS.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "20px 24px", borderRadius: 16, background: "white", border: "1px solid #e4e4e0" }}>
              <div style={{ fontSize: 44, fontWeight: 700, color: "#2a78d6" }}>{s.value}</div>
              <div style={{ fontSize: 22, color: "#5c5c58" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
