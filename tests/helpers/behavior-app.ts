import type { FileMap } from './repo.ts';

/**
 * A tiny static app for behavior diffs: clicking "Load" fetches /items.json. At head the file is
 * gone, so the same request answers 404 and the page logs one new console error. The page also
 * sends a session id in the URL and logs a token-shaped string, which no artifact may contain.
 */

const TOKEN_TAIL = 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';

// Assembled at runtime, so no secret scanner (or Covi) flags this file.
export const BEHAVIOR_SECRETS = {
  session: 'sess-4f9c2a7b1e',
  token: ['ghp', '_', TOKEN_TAIL].join(''),
};

export const BEHAVIOR_FLOWS = [
  {
    name: 'Load items',
    path: '/',
    steps: [{ click: '#load', note: 'Load the items' }, { wait: 300 }],
  },
];

/** Works only at head, where the Retry button exists: base fails at its step. */
export const RETRY_FLOW = { name: 'Retry', path: '/', steps: [{ click: '#retry', note: 'Retry' }] };

export const BEHAVIOR_CONFIG = {
  app: { static: '.' },
  demo: { viewports: ['desktop'], flows: BEHAVIOR_FLOWS },
};

const index = (extra: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Items</title>
  <style>body{font:16px/1.4 sans-serif;margin:40px}li{padding:4px 0}#status{color:#b00020}</style>
</head>
<body>
  <h1>Items</h1>
  <button id="load">Load</button>${extra}
  <ul id="list"></ul>
  <p id="status" role="alert"></p>
  <script src="app.js"></script>
</body>
</html>
`;

const render = `  const items = await response.json();
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    document.getElementById('list').appendChild(li);
  }`;

export const BEHAVIOR_APP: { base: FileMap; head: FileMap } = {
  base: {
    '.covi/config.yml': [
      'app:',
      '  static: .',
      'demo:',
      '  viewports: [desktop]',
      '  flows:',
      '    - name: Load items',
      '      path: /',
      '      steps:',
      '        - click: "#load"',
      '          note: Load the items',
      '        - wait: 300',
      '',
    ].join('\n'),
    'index.html': index(''),
    'items.json': '["Apples", "Pears"]\n',
    'app.js': `const SESSION = '${BEHAVIOR_SECRETS.session}';
document.getElementById('load').addEventListener('click', async () => {
  const response = await fetch('/items.json?session=' + SESSION);
${render}
});
`,
  },
  head: {
    'index.html': index('\n  <button id="retry">Retry</button>'),
    'items.json': null,
    'app.js': `const SESSION = '${BEHAVIOR_SECRETS.session}';
const TOKEN = ['ghp', '_', '${TOKEN_TAIL}'].join('');
document.getElementById('load').addEventListener('click', async () => {
  const response = await fetch('/items.json?session=' + SESSION);
  if (!response.ok) {
    console.error('Could not load items: HTTP ' + response.status);
    console.info('debug token ' + TOKEN);
    document.getElementById('status').textContent = 'Could not load items.';
    return;
  }
${render}
});
document.getElementById('retry').addEventListener('click', () => {
  document.getElementById('status').textContent = '';
});
`,
  },
};
