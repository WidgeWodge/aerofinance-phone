// Shows the last summary the PC sent, and links this phone to the PC.
// Everything shown is stored on this phone; nothing is fetched from anywhere when it opens.

const $ = (id) => document.getElementById(id);
const DATA = 'aerofinance-data';
const money = (n) => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : null);
const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function readCached(name) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(DATA);
  const res = await cache.match(`./${name}`);
  return res ? res.json() : null;
}

function showSnapshot(s) {
  const ageHours = (Date.now() - new Date(s.at).getTime()) / 3600000;
  const synced = $('synced');
  synced.textContent = `Last synced: ${stamp(s.at)}${ageHours > 36 ? ` (${Math.floor(ageHours / 24)} day${ageHours >= 48 ? 's' : ''} ago)` : ''}`;
  synced.classList.toggle('old', ageHours > 36);

  const short = s.safe < 0;
  $('weeklyLabel').textContent = short ? 'Short before payday' : 'Spare, per week';
  $('weekly').textContent = money(short ? Math.abs(s.safe) : s.weekly);
  $('weekly').className = `big ${short ? 'short' : 'good'}`;
  $('spentWeek').textContent = money(s.spentWeek);
  $('safeLabel').textContent = short ? 'Short by' : 'Left until payday';
  $('safe').textContent = money(Math.abs(s.safe));
  $('safe').className = `val ${short ? 'short' : ''}`;
  $('payBox').hidden = !s.pay;
  $('pay').textContent = s.pay ? `${day(s.pay)}${s.payAmount ? ` · ${money(s.payAmount)}` : ''}` : '';

  const next = s.next;
  $('nextLine').hidden = !next;
  if (next) $('nextLine').textContent = next.safe >= 0
    ? `After payday: about ${money(next.weekly)} a week until ${day(next.pay) || 'the following pay'}.`
    : `After payday: about ${money(Math.abs(next.safe))} short before the following pay.`;
  $('noteLine').hidden = !s.note;
  $('noteLine').textContent = s.note || '';

  const list = $('bills');
  list.replaceChildren();
  (s.bills || []).forEach(b => {
    const li = document.createElement('li');
    const left = document.createElement('div');
    left.textContent = b.n;
    const when = document.createElement('span');
    when.className = `when${b.late ? ' late' : ''}`;
    when.textContent = b.late ? `Late, was due ${day(b.d)}` : b.d ? `Due ${day(b.d)}` : 'Date not known yet';
    left.appendChild(when);
    const amt = document.createElement('span');
    amt.className = 'amt';
    amt.textContent = money(b.a);
    li.append(left, amt);
    list.appendChild(li);
  });
  if (!(s.bills || []).length) {
    const li = document.createElement('li');
    li.textContent = 'Nothing left to pay before payday.';
    list.appendChild(li);
  }
  $('billsTotal').textContent = money(s.billsTotal);
  $('figures').hidden = false;
}

async function render() {
  const [snapshot, relink] = await Promise.all([readCached('snapshot.json'), readCached('relink.json')]);
  if (snapshot) showSnapshot(snapshot);
  const needsSetup = !snapshot || relink;
  $('setup').hidden = !needsSetup;
  $('showSetup').hidden = needsSetup;
  if (!snapshot) $('synced').textContent = relink ? 'Needs linking again' : 'Not linked yet';
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  $('installHint').hidden = standalone;
}

function urlKey(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
const toCode = (sub) => btoa(unescape(encodeURIComponent(JSON.stringify(sub.toJSON())))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function link() {
  $('setupError').hidden = true;
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser can\'t receive updates. Open the app in Chrome.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications are needed for updates to arrive. Allow them in the phone\'s settings for this app, then try again.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // A link made with a different PC key can't be used, so start a fresh one.
    const wanted = urlKey(self.AEROFINANCE_KEY);
    const current = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    if (sub && current && (current.length !== wanted.length || current.some((b, i) => b !== wanted[i]))) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
    $('code').value = toCode(sub);
    $('codeBox').hidden = false;
    $('shareBtn').hidden = !navigator.share;
    const cache = await caches.open(DATA);
    await cache.delete('./relink.json');
  } catch (err) {
    $('setupError').textContent = err.message;
    $('setupError').hidden = false;
  }
}

$('linkBtn').addEventListener('click', link);
$('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('code').value);
    $('copyBtn').textContent = 'Copied';
  } catch {
    $('code').select();
  }
});
$('shareBtn').addEventListener('click', () => navigator.share({ title: 'AeroFinance phone code', text: $('code').value }).catch(() => {}));
$('showSetup').addEventListener('click', () => {
  $('setup').hidden = false;
  $('showSetup').hidden = true;
  $('setup').scrollIntoView({ behavior: 'smooth' });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (event) => { if (event.data?.type === 'snapshot') render(); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
render();
