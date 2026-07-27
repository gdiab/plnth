"use client";

import { useEffect, useRef, useState } from "react";

const CSS = `
  :root {
    --wall: #101013;
    --floor: #0a0a0c;
    --stone: #d8d4cc;
    --stone-shade: #a9a49a;
    --stone-dark: #6f6a61;
    --ink: #e8e5df;
    --ink-dim: #8f8c85;
    --accent: #d9b96c;
    --holo: #5fe3d0;
    --holo-soft: rgba(95, 227, 208, 0.55);
    --holo-faint: rgba(95, 227, 208, 0.12);
    --term-bg: #0d1411;
    --term-edge: #22302a;
    --term-text: #cfe3d8;
    --term-dim: #7fa393;
    --term-green: #4fd88f;
    --term-amber: #e8c468;
    --term-red: #ef7b6d;
    --term-cyan: #6cc9d6;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: var(--wall);
    color: var(--ink);
    font-family: Georgia, 'Times New Roman', serif;
    overflow: hidden;
  }
  .gallery {
    position: relative;
    height: 100vh;
    display: grid;
    grid-template-rows: 1fr auto;
    background:
      radial-gradient(ellipse 90% 60% at 50% 92%, #1c1c20 0%, transparent 60%),
      linear-gradient(to bottom, #0d0d10 0%, var(--wall) 55%, var(--floor) 100%);
  }
  .light {
    position: absolute;
    left: 50%;
    top: -12vh;
    width: 130vmin;
    height: 130vmin;
    transform: translateX(-50%);
    background: radial-gradient(ellipse 28% 55% at 50% 30%, rgba(255, 244, 214, 0.10) 0%, rgba(255, 244, 214, 0.04) 45%, transparent 70%);
    pointer-events: none;
  }
  .scene {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding-bottom: 4vh;
  }
  .exhibit {
    position: relative;
    width: clamp(180px, 30vmin, 300px);
    height: clamp(160px, 26vmin, 260px);
    margin-bottom: -1vmin;
    perspective: 900px;
    z-index: 2;
  }
  .beam {
    position: absolute;
    left: 50%;
    bottom: -2vmin;
    width: 68%;
    height: 130%;
    transform: translateX(-50%);
    background: linear-gradient(to top, var(--holo-faint) 0%, rgba(95, 227, 208, 0.05) 55%, transparent 100%);
    clip-path: polygon(28% 100%, 72% 100%, 100% 0%, 0% 0%);
    animation: beam-breathe 6s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes beam-breathe { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
  .holo {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    animation: holo-spin 16s linear infinite, holo-float 7s ease-in-out infinite;
  }
  @keyframes holo-spin { to { transform: rotateY(360deg); } }
  @keyframes holo-float { 0%, 100% { margin-top: 0; } 50% { margin-top: -12px; } }
  .pane {
    position: absolute;
    inset: 8% 16%;
    border: 1px solid var(--holo-soft);
    border-radius: 6px;
    background: linear-gradient(160deg, rgba(95, 227, 208, 0.10) 0%, rgba(95, 227, 208, 0.03) 60%, rgba(95, 227, 208, 0.08) 100%);
    box-shadow:
      inset 0 0 24px rgba(95, 227, 208, 0.08),
      0 4px 30px rgba(95, 227, 208, 0.10);
    padding: 10% 9%;
    display: flex;
    flex-direction: column;
    gap: 7%;
  }
  .pane:nth-child(2) { transform: rotateY(60deg); }
  .pane:nth-child(3) { transform: rotateY(120deg); }
  .pane i {
    display: block;
    height: 4%;
    min-height: 2px;
    border-radius: 2px;
    background: var(--holo-soft);
    opacity: 0.7;
    animation: line-shimmer 3.2s ease-in-out infinite;
  }
  .pane i:nth-child(odd) { opacity: 0.4; }
  .pane i:nth-child(1) { width: 42%; }
  .pane i:nth-child(2) { width: 78%; animation-delay: 0.3s; }
  .pane i:nth-child(3) { width: 64%; margin-left: 10%; animation-delay: 0.6s; }
  .pane i:nth-child(4) { width: 86%; margin-left: 10%; animation-delay: 0.9s; }
  .pane i:nth-child(5) { width: 52%; margin-left: 10%; animation-delay: 1.2s; }
  .pane i:nth-child(6) { width: 70%; animation-delay: 1.5s; }
  .pane i:nth-child(7) { width: 34%; animation-delay: 1.8s; }
  @keyframes line-shimmer { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.85; } }
  .scan {
    position: absolute;
    left: 8%;
    right: 8%;
    height: 1px;
    background: linear-gradient(to right, transparent, var(--holo) 50%, transparent);
    filter: drop-shadow(0 0 6px var(--holo));
    animation: scan-sweep 4.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    pointer-events: none;
  }
  @keyframes scan-sweep {
    0% { top: 6%; opacity: 0; }
    12% { opacity: 0.9; }
    88% { opacity: 0.9; }
    100% { top: 94%; opacity: 0; }
  }
  .mote {
    position: absolute;
    bottom: 0;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--holo);
    opacity: 0;
    animation: mote-rise 6s linear infinite;
    pointer-events: none;
  }
  @keyframes mote-rise {
    0% { transform: translateY(0) scale(1); opacity: 0; }
    15% { opacity: 0.8; }
    80% { opacity: 0.3; }
    100% { transform: translateY(-24vmin) scale(0.4); opacity: 0; }
  }
  .plinth {
    width: clamp(120px, 18vmin, 190px);
    filter: drop-shadow(0 18px 24px rgba(0,0,0,0.55));
    position: relative;
    z-index: 1;
  }
  .plinth .cap {
    height: clamp(12px, 2vmin, 18px);
    background: linear-gradient(to bottom, var(--stone) 0%, var(--stone-shade) 100%);
    border-radius: 2px 2px 0 0;
    transform: perspective(300px) rotateX(4deg);
    box-shadow: 0 -4px 18px rgba(95, 227, 208, 0.25);
  }
  .plinth .column {
    height: clamp(130px, 24vmin, 240px);
    margin: 0 clamp(8px, 1.4vmin, 14px);
    background: linear-gradient(to right, var(--stone-dark) 0%, var(--stone-shade) 18%, var(--stone) 50%, var(--stone-shade) 82%, var(--stone-dark) 100%);
  }
  .plinth .base {
    height: clamp(14px, 2.4vmin, 22px);
    background: linear-gradient(to bottom, var(--stone-shade) 0%, var(--stone-dark) 100%);
    border-radius: 0 0 2px 2px;
  }
  .reflection {
    width: clamp(220px, 34vmin, 360px);
    height: 6vh;
    margin-top: 4px;
    background: radial-gradient(ellipse 50% 60% at 50% 0%, rgba(95, 227, 208, 0.07) 0%, transparent 70%);
  }
  .plaque {
    position: absolute;
    right: clamp(1.2rem, 5vw, 6rem);
    top: 50%;
    transform: translateY(-64%);
    width: clamp(280px, 30vw, 380px);
    background: var(--term-bg);
    border: 1px solid var(--term-edge);
    border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6);
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
    overflow: hidden;
  }
  .plaque-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.8rem;
    border-bottom: 1px solid var(--term-edge);
    background: #0a100d;
    color: var(--term-dim);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
  }
  .plaque-title .lamp {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--term-green);
    animation: lamp-pulse 2.4s ease-in-out infinite;
  }
  @keyframes lamp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  .plaque-screen {
    padding: 0.9rem 1rem 1rem;
    font-size: 0.76rem;
    line-height: 1.8;
  }
  .line { white-space: pre-wrap; word-break: break-word; opacity: 0; }
  .line.show { opacity: 1; transition: opacity 0.18s ease-out; }
  .prompt { color: var(--term-green); }
  .cmd { color: var(--term-text); }
  .out { color: var(--term-dim); }
  .url { color: var(--term-cyan); }
  .warn { color: var(--term-amber); }
  .gone { color: var(--term-red); }
  .comment { color: var(--term-dim); font-style: italic; }
  .comment a {
    color: var(--term-amber);
    text-decoration: none;
    border-bottom: 1px solid rgba(232, 196, 104, 0.4);
  }
  .comment a:hover, .comment a:focus-visible { border-bottom-color: var(--term-amber); outline: none; }
  .cursor {
    display: inline-block;
    width: 0.55em;
    height: 1.05em;
    background: var(--term-green);
    vertical-align: text-bottom;
    animation: blink 1.1s steps(1) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  .plaque-status {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.45rem 0.8rem;
    border-top: 1px solid var(--term-edge);
    background: #0a100d;
    color: var(--term-dim);
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    flex-wrap: wrap;
  }
  .plaque-status strong { color: var(--term-amber); font-weight: 600; }
  header {
    position: absolute;
    top: clamp(1.2rem, 4vh, 2.4rem);
    left: 0; right: 0;
    text-align: center;
    z-index: 3;
  }
  header h1 {
    font-size: clamp(1.6rem, 3.4vw, 2.4rem);
    letter-spacing: 0.34em;
    margin-left: 0.34em;
    font-weight: 400;
  }
  header p {
    margin-top: 0.45rem;
    color: var(--ink-dim);
    font-style: italic;
    font-size: clamp(0.82rem, 1.6vw, 0.95rem);
  }
  footer {
    text-align: center;
    padding: 1.1rem 1rem 1.5rem;
    color: var(--ink-dim);
    font-size: 0.82rem;
    letter-spacing: 0.04em;
  }
  footer a { color: var(--accent); text-decoration: none; border-bottom: 1px solid rgba(217, 185, 108, 0.35); }
  footer a:hover, footer a:focus-visible { border-bottom-color: var(--accent); outline: none; }
  @media (prefers-reduced-motion: reduce) {
    .holo { animation: none; }
    .scan, .mote { display: none; }
    .beam { animation: none; }
    .pane i { animation: none; opacity: 0.6; }
    .cursor, .plaque-title .lamp { animation: none; }
    .line { opacity: 1 !important; transition: none; }
  }
  @media (max-width: 900px) {
    body { overflow: auto; }
    .gallery { height: auto; min-height: 100vh; }
    .plaque {
      position: static;
      transform: none;
      margin: 2.4rem auto 0;
      width: min(94%, 420px);
    }
    .scene { padding-top: 8.5rem; }
  }
`;

const CODE_LINES = [1, 2, 3, 4, 5, 6, 7];
const MOTES = [
  { left: "30%", delay: "0s" },
  { left: "46%", delay: "1.3s" },
  { left: "62%", delay: "2.6s" },
  { left: "38%", delay: "3.9s" },
  { left: "70%", delay: "5.1s" },
];

function Pane() {
  return (
    <div className="pane">
      {CODE_LINES.map((n) => (
        <i key={n} />
      ))}
    </div>
  );
}

function nextGcCountdown(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const s = Math.floor((next.getTime() - now.getTime()) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

export default function Home() {
  const [countdown, setCountdown] = useState("--:--:--");
  const screenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const lines = screenRef.current?.querySelectorAll<HTMLElement>(".line") ?? [];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    lines.forEach((l, i) => {
      if (reduced) {
        l.classList.add("show");
        return;
      }
      timers.push(setTimeout(() => l.classList.add("show"), 500 + i * 450));
    });
    setCountdown(nextGcCountdown());
    const interval = setInterval(() => setCountdown(nextGcCountdown()), 1000);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="gallery">
      <style>{CSS}</style>
      <div className="light" aria-hidden="true" />
      <header>
        <h1>plnth</h1>
        <p>a plinth for machine-made pages</p>
      </header>
      <div className="scene">
        <div className="exhibit" aria-hidden="true">
          <div className="beam" />
          <div className="holo">
            <Pane />
            <Pane />
            <Pane />
          </div>
          <div className="scan" />
          {MOTES.map((m) => (
            <span key={m.left} className="mote" style={{ left: m.left, animationDelay: m.delay }} />
          ))}
        </div>
        <div className="plinth" aria-hidden="true">
          <div className="cap" />
          <div className="column" />
          <div className="base" />
        </div>
        <div className="reflection" aria-hidden="true" />

        <aside className="plaque" aria-label="exhibit label — curator's console">
          <div className="plaque-title">
            <span>EXHIBIT 7f3k9q2 — curator&apos;s console</span>
            <span className="lamp" aria-hidden="true" />
          </div>
          <div className="plaque-screen" ref={screenRef}>
            <div className="line">
              <span className="prompt">$</span> <span className="cmd">plnth create &lt; artifact.html</span>
            </div>
            <div className="line out">
              created  <span className="url">plnth.app/a/7f3k9q2</span>  <span className="warn">stands until deleted</span>
            </div>
            <div className="line">
              <span className="prompt">$</span> <span className="cmd">plnth delete 7f3k9q2</span>
            </div>
            <div className="line out">
              <span className="gone">tombstoned.</span> bytes purged within 24h.
            </div>
            <div className="line">
              <span className="prompt">$</span> <span className="cmd">whoami</span>
            </div>
            <div className="line out">a robot, mostly.</div>
            <div className="line comment">
              # the human writes at <a href="https://georgediab.com">georgediab.com</a>
            </div>
            <div className="line">
              <span className="prompt">$</span> <span className="cursor" aria-hidden="true" />
            </div>
          </div>
          <div className="plaque-status">
            <span>exhibits stand until deleted</span>
            <span>
              next gc sweep <strong>{countdown}</strong> utc
            </span>
          </div>
        </aside>
      </div>
      <footer>
        curated by <a href="https://georgediab.com">George Diab</a> · <a href="/portal">portal</a>
      </footer>
    </div>
  );
}
