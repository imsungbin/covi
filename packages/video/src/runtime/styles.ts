import type { SyntaxColors } from '@covi/brand';
import type { Timeline } from '../timeline/types.ts';
import type { Regions } from './layout.ts';

/** Token colors for highlighted code under `scope` (empty: everywhere). */
function syntaxRules(scope: string, c: SyntaxColors): string {
  return [
    `${scope}.tk-keyword { color: ${c.keyword}; } ${scope}.tk-string { color: ${c.string}; }`,
    `${scope}.tk-number { color: ${c.number}; } ${scope}.tk-comment { color: ${c.comment}; font-style: italic; }`,
    `${scope}.tk-fn { color: ${c.fn}; } ${scope}.tk-type { color: ${c.type}; } ${scope}.tk-prop { color: ${c.prop}; }`,
  ].join('\n');
}

/**
 * Line breaking and spacing for CJK text: Korean breaks between words, never inside one; Japanese
 * and Chinese follow strict line-break rules; wide letter-spacing meant for Latin capitals is
 * tightened, since CJK has no capitals.
 */
function languageRules(t: Timeline): string {
  if (t.language === 'en' || !t.language) return '';
  return [
    '/* Language */',
    t.language === 'ko'
      ? '#stage { word-break: keep-all; overflow-wrap: anywhere; }'
      : '#stage { line-break: strict; overflow-wrap: anywhere; }',
    '.eyebrow, .stat .k { letter-spacing: 0.04em; }',
    '.title-text, .heading { letter-spacing: 0; }',
  ].join('\n');
}

/** The composition stylesheet, derived from the theme and the layout unit. */
export function stylesheet(t: Timeline, r: Regions): string {
  const c = t.theme;
  const u = (n: number) => `${(n * r.unit).toFixed(2)}px`;
  const vertical = t.orientation === 'vertical';
  const eyebrow = vertical ? 26 : 21;
  const heading = vertical ? 50 : 42;
  const dot = c.name === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(31,36,48,0.055)';
  return `
* { box-sizing: border-box; margin: 0; padding: 0; transition: none !important; animation: none !important; }
html, body { width: ${t.width}px; height: ${t.height}px; overflow: hidden; background: ${c.background}; }
#stage { position: relative; width: ${t.width}px; height: ${t.height}px; overflow: hidden; background-color: ${c.background};
  background-image: radial-gradient(circle at 1px 1px, ${dot} 1.2px, transparent 0); background-size: ${u(30)} ${u(30)};
  font-family: ${t.fonts.sans}; color: ${c.text}; -webkit-font-smoothing: antialiased; font-feature-settings: 'cv11', 'ss01'; }
.mono { font-family: ${t.fonts.mono}; font-feature-settings: 'calt' 0; }
.layer { position: absolute; inset: 0; }
.scene { position: absolute; inset: 0; will-change: opacity, transform; }
.scene-header { position: absolute; display: flex; flex-direction: column; justify-content: flex-end; gap: ${u(10)}; }
.eyebrow { display: inline-flex; align-items: center; gap: ${u(12)}; color: ${c.primary}; font-weight: 700; font-size: ${u(eyebrow)};
  letter-spacing: 0.13em; text-transform: uppercase; }
.eyebrow::before { content: ''; width: ${u(12)}; height: ${u(12)}; border-radius: 50%; background: ${c.primary}; }
.heading { font-weight: 720; font-size: ${u(heading)}; line-height: 1.14; letter-spacing: -0.015em; color: ${c.text};
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.media { position: absolute; }

.progress { position: absolute; display: flex; gap: ${u(6)}; }
.progress .seg { position: relative; flex: 1 1 0; height: 100%; border-radius: 99px; background: ${c.line}; overflow: hidden; }
.progress .fill { position: absolute; inset: 0; transform-origin: left center; background: ${c.primary}; border-radius: 99px; }

.narrator { position: absolute; will-change: transform, opacity; filter: drop-shadow(0 ${u(6)} ${u(14)} rgba(31,36,48,0.18)); }
.narrator svg { width: 100%; height: 100%; display: block; overflow: visible; }

.captions { position: absolute; display: flex; justify-content: center; align-items: flex-start; pointer-events: none; }
.caption-box { display: inline-block; max-width: 100%; background: ${c.captionBackground}; color: ${c.captionText};
  border-radius: ${u(22)}; padding: ${u(vertical ? 16 : 12)} ${u(vertical ? 30 : 26)}; font-weight: 640;
  font-size: ${r.captionFont.toFixed(2)}px; line-height: 1.26; text-align: center; letter-spacing: -0.005em;
  box-shadow: 0 ${u(8)} ${u(28)} rgba(0,0,0,0.18); }
.caption-box .line { display: block; white-space: nowrap; }

.chip { display: inline-flex; align-items: center; gap: ${u(8)}; padding: ${u(7)} ${u(16)}; border-radius: 999px; font-weight: 650;
  font-size: ${u(vertical ? 22 : 18)}; line-height: 1.1; white-space: nowrap; }
.chip.primary { background: ${c.primary}; color: #fff; }
.chip.soft { background: ${c.primarySoft}; color: ${c.primary}; }
.chip.muted { background: ${c.surface}; color: ${c.textMuted}; border: 1px solid ${c.line}; }

.card { background: ${c.surface}; border: 1px solid ${c.line}; border-radius: ${u(22)}; box-shadow: ${c.shadow}; }

/* Title */
.title-wrap { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: ${u(26)}; }
.title-panel { display: flex; flex-direction: column; align-items: center; gap: ${u(26)}; max-width: 100%; }

/* Outro */
.outro { position: absolute; inset: 0; }
.outro-fox { position: absolute; transform-origin: 50% 96%; }
.outro-word { position: absolute; display: block; }
.outro-fox svg { width: 100%; height: 100%; display: block; overflow: visible; }
.outro-row { position: absolute; display: flex; align-items: center; gap: ${u(20)}; white-space: nowrap; }
.outro-line { color: ${c.textMuted}; font-weight: 560; letter-spacing: -0.005em; }
.title-text { font-weight: 780; letter-spacing: -0.025em; line-height: 1.08; color: ${c.text}; }
.title-sub { color: ${c.textMuted}; font-weight: 500; line-height: 1.35; }
.title-meta { display: flex; gap: ${u(12)}; flex-wrap: wrap; justify-content: center; }

/* Frames */
.frame { position: absolute; overflow: hidden; background: ${c.surface}; border: 1px solid ${c.line}; border-radius: ${u(18)}; box-shadow: ${c.shadow}; }
.frame .chrome { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: ${u(8)}; padding: 0 ${u(14)};
  background: ${c.name === 'dark' ? '#262C3A' : '#EEF1F6'}; border-bottom: 1px solid ${c.line}; }
.frame .chrome i { width: ${u(11)}; height: ${u(11)}; border-radius: 50%; background: ${c.line}; display: block; }
.frame .chrome .url { margin-left: ${u(10)}; flex: 1; height: 62%; border-radius: 99px; background: ${c.surface}; color: ${c.textMuted};
  font-size: ${u(15)}; display: flex; align-items: center; padding: 0 ${u(14)}; white-space: nowrap; overflow: hidden; }
.frame .viewport { position: absolute; left: 0; right: 0; bottom: 0; overflow: hidden; }
.frame img { position: absolute; left: 0; top: 0; transform-origin: 0 0; display: block; }
.frame-label { position: absolute; z-index: 3; }
.focus-ring { position: absolute; border: ${u(4)} solid ${c.primary}; border-radius: ${u(12)}; box-shadow: 0 0 0 ${u(6)} rgba(59,91,255,0.18); }
.dim { position: absolute; background: rgba(18, 21, 28, 0.42); }
.cursor { position: absolute; width: ${u(34)}; height: ${u(34)}; z-index: 5; filter: drop-shadow(0 ${u(3)} ${u(6)} rgba(0,0,0,0.3)); }
.ripple { position: absolute; border-radius: 50%; border: ${u(4)} solid ${c.primary}; z-index: 4; }

/* Hero accent */
.hero-accent { pointer-events: none; }
.hero-accent .flash { position: absolute; background: #FFFFFF; opacity: 0; }
.hero-accent .ring { position: absolute; border-radius: 50%; border: ${u(6)} solid ${c.primary}; opacity: 0; }

/* Code */
.code { position: absolute; overflow: hidden; background: ${c.codeBackground}; border-radius: ${u(20)}; box-shadow: ${c.shadow}; color: ${c.codeText}; }
.code .code-head { display: flex; align-items: center; gap: ${u(12)}; padding: ${u(16)} ${u(22)}; border-bottom: 1px solid rgba(255,255,255,0.07);
  font-size: ${u(vertical ? 22 : 18)}; color: ${c.codeMuted}; }
.code .code-head .file { color: ${c.codeText}; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.code .code-head .dot { width: ${u(12)}; height: ${u(12)}; border-radius: 50%; background: ${c.primary}; flex: none; }
.code .lines { padding: ${u(14)} 0; }
.code .ln { position: relative; display: flex; white-space: pre; line-height: 1.55; }
.code .ln .gutter { width: 3.6em; flex: none; text-align: right; padding-right: 1em; color: ${c.codeMuted}; opacity: 0.8; }
.code .ln .mark { width: 1.3em; flex: none; color: ${c.codeMuted}; }
.code .ln .txt { overflow: hidden; text-overflow: ellipsis; padding-right: 1em; }
.code .ln.add { background: ${c.addBackground}; }
.code .ln.add .mark { color: ${c.addText}; }
.code .ln.del { background: ${c.delBackground}; }
.code .ln.del .mark { color: ${c.delText}; }
.code .ln.del .txt { opacity: 0.75; }
.code .ln .hl { position: absolute; inset: 0; border-left: ${u(5)} solid ${c.primary}; background: rgba(59,91,255,0.22); transform-origin: left center; }
${syntaxRules('', c.syntax)}
${syntaxRules('.api-panel ', c.surfaceSyntax)}

/* Terminal */
.term { position: absolute; overflow: hidden; background: #0F1218; border-radius: ${u(18)}; box-shadow: ${c.shadow}; color: #E6E9F2; }
.term .term-head { display: flex; align-items: center; gap: ${u(8)}; padding: ${u(12)} ${u(16)}; background: #1A1F29; font-size: ${u(16)}; color: #8B93A7; }
.term .term-head i { width: ${u(11)}; height: ${u(11)}; border-radius: 50%; display: block; }
.term .term-head .label { margin-left: ${u(8)}; font-weight: 600; }
.term .term-body { padding: ${u(16)} ${u(20)}; white-space: pre; line-height: 1.5; }
.term .prompt { color: #7CF0B4; }
.term .cmd { color: #FFFFFF; font-weight: 600; }
.term .out { color: #C9CFDC; }

/* Findings */
.finding { position: absolute; display: flex; overflow: hidden; }
.finding .bar { width: ${u(10)}; flex: none; }
.finding .body { padding: ${u(20)} ${u(26)}; display: flex; flex-direction: column; gap: ${u(10)}; min-width: 0; }
.finding .meta { display: flex; gap: ${u(10)}; align-items: center; flex-wrap: wrap; }
.finding .ftitle { font-weight: 700; line-height: 1.22; color: ${c.text}; }
.finding .loc { color: ${c.textMuted}; }
.finding .note { color: ${c.textMuted}; line-height: 1.35; }

/* Change map */
.area-row { position: absolute; display: flex; align-items: center; gap: ${u(18)}; }
.area-row .name { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.area-row .bars { position: relative; flex: 1; height: ${u(18)}; display: flex; gap: ${u(4)}; }
.area-row .bars .plus { background: ${c.success}; border-radius: 99px; transform-origin: left center; }
.area-row .bars .minus { background: ${c.danger}; border-radius: 99px; transform-origin: left center; }
.area-row .nums { white-space: nowrap; color: ${c.textMuted}; font-variant-numeric: tabular-nums; }

/* Callout and summary */
.callout { position: absolute; display: flex; flex-direction: column; align-items: center; text-align: center; gap: ${u(18)}; padding: ${u(46)}; }
.callout .icon { border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; }
.callout .ctitle { font-weight: 760; line-height: 1.15; letter-spacing: -0.01em; }
.callout .cbody { color: ${c.textMuted}; line-height: 1.4; }
.summary-points { display: flex; flex-direction: column; gap: ${u(16)}; }
.summary-point { display: flex; gap: ${u(14)}; align-items: flex-start; line-height: 1.3; }
.summary-point .tick { flex: none; border-radius: 50%; background: ${c.primarySoft}; color: ${c.primary}; display: flex; align-items: center; justify-content: center; font-weight: 800; }
.stat { display: flex; flex-direction: column; gap: ${u(4)}; }
.stat .v { font-weight: 780; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.stat .k { color: ${c.textMuted}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; }

/* API */
.api-req { position: absolute; display: flex; align-items: center; gap: ${u(14)}; }
.api-req .method { background: ${c.primary}; color: #fff; font-weight: 800; border-radius: ${u(10)}; padding: ${u(8)} ${u(14)}; }
.api-req .path { font-weight: 650; }
.api-panel { position: absolute; display: flex; flex-direction: column; overflow: hidden; }
.api-panel .api-head { display: flex; align-items: center; justify-content: space-between; padding: ${u(14)} ${u(20)}; border-bottom: 1px solid ${c.line}; }
.api-panel pre { padding: ${u(14)} ${u(20)}; line-height: 1.5; white-space: pre; overflow: hidden; color: ${c.text}; }
.api-panel pre .add { background: ${c.surfaceAdd}; display: block; margin: 0 -${u(20)}; padding: 0 ${u(20)}; }
.api-panel pre .del { background: ${c.surfaceDel}; display: block; margin: 0 -${u(20)}; padding: 0 ${u(20)}; }
.status { font-weight: 800; border-radius: 99px; padding: ${u(5)} ${u(12)}; }

${languageRules(t)}

/* Diagram */
.node { position: absolute; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: ${u(6)};
  border-radius: ${u(18)}; border: ${u(3)} solid ${c.line}; background: ${c.surface}; padding: ${u(12)}; }
.node.changed { border-color: ${c.primary}; background: ${c.primarySoft}; }
.node .nlabel { font-weight: 700; line-height: 1.15; word-break: break-word; }
.node .ndetail { color: ${c.textMuted}; }
`;
}
