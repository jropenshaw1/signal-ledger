// Signal Ledger — Ingestion Monitor (Left Panel)
// Live-ish feed of capture events with retry chain visualization

const SAMPLE_EVENTS = [
  { id: 'e1', type: 'ingestion_started',   status: 'neutral',  time: '14:32:01', detail: 'The Orchestration Problem — Nate B. Jones', articleId: 'a3f2c1d0' },
  { id: 'e2', type: 'ingestion_succeeded', status: 'success',  time: '14:32:03', detail: 'a3f2c1d0… · complete', articleId: 'a3f2c1d0' },
  { id: 'e3', type: 'embedding_queued',    status: 'neutral',  time: '14:32:03', detail: 'a3f2c1d0… · pending', articleId: 'a3f2c1d0' },
  { id: 'e4', type: 'embedding_succeeded', status: 'success',  time: '14:32:09', detail: 'a3f2c1d0… · complete', articleId: 'a3f2c1d0' },
  { id: 'e5', type: 'ingestion_started',   status: 'neutral',  time: '14:33:10', detail: 'Credential vs. Capability — Nate B. Jones', articleId: 'b7e1d4f2' },
  { id: 'e6', type: 'ingestion_succeeded', status: 'success',  time: '14:33:12', detail: 'b7e1d4f2… · partial', articleId: 'b7e1d4f2' },
  { id: 'e7', type: 'embedding_queued',    status: 'neutral',  time: '14:33:12', detail: 'b7e1d4f2… · pending', articleId: 'b7e1d4f2' },
  { id: 'e8', type: 'embedding_failed',    status: 'failed',   time: '14:33:15', detail: 'RATE_LIMITED · retryable · attempt 1', articleId: 'b7e1d4f2', errorCode: 'RATE_LIMITED', retryable: true, attempt: 1 },
  { id: 'e9', type: 'retry_attempted',     status: 'retry',    time: '14:33:17', detail: 'retry_of: e8 · wait 2s', articleId: 'b7e1d4f2' },
  { id: 'e10', type: 'embedding_failed',   status: 'failed',   time: '14:33:17', detail: 'RATE_LIMITED · retryable · attempt 2', articleId: 'b7e1d4f2', errorCode: 'RATE_LIMITED', retryable: true, attempt: 2 },
  { id: 'e11', type: 'retry_attempted',    status: 'retry',    time: '14:33:25', detail: 'retry_of: e10 · wait 8s', articleId: 'b7e1d4f2' },
  { id: 'e12', type: 'embedding_failed',   status: 'terminal', time: '14:33:25', detail: 'RATE_LIMITED · attempt 3 · TERMINAL', articleId: 'b7e1d4f2', errorCode: 'RATE_LIMITED', retryable: false, attempt: 3, terminal: true },
  { id: 'e13', type: 'ingestion_failed',   status: 'failed',   time: '14:34:01', detail: 'DUPLICATE_ARTICLE · retryable: false', articleId: null, errorCode: 'DUPLICATE_ARTICLE', retryable: false },
];

const EVENT_DOT = {
  neutral:  { symbol: '○', color: '#475569' },
  success:  { symbol: '●', color: '#22C55E' },
  failed:   { symbol: '✕', color: '#EF4444' },
  terminal: { symbol: '✕', color: '#EF4444' },
  retry:    { symbol: '↺', color: '#F59E0B' },
  processing: { symbol: null, color: '#60A5FA' },
};

const EVENT_TYPE_COLOR = {
  ingestion_started:   '#64748B',
  ingestion_succeeded: '#4ADE80',
  ingestion_failed:    '#F87171',
  embedding_queued:    '#64748B',
  embedding_succeeded: '#4ADE80',
  embedding_failed:    '#F87171',
  retry_attempted:     '#FBBF24',
};

const EVENT_ROW_BG = {
  failed:   'rgba(44,15,15,0.35)',
  terminal: 'rgba(44,15,15,0.55)',
  retry:    'rgba(44,31,6,0.3)',
};

const PulsingDot = () => {
  const [opacity, setOpacity] = React.useState(1);
  React.useEffect(() => {
    let up = false;
    const iv = setInterval(() => {
      setOpacity(o => { up = o <= 0.35; return up ? o + 0.05 : o - 0.05; });
    }, 60);
    return () => clearInterval(iv);
  }, []);
  return <span style={{ display: 'inline-block', width: '7px', height: '7px', background: '#60A5FA', borderRadius: '50%', opacity, flexShrink: 0 }} />;
};

const IngestionMonitor = ({ events = SAMPLE_EVENTS, liveCount = 13 }) => {
  const [selectedId, setSelectedId] = React.useState(null);

  return (
    <div style={imStyles.panel}>
      {/* Header */}
      <div style={imStyles.header}>
        <span style={imStyles.title}>Ingestion Monitor</span>
        <span style={imStyles.meta}>live · {liveCount} events today</span>
      </div>

      {/* Column headers */}
      <div style={imStyles.colHeader}>
        <div style={{ width: '14px' }} />
        <div style={{ ...imStyles.colH, width: '118px' }}>Event</div>
        <div style={{ ...imStyles.colH, flex: 1 }}>Detail</div>
        <div style={{ ...imStyles.colH, width: '56px', textAlign: 'right' }}>Time</div>
      </div>

      {/* Event rows */}
      <div style={imStyles.feedScroll}>
        {events.map(ev => {
          const dot = EVENT_DOT[ev.status] || EVENT_DOT.neutral;
          const typeColor = EVENT_TYPE_COLOR[ev.type] || '#64748B';
          const rowBg = EVENT_ROW_BG[ev.status] || 'transparent';
          const isSelected = selectedId === ev.id;

          return (
            <div
              key={ev.id}
              onClick={() => setSelectedId(isSelected ? null : ev.id)}
              style={{
                ...imStyles.eventRow,
                background: isSelected ? '#0D1520' : rowBg,
                borderLeft: isSelected ? '2px solid #3B82F6' : '2px solid transparent',
              }}
            >
              <div style={{ width: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {ev.status === 'processing'
                  ? <PulsingDot />
                  : <span style={{ fontSize: '9px', color: dot.color, lineHeight: 1 }}>{dot.symbol}</span>
                }
              </div>
              <div style={{ width: '118px', flexShrink: 0 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', fontWeight: 500, color: typeColor, letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
                  {ev.type}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '10px',
                  color: ev.terminal ? '#EF4444' : ev.status === 'failed' ? '#F87171' : '#94A3B8',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
                }}>
                  {ev.terminal ? <strong>{ev.detail}</strong> : ev.detail}
                </span>
              </div>
              <div style={{ width: '56px', flexShrink: 0, textAlign: 'right' }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: '#334155' }}>{ev.time}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div style={imStyles.footer}>
        <span style={imStyles.footerStat}><span style={{ color: '#22C55E' }}>●</span> {events.filter(e => e.status === 'success').length} succeeded</span>
        <span style={imStyles.footerStat}><span style={{ color: '#EF4444' }}>✕</span> {events.filter(e => e.status === 'failed' || e.status === 'terminal').length} failed</span>
        <span style={imStyles.footerStat}><span style={{ color: '#F59E0B' }}>↺</span> {events.filter(e => e.status === 'retry').length} retries</span>
      </div>
    </div>
  );
};

const imStyles = {
  panel: {
    display: 'flex', flexDirection: 'column',
    background: '#111418', border: '1px solid #1E2530',
    width: '270px', flexShrink: 0, overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', borderBottom: '1px solid #1E2530', background: '#181D22',
    flexShrink: 0,
  },
  title: { fontFamily: "'Inter', sans-serif", fontSize: '12px', fontWeight: 600, color: '#E2E8F0' },
  meta: { fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: '#475569' },
  colHeader: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '4px 10px', borderBottom: '1px solid #1E2530',
    background: '#0F1318', flexShrink: 0,
  },
  colH: { fontFamily: "'JetBrains Mono', monospace", fontSize: '8px', fontWeight: 500, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.07em' },
  feedScroll: { flex: 1, overflowY: 'auto' },
  eventRow: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '5px 10px', borderBottom: '1px solid #151A20',
    cursor: 'pointer', transition: 'background 150ms', minHeight: '28px',
  },
  footer: {
    display: 'flex', gap: '12px', padding: '6px 12px',
    borderTop: '1px solid #1E2530', background: '#0F1318', flexShrink: 0,
  },
  footerStat: { fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' },
};

Object.assign(window, { IngestionMonitor });
