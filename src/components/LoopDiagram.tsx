/** The Exam-to-Mastery loop as a static SVG (decorative; the steps are also listed as text). */
const nodes = [
  { a: -90, n: '1', t: 'Take a mock', d: 'Timed, distraction-free' },
  { a: 0, n: '2', t: 'Read the report', d: 'Marks, sections, skills' },
  { a: 90, n: '3', t: 'Save to the Vault', d: 'Misses & unsure answers' },
  { a: 180, n: '4', t: 'Practice fresh', d: 'Targeted new questions' },
];

export function LoopDiagram() {
  const cx = 230, cy = 190, r = 118;
  const pt = (deg: number, rad = r) => [cx + rad * Math.cos((deg * Math.PI) / 180), cy + rad * Math.sin((deg * Math.PI) / 180)];
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from + 16); const [x2, y2] = pt(to - 16);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  return (
    <svg viewBox="0 0 460 380" role="img" aria-label="Diagram: take a mock, read the report, save mistakes to the vault, practice fresh questions, then repeat." className="mx-auto w-full max-w-md">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 1 L8 5 L0 9" fill="none" stroke="rgb(var(--signal-light))" strokeWidth="1.8" strokeLinecap="round" />
        </marker>
      </defs>
      {nodes.map((n, i) => <path key={i} d={arc(n.a, nodes[(i + 1) % 4].a + (i === 3 ? 360 : 0))} fill="none" stroke="rgb(var(--signal-light))" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" markerEnd="url(#arrow)" />)}
      <text x={cx} y={cy - 4} textAnchor="middle" className="fill-paper" style={{ font: '600 20px "Fraunces Variable", serif' }}>Exam-to-</text>
      <text x={cx} y={cy + 20} textAnchor="middle" className="fill-paper" style={{ font: '600 20px "Fraunces Variable", serif' }}>Mastery</text>
      {nodes.map((n) => {
        const [x, y] = pt(n.a);
        const left = n.a === 180, right = n.a === 0, vert = !left && !right;
        const lx = vert ? x : right ? x + 30 : x - 30;
        const ly = vert ? (n.a === -90 ? y - 34 : y + 46) : y - 2;
        const anchor = vert ? 'middle' : right ? 'start' : 'end';
        return (
          <g key={n.n}>
            <circle cx={x} cy={y} r="21" fill="rgb(var(--ink-2))" stroke="rgb(var(--gold))" strokeWidth="2" />
            <text x={x} y={y + 5} textAnchor="middle" className="fill-gold" style={{ font: '600 15px "JetBrains Mono", monospace' }}>{n.n}</text>
            <text x={lx} y={ly} textAnchor={anchor} className="fill-white" style={{ font: '600 15px "Hanken Grotesk Variable", sans-serif' }}>{n.t}</text>
            <text x={lx} y={ly + 17} textAnchor={anchor} style={{ font: '400 12.5px "Hanken Grotesk Variable", sans-serif', fill: 'rgb(var(--mist-2))' }}>{n.d}</text>
          </g>
        );
      })}
    </svg>
  );
}
