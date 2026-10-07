const checks = [];
const errors = [];
const equal = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({name, pass, actual, expected});
};
window.addEventListener('error', (event) => errors.push({kind: 'pageerror', message: event.message}));
window.addEventListener('unhandledrejection', (event) => errors.push({kind: 'unhandledrejection', message: String(event.reason)}));
const consoleCalls = [];
for (const level of ['error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    consoleCalls.push({level, message: args.map(String).join(' ')});
    original(...args);
  };
}
window.smoke = {done: false};
try {
  const revision = await import('./revision.js');
  const baseline = await import('./baseline.js');
  const cues = (words) => words.map((text, index) => ({startMs: index * 450, durationMs: 500, text}));
  const cases = [
    ['AI sentence', ['It', 'works', 'today.', 'AI', 'is', 'useful.'],
      [{startMs: 0, durationMs: 1400, text: 'It works today.'}, ...cues(['It', 'works', 'today.', 'AI', 'is', 'useful.']).slice(3)]],
    ['apostrophe s', ['it', "'s", 'a', 'test.'], [{startMs: 0, durationMs: 1850, text: "it's a test."}]],
    ['U.S. sentence', ['I', 'live', 'in', 'U.S.', 'We', 'agree.'],
      [{startMs: 0, durationMs: 1850, text: 'I live in U.S.'}, ...cues(['I', 'live', 'in', 'U.S.', 'We', 'agree.']).slice(4)]],
    ['number sentence', ['I', 'chose', '1.', '2', 'was', 'wrong.'],
      [{startMs: 0, durationMs: 1400, text: 'I chose 1.'}, ...cues(['I', 'chose', '1.', '2', 'was', 'wrong.']).slice(3)]],
    ['negative t', ['don', "'t", 'do', 'that.'], [{startMs: 0, durationMs: 1850, text: "don't do that."}]],
    ['suffix comma continuation', ['we', "'re, in", 'fact, ready', 'today.'],
      [{startMs: 0, durationMs: 1850, text: "we're, in fact, ready today."}]],
    ['title', ['Dr.', 'Smith', 'is', 'here.'], [{startMs: 0, durationMs: 1850, text: 'Dr. Smith is here.'}]],
    ['true quote', ['we', 'say', "'ready'", 'now.'], [{startMs: 0, durationMs: 1850, text: "we say 'ready' now."}]],
    ['quoted suffix comma', ['we', 'say', "'s,'", 'now.'], [{startMs: 0, durationMs: 1850, text: "we say 's,' now."}]],
    ['composed accents', ['café', 'déjà', 'très', 'bien.'], [{startMs: 0, durationMs: 1850, text: 'café déjà très bien.'}]],
    ['decomposed accents', ['cafe\u0301', 'de\u0301ja\u0300', 'très', 'bien.'],
      [{startMs: 0, durationMs: 1850, text: 'cafe\u0301 de\u0301ja\u0300 très bien.'}]],
    ['Chinese mixed', ['今天', '学习', 'TypeScript', '字幕。'], [{startMs: 0, durationMs: 1850, text: '今天学习TypeScript字幕。'}]],
  ];
  for (const [name, words, expected] of cases) {
    const raw = cues(words);
    const actual = revision.finalizeVideoSubtitleCues(raw);
    equal(name + ': exact cues', actual, expected);
    equal(name + ': idempotence', revision.finalizeVideoSubtitleCues(actual), expected);
    equal(name + ': SRT stability', revision.cuesToSrt(raw), revision.cuesToSrt(actual));
    const timestamp = (ms) => new Date(ms).toISOString().slice(11, 23).replace('.', ',');
    const exactSrt = expected.map((cue, index) => `${index + 1}\n${timestamp(cue.startMs)} --> ${timestamp(cue.startMs + cue.durationMs)}\n${cue.text}\n`).join('\n');
    equal(name + ': exact SRT', revision.cuesToSrt(raw), exactSrt);
  }
  const parserDescriptor = Object.getOwnPropertyDescriptor(window, 'DOMParser');
  const originalParser = window.DOMParser;
  const parseBoth = (module, source) => {
    const dom = module.parseYoutubeTimedTextResponse(source);
    let regex;
    try {
      Object.defineProperty(window, 'DOMParser', {value: undefined, configurable: true, writable: true});
      regex = module.parseYoutubeTimedTextResponse(source);
    } finally {
      if (parserDescriptor) Object.defineProperty(window, 'DOMParser', parserDescriptor);
      else delete window.DOMParser;
    }
    return {dom, regex};
  };
  const xmlCases = [
    ['valid XML', '<transcript><text start="1.5" dur="2">Hello &amp; welcome</text></transcript>',
      [{startMs: 1500, durationMs: 2000, text: 'Hello & welcome'}]],
    ['missing duration XML', '<transcript><text start="1">A complete first cue</text><text start="3">A complete final cue</text></transcript>',
      [{startMs: 1000, durationMs: 0, text: 'A complete first cue'}, {startMs: 3000, durationMs: 0, text: 'A complete final cue'}]],
    ['invalid XML times', '<transcript><text dur="1">missing</text><text start="-1">negative</text><text start="">empty</text><text start="NaN">nan</text><text start="1" dur="Infinity">infinite</text><text start="1" dur="">empty duration</text><text start="2" dur="1">valid</text></transcript>',
      [{startMs: 2000, durationMs: 1000, text: 'valid'}]],
    ['XML entities', '<transcript><text start="0" dur="1">A &amp; B &quot;quoted&quot; &#39;word&#39;</text></transcript>',
      [{startMs: 0, durationMs: 1000, text: `A & B "quoted" 'word'`}]],
  ];
  for (const [name, source, expected] of xmlCases) {
    const actual = parseBoth(revision, source);
    equal(name + ': native DOMParser', actual.dom, expected);
    equal(name + ': regex', actual.regex, expected);
    equal(name + ': parity', actual.dom, actual.regex);
    equal(name + ': parser restored', window.DOMParser === originalParser, true);
  }
  const jsonSource = JSON.stringify({events: [
    {tStartMs: 0, dDurationMs: 500, segs: [{utf8: 'Hel'}, {utf8: 'lo '}, {utf8: 'world'}]},
    {tStartMs: 1200, segs: [{utf8: '中文'}, {utf8: 'Type'}, {utf8: 'Script'}]},
    {tStartMs: null, dDurationMs: 500, segs: [{utf8: 'invalid null'}]},
    {tStartMs: '', dDurationMs: 500, segs: [{utf8: 'invalid empty'}]},
    {tStartMs: -1, segs: [{utf8: 'invalid negative'}]},
    {tStartMs: 2000, dDurationMs: 'Infinity', segs: [{utf8: 'invalid duration'}]},
  ]});
  const parsed = revision.parseYoutubeTimedTextResponse(jsonSource);
  equal('JSON3 raw segments and timing', parsed, [
    {startMs: 0, durationMs: 500, text: 'Hello world'}, {startMs: 1200, durationMs: 0, text: '中文TypeScript'},
  ]);
  equal('JSON3 missing duration fallback', revision.finalizeVideoSubtitleCues(parsed), [
    {startMs: 0, durationMs: 500, text: 'Hello world'}, {startMs: 1200, durationMs: 2000, text: '中文TypeScript'},
  ]);
  const escaped = '<transcript><text start="1" dur="2">&lt;hello&gt;</text></transcript>';
  const escapedTagComparison = {baseline: parseBoth(baseline, escaped), revision: parseBoth(revision, escaped)};
  equal('escaped tag-looking XML baseline/revision DOM behavior', escapedTagComparison.revision.dom, escapedTagComparison.baseline.dom);
  equal('escaped tag-looking XML baseline/revision regex behavior', escapedTagComparison.revision.regex, escapedTagComparison.baseline.regex);
  equal('DOMParser final restored', window.DOMParser === originalParser, true);
  window.smoke = {done: true, scope: 'Real browser pure-module smoke only; no extension injection, YouTube capture, player UI, GPU or ASR',
    moduleVersions: {revision: 'current working source', baseline: '83deca40091415666fc8fe5a45579b6b80487dcb'},
    checks, errors, consoleCalls, escapedTagComparison,
    passed: checks.every((check) => check.pass) && errors.length === 0 && consoleCalls.length === 0};
} catch (error) {
  errors.push({kind: 'smoke exception', message: String(error), stack: error.stack});
  window.smoke = {done: true, passed: false, checks, errors, consoleCalls};
}
