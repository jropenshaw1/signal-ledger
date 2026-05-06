// Signal Ledger — Provider Overview Bar
// Top fixed bar showing active provider record state
// Gap window badge is clickable — shows full gap window details popover

const GAP_WINDOW_DATA = {
  status: 'acknowledged',
  label: 'Feb 12–21',
  gap_start: '2026-02-12',
  gap_end: '2026-02-21',
  article_count_estimated: 10,
  resolution_path: 'email-backfill',
  resolution_notes: "Articles from Jonathan's subscription start date before MCP index began (Feb 12–21). Sourcing from Gmail email archive via nate_archiver email-backfill path.",
};

const STATUS_LIFECYCLE = ['open', 'acknowledged', 'resolved', 'unresolvable'];

const GapWindowPopover = ({ gap, onClose }) => {
  const statusColors = {
    open:         { color: '#FCD34D', bg: '#2A1A04', border: '#3D2706' },
    acknowledged: { color: '#93C5FD', bg: '#0D1E3A', border: '#1A3560' },
    resolved:     { color: '#4ADE80', bg: '#0F2318', border: '#1A3D26' },
    unresolvable: { color: '#475569', bg: '#141820', border: '#1E2530' },
  };
  const resPathColors = {
    'web':            '#60A5FA',
    'email-backfill': '#A78BFA',
    'none':           '#475569',
  };

  return (
    <div style={{
      position: 'absolute', top: '28px', left: 0, zIndex: 200,
      background: '#181D22', border: '1px solid #2D3748',
      borderRadius: '4px', width: '320px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #1E2530', background: '#1E252C' }}>
        <span style={{ fontFamily: "'Inter', sans-serif", fontSize: '11px', fontWeight: 600, color: '#E2E8F0' }}>Gap Window</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}>×</button>
      </div>

      {/* Fields */}
      <div style={{ padding: '10px 12px' }}>
        {[
          { label: 'gap_start',               value: gap.gap_start,               color: '#CBD5E1' },
          { label: 'gap_end',                 value: gap.gap_end,                 color: '#CBD5E1' },
          { label: 'article_count_estimated', value: `~${gap.article_count_estimated}`, color: '#CBD5E1' },
          { label: 'resolution_path',         value: gap.resolution_path,         color: resPathColors[gap.resolution_path] || '#CBD5E1' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #151A20' }}>
            <span style={{ fontSize: '9px', color: '#475569', letterSpacing: '0.04em' }}>{label}</span>
            <span style={{ fontSize: '10px', fontWeight: 500, color }}>{value}</span>
          </div>
        ))}

        {/* Resolution notes */}
        {gap.resolution_notes && (
          <div style={{ marginTop: '8px', padding: '6px 8px', background: '#0D1015', border: '1px solid #1E2530', borderRadius: '2px' }}>
            <div style={{ fontSize: '9px', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>resolution_notes</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: '10px', color: '#64748B', lineHeight: 1.55 }}>{gap.resolution_notes}</div>
          </div>
        )}

        {/* Status lifecycle */}
        <div style={{ marginTop: '10px' }}>
          <div style={{ fontSize: '9px', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>resolution_status lifecycle</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {STATUS_LIFECYCLE.map((s, i) => {
              const sc = statusColors[s];
              const isActive = s === gap.status;
              const isPast = STATUS_LIFECYCLE.indexOf(gap.status) > i && s !== 'unresolvable';
              return (
                <React.Fragment key={s}>
                  <span style={{
                    padding: '2px 6px', borderRadius: '2px',
                    background: isActive ? sc.bg : '#0D1015',
                    color: isActive ? sc.color : isPast ? '#334155' : '#1E2530',
                    border: `1px solid ${isActive ? sc.border : '#151A20'}`,
                    fontSize: '9px', fontWeight: isActive ? 600 : 400,
                    whiteSpace: 'nowrap',
                  }}>{s}</span>
                  {i < STATUS_LIFECYCLE.length - 1 && (
                    <span style={{ color: '#1E2530', fontSize: '9px' }}>→</span>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const ProviderBar = ({ provider = {} }) => {
  const [gapOpen, setGapOpen] = React.useState(false);
  const gapRef = React.useRef(null);

  React.useEffect(() => {
    if (!gapOpen) return;
    const handler = (e) => { if (gapRef.current && !gapRef.current.contains(e.target)) setGapOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [gapOpen]);

  const {
    name = 'Nate B. Jones',
    platform = 'Substack',
    url = 'natesnewsletter.substack.com',
    tier = 'paid',
    corpusStart = '2026-02-12',
    articleCount = 47,
    lastIngestion = '2026-05-02',
    gapWindow = GAP_WINDOW_DATA,
    evaluation = 'maintain-current-tier',
  } = provider;

  const tierStyle = tier === 'paid'
    ? { background: '#14291C', color: '#86EFAC', border: '1px solid #163320' }
    : { background: '#161A20', color: '#94A3B8', border: '1px solid #2D3748' };

  const gapStyles = {
    open:         { background: '#2C1F06', color: '#FCD34D', border: '1px solid #3A2A10' },
    acknowledged: { background: '#1E3A5F', color: '#93C5FD', border: '1px solid #1E4A7A' },
    resolved:     { background: '#14291C', color: '#86EFAC', border: '1px solid #163320' },
    unresolvable: { background: '#161A20', color: '#475569', border: '1px solid #1E2530' },
  };
  const gapStyle = gapStyles[gapWindow?.status] || gapStyles.open;

  const evalStyles = {
    'maintain-current-tier': { color: '#94A3B8', border: '1px solid #2D3748' },
    'upgrade-candidate':     { color: '#86EFAC', border: '1px solid #163320' },
    'degradation-signal':    { color: '#FCD34D', border: '1px solid #3A2A10' },
    'abandon-signal':        { color: '#FCA5A5', border: '1px solid #3A1A1A' },
  };
  const evalStyle = evalStyles[evaluation] || evalStyles['maintain-current-tier'];

  return (
    <div style={providerBarStyles.bar}>
      {/* Identity */}
      <div style={providerBarStyles.identity}>
        <div style={providerBarStyles.icon}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>
          </svg>
        </div>
        <div>
          <div style={providerBarStyles.name}>{name}</div>
          <div style={providerBarStyles.platformLabel}>{platform} · {url}</div>
        </div>
      </div>

      {/* Metadata grid */}
      <div style={providerBarStyles.metaGrid}>
        <MetaItem label="Tier">
          <span style={{ ...providerBarStyles.pill, ...tierStyle }}>
            {tier === 'paid' ? '● ' : '○ '}{tier}
          </span>
        </MetaItem>
        <MetaItem label="Corpus Start">
          <span style={providerBarStyles.metaValue}>{corpusStart}</span>
        </MetaItem>
        <MetaItem label="Articles">
          <span style={{ ...providerBarStyles.metaValue, fontSize: '18px', fontWeight: 600, color: '#E2E8F0' }}>
            {articleCount}
          </span>
        </MetaItem>
        <MetaItem label="Last Ingestion">
          <span style={providerBarStyles.metaValue}>{lastIngestion}</span>
        </MetaItem>
        <MetaItem label="Gap Window">
          {gapWindow ? (
            <div ref={gapRef} style={{ position: 'relative' }}>
              <span
                onClick={() => setGapOpen(o => !o)}
                style={{ ...providerBarStyles.pill, ...gapStyle, cursor: 'pointer', userSelect: 'none' }}
                title="Click to view gap window details"
              >
                ▲ {gapWindow.label} · {gapWindow.status}
              </span>
              {gapOpen && <GapWindowPopover gap={gapWindow} onClose={() => setGapOpen(false)} />}
            </div>
          ) : (
            <span style={{ ...providerBarStyles.pill, background: '#111418', color: '#334155', border: '1px solid #1E2530' }}>— none</span>
          )}
        </MetaItem>
        <MetaItem label="Last Evaluation" last>
          <span style={{ ...providerBarStyles.pill, background: '#111418', ...evalStyle }}>
            {evaluation}
          </span>
        </MetaItem>
      </div>
    </div>
  );
};

const MetaItem = ({ label, children, last }) => (
  <div style={{ ...providerBarStyles.metaItem, borderRight: last ? 'none' : '1px solid #1E2530' }}>
    <div style={providerBarStyles.metaLabel}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'center' }}>{children}</div>
  </div>
);

const providerBarStyles = {
  bar: {
    display: 'flex', alignItems: 'center', height: '56px',
    background: '#181D22', borderBottom: '1px solid #2D3748',
    padding: '0 16px', flexShrink: 0,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
    fontFamily: "'Inter', sans-serif",
    overflow: 'visible', position: 'relative', zIndex: 10,
  },
  identity: {
    display: 'flex', alignItems: 'center', gap: '10px',
    paddingRight: '20px', borderRight: '1px solid #1E2530',
    marginRight: '20px', flexShrink: 0,
  },
  icon: {
    width: '32px', height: '32px', borderRadius: '4px',
    background: '#0D1520', border: '1px solid #1E3A5F',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#60A5FA', flexShrink: 0,
  },
  name: { fontFamily: "'Inter', sans-serif", fontSize: '14px', fontWeight: 600, color: '#E2E8F0' },
  platformLabel: { fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: '#475569', marginTop: '1px' },
  metaGrid: { display: 'flex', alignItems: 'center', flex: 1 },
  metaItem: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 14px' },
  metaLabel: { fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em' },
  metaValue: { fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', fontWeight: 500, color: '#CBD5E1' },
  pill: { display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: '2px', fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', fontWeight: 500, whiteSpace: 'nowrap' },
};

Object.assign(window, { ProviderBar });
