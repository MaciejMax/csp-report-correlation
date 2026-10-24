const $ = id => document.getElementById(id);
let previousData = null;
let loading = false;
let clearing = false;
const formatTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const formatDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function renderEvent(entry, rowStates, delays, scriptsByToken) {
  const isScript = entry.type === 'script-served';
  const isCSP = entry.type === 'csp-frame-ancestors';
  const report = entry.report?.['csp-report'] || {};
  const row = element('details');
  row.dataset.key = JSON.stringify([entry.timestamp, entry.type, entry.token, entry.clientKey]);
  row.open = rowStates.has(row.dataset.key) ? rowStates.get(row.dataset.key) : true;
  const summary = element('summary');
  const date = new Date(entry.isoTime || entry.timestamp);
  const validDate = Number.isFinite(date.getTime());
  const time = element('time', validDate ? formatTime.format(date) : 'No time');
  if (validDate) { time.dateTime = date.toISOString(); time.title = formatDate.format(date); }
  const info = element('div');
  info.append(element('span', isScript ? 'Script served' : isCSP ? 'CSP violation report received' : 'Report received', 'event-title'));
  info.append(element('span', isScript ? 'Client key: ' + (entry.clientKey || '—') + ' · Referrer: ' + (entry.referrer || 'none') : isCSP ? 'Directive: ' + (report['effective-directive'] || report['violated-directive'] || '—') + ' · Referrer: ' + (entry.referrer || 'none') : 'Type: ' + entry.type, 'event-info'));
  summary.append(time, info, element('span', isScript ? 'GET · Script' : isCSP ? 'POST · CSP report' : 'POST · Report', 'badge' + (isScript ? ' script' : '')));
  row.append(summary);
  if (entry.token) row.append(element('p', 'Correlation token: ' + entry.token, 'hint'));
  if (delays.has(entry)) row.append(element('p', 'Received ' + delays.get(entry) + ' ms after serving the script with the same nonce. Client key: ' + scriptsByToken.get(entry.token).clientKey, 'hint'));
  else if (isCSP) row.append(element('p', 'No script with the same nonce in the stored events. Correlation timing is unavailable.', 'hint'));
  row.append(element('pre', JSON.stringify(entry, null, 2)));
  return row;
}

function render(reports) {
  const rowStates = new Map([...$('events').querySelectorAll('details')].map(row => [row.dataset.key, row.open]));
  const delays = new Map();
  const scriptsByToken = new Map(reports
    .filter(entry => entry.type === 'script-served' && entry.token?.startsWith('tracking_correlation_nonce_'))
    .map(entry => [entry.token, entry]));
  for (const entry of reports) {
    const script = scriptsByToken.get(entry.token);
    if (entry.type === 'csp-frame-ancestors' && script) {
      const delay = entry.timestamp - script.timestamp;
      if (Number.isFinite(delay) && delay >= 0) delays.set(entry, delay);
    }
  }
  $('scripts').textContent = reports.filter(r => r.type === 'script-served').length;
  $('violations').textContent = reports.filter(r => r.type === 'csp-frame-ancestors').length;
  const fragment = document.createDocumentFragment();
  const groups = new Map();
  for (const entry of reports) {
    const key = typeof entry.token === 'string' && entry.token.startsWith('tracking_correlation_nonce_')
      ? entry.token : entry;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  if (!reports.length) {
    const empty = element('div', undefined, 'empty');
    empty.append(element('strong', 'No events yet'), element('p', 'Click “Open demo” to trigger a CSP violation and receive a report.'));
    fragment.append(empty);
  }
  let groupNumber = groups.size;
  for (const entries of groups.values()) {
    const card = element('section', undefined, 'correlation');
    const head = element('div', undefined, 'correlation-head');
    const script = entries.find(entry => entry.type === 'script-served');
    const matchedReports = entries.filter(entry => delays.has(entry));
    const token = entries[0].token;
    head.append(element('h3', 'Correlation ' + groupNumber-- + (script ? ' · ' + script.clientKey : ' · no matching script')));
    head.append(element('p', matchedReports.length
      ? 'Script GET → CSP report POST · ' + Math.min(...matchedReports.map(entry => delays.get(entry))) + ' ms to first report · Reports: ' + matchedReports.length
      : script ? 'Script GET → waiting for a CSP report' : 'No script with a matching nonce in the stored events.', 'correlation-flow'));
    if (token) head.append(element('code', 'Shared token: ' + token, 'correlation-token'));
    card.append(head);
    for (const entry of [...entries].sort((a, b) => a.timestamp - b.timestamp)) {
      card.append(renderEvent(entry, rowStates, delays, scriptsByToken));
    }
    fragment.append(card);
  }
  $('events').replaceChildren(fragment);
}

async function loadReports() {
  if (loading || clearing) return;
  loading = true;
  try {
    const response = await fetch('/api/reports', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const reports = await response.json();
    if (!Array.isArray(reports)) throw new Error('Invalid report data');
    const serialized = JSON.stringify(reports);
    if (serialized !== previousData) { render(reports); previousData = serialized; }
    $('status').textContent = 'Last updated: ' + formatTime.format(new Date());
    $('status').className = '';
  } catch {
    $('status').textContent = 'Unable to load events. Check that the server is running.';
    $('status').className = 'error';
  } finally { loading = false; }
}

$('refresh').addEventListener('click', loadReports);
$('clear').addEventListener('click', async () => {
  if (loading || clearing) return;
  clearing = true;
  $('clear').disabled = true;
  try {
    const response = await fetch('/api/reports', { method: 'DELETE' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    render([]); previousData = '[]';
    $('status').textContent = 'Events cleared.';
    $('status').className = '';
  } catch {
    $('status').textContent = 'Unable to clear events.';
    $('status').className = 'error';
  } finally { clearing = false; $('clear').disabled = false; }
});
loadReports();
setInterval(loadReports, 2000);
