export default function TimelineLoading() {
  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header skeleton */}
      <div style={{
        height: 56,
        borderBottom: "0.5px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        gap: 12,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
        <div style={{ width: 120, height: 14, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
      </div>

      {/* Headline skeleton */}
      <div style={{ padding: "24px 20px 16px" }}>
        <div style={{ width: "30%", height: 10, borderRadius: 5, background: "rgba(255,255,255,0.04)", marginBottom: 12 }} />
        <div style={{ width: "95%", height: 18, borderRadius: 6, background: "rgba(255,255,255,0.07)", marginBottom: 8 }} />
        <div style={{ width: "75%", height: 18, borderRadius: 6, background: "rgba(255,255,255,0.05)", marginBottom: 20 }} />
        <div style={{ display: "flex", gap: 8 }}>
          {[60, 80, 70].map((w, i) => (
            <div key={i} style={{ width: w, height: 24, borderRadius: 99, background: "rgba(255,255,255,0.04)" }} />
          ))}
        </div>
      </div>

      {/* Article skeletons */}
      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            background: "rgba(255,255,255,0.03)",
            border: "0.5px solid rgba(255,255,255,0.05)",
            borderRadius: 14,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            opacity: 1 - i * 0.15,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
              <div style={{ width: 80, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.05)" }} />
              <div style={{ width: 40, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.03)", marginLeft: "auto" }} />
            </div>
            <div style={{ width: "90%", height: 13, borderRadius: 5, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ width: "70%", height: 13, borderRadius: 5, background: "rgba(255,255,255,0.04)" }} />
            <div style={{ width: "55%", height: 11, borderRadius: 5, background: "rgba(255,255,255,0.03)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
