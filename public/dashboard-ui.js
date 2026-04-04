/**
 * dashboard-ui.js
 * Lógica de UI do dashboard: mock data, countdown, sparklines,
 * confluência de sinais, odds history chart.
 * Compatível com app.js (complementar, não conflita).
 */

/* ════════════════════════════════════════════════
   ESTADO MOCK — substitua pelos dados reais do SSE
   ════════════════════════════════════════════════ */
const state = {
  event: {
    slug: 'btc-updown-15m-1775340000',
    targetPrice: 67345,
    upOdds: 0.58,
    downOdds: 0.41,
    volume: 4339,
    timeRemaining: 652,   // segundos
    timeframe: '15min',
    startTime: Date.now()
  },
  indicators: {
    rsi:       { value: 55.2,  signal: 'BUY',     history: [] },
    macd:      { value: -3.2,  signalLine: -2.8,  signal: 'SELL', history: [] },
    vwap:      { value: 67324, signal: 'BUY',     history: [] },
    heikenAshi:{ value: 'green x3',               signal: 'BUY',  history: [] }
  },
  priceHistory: [],          // { time, price, macdHist }
  forecast: { long: 77, short: 23 },
  signalHistory: [],         // { time, signal, result }
  oddsHistory:   [],         // [{ up, down }]
  lastUpdateTs:  Date.now(),
  totalTimeSeconds: 652
};

/* ════════════════════════════════════════════════
   INICIALIZAÇÃO DO HISTÓRICO MOCK
   ════════════════════════════════════════════════ */
(function initMockHistory() {
  const base = 67200;
  for (let i = 30; i >= 0; i--) {
    const price = base + (Math.random() - 0.48) * 400 * (30 - i) / 10;
    const macdHist = (Math.random() - 0.5) * 8;
    const t = new Date(Date.now() - i * 30000);
    const label = t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    state.priceHistory.push({ time: label, price: +price.toFixed(2), macdHist: +macdHist.toFixed(2) });
  }

  for (let k = 0; k < 10; k++) {
    const up   = 0.48 + (Math.random() - 0.5) * 0.2;
    const down = +(1 - up).toFixed(2);
    state.oddsHistory.push({ up: +up.toFixed(2), down });
  }

  for (let j = 0; j < 10; j++) {
    state.indicators.rsi.history.push(+(48 + Math.random() * 18).toFixed(1));
    state.indicators.macd.history.push(+((Math.random() - 0.5) * 10).toFixed(2));
    state.indicators.vwap.history.push(+(67100 + Math.random() * 500).toFixed(0));
    state.indicators.heikenAshi.history.push(Math.random() > 0.4 ? 1 : 0);
  }

  const sigs = ['LONG','SHORT'];
  const res  = ['win','loss'];
  for (let s = 0; s < 5; s++) {
    state.signalHistory.push({
      time:   new Date(Date.now() - (5 - s) * 180000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      signal: sigs[Math.round(Math.random())],
      result: res[Math.round(Math.random())]
    });
  }
})();

/* ════════════════════════════════════════════════
   FAVICON EMOJI
   ════════════════════════════════════════════════ */
(function setFavicon() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '52px serif';
  ctx.fillText('🟢', 4, 52);
  const link = document.querySelector("link[rel='icon']") || document.createElement('link');
  link.rel  = 'icon';
  link.href = canvas.toDataURL();
  document.head.appendChild(link);
})();

/* ════════════════════════════════════════════════
   COMPUTAR CONFIANÇA
   ════════════════════════════════════════════════ */
function computeConfidence() {
  const signals = Object.values(state.indicators).map(i => i.signal);
  const buyCount  = signals.filter(s => s === 'BUY').length;
  const sellCount = signals.filter(s => s === 'SELL').length;
  const majority  = buyCount >= sellCount ? 'LONG' : 'SHORT';
  const aligned   = Math.max(buyCount, sellCount);

  return { aligned, total: signals.length, majority,
    level: aligned >= 4 ? 'HIGH' : aligned >= 3 ? 'MEDIUM' : 'LOW' };
}

/* ════════════════════════════════════════════════
   SPARKLINES SVG
   ════════════════════════════════════════════════ */
function renderSparkline(svgId, data, colorFn) {
  const svg = document.getElementById(svgId);
  if (!svg || !data.length) return;
  const W = 60, H = 20;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = colorFn ? colorFn(data[data.length - 1]) : '#00d4aa';
  svg.innerHTML = `
    <polyline points="${pts.join(' ')}"
      fill="none" stroke="${color}" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round"/>`;
}

function renderAllSparklines() {
  renderSparkline('spark-rsi',    state.indicators.rsi.history,        v => v > 55 ? '#00d4aa' : v < 45 ? '#ff4d6d' : '#9ca3af');
  renderSparkline('spark-macd',   state.indicators.macd.history,       v => v >= 0 ? '#00d4aa' : '#ff4d6d');
  renderSparkline('spark-vwap',   state.indicators.vwap.history,       () => '#00d4aa');
  renderSparkline('spark-heiken', state.indicators.heikenAshi.history, v => v > 0.5 ? '#00d4aa' : '#ff4d6d');
}

/* ════════════════════════════════════════════════
   COUNTDOWN TIMER
   ════════════════════════════════════════════════ */
let countdownInterval = null;

function startCountdown() {
  const ring       = document.getElementById('countdown-ring');
  const timeEl     = document.getElementById('time-left');
  const circumference = 163.4; // 2π * 26

  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    if (state.event.timeRemaining <= 0) {
      state.event.timeRemaining = 0;
      clearInterval(countdownInterval);
    } else {
      state.event.timeRemaining--;
    }

    const s   = state.event.timeRemaining;
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    const timeStr = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;

    if (timeEl) {
      timeEl.textContent = timeStr;
      timeEl.classList.add('num-flip');
      setTimeout(() => timeEl.classList.remove('num-flip'), 250);
    }

    // Barra circular SVG
    if (ring) {
      const progress = s / state.totalTimeSeconds;
      const offset   = circumference * (1 - progress);
      ring.style.strokeDashoffset = offset.toFixed(2);

      ring.classList.remove('warn', 'danger');
      if (s < 30)  ring.classList.add('danger');
      else if (s < 120) ring.classList.add('warn');
    }
  }, 1000);
}

/* ════════════════════════════════════════════════
   ODDS HISTORY MINI CHART
   ════════════════════════════════════════════════ */
let oddsChart = null;

function initOddsChart() {
  const ctx = document.getElementById('odds-chart');
  if (!ctx) return;
  oddsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: state.oddsHistory.map((_, i) => i + 1),
      datasets: [
        { label: 'UP',   data: state.oddsHistory.map(o => +(o.up * 100).toFixed(1)),   borderColor: '#00d4aa', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
        { label: 'DOWN', data: state.oddsHistory.map(o => +(o.down * 100).toFixed(1)), borderColor: '#ff4d6d', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false, min: 0, max: 100 }
      }
    }
  });
}

function updateOddsChart() {
  if (!oddsChart) return;
  oddsChart.data.datasets[0].data = state.oddsHistory.map(o => +(o.up   * 100).toFixed(1));
  oddsChart.data.datasets[1].data = state.oddsHistory.map(o => +(o.down * 100).toFixed(1));
  oddsChart.update('none');
}

/* ════════════════════════════════════════════════
   ATUALIZAR CONFLUENCE CARD
   ════════════════════════════════════════════════ */
function updateConfluenceCard() {
  const conf = computeConfidence();
  const numEl  = document.getElementById('confluence-num');
  const dirEl  = document.getElementById('confluence-dir');
  const badgeEl = document.getElementById('confluence-badge');
  const bar    = document.getElementById('conf-progress-bar');
  const confBadge = document.getElementById('confidence-badge');
  const enterBtn  = document.getElementById('enter-signal-btn');
  const indConf   = document.getElementById('ind-confluence');

  if (numEl) numEl.textContent = conf.aligned;
  if (dirEl) dirEl.textContent = conf.majority;
  if (bar)   bar.style.width   = `${(conf.aligned / conf.total) * 100}%`;

  if (badgeEl) {
    badgeEl.className = `ind-badge badge-${conf.level === 'HIGH' ? 'buy' : conf.level === 'MEDIUM' ? 'buy' : 'neutral'}`;
    badgeEl.textContent = conf.level;
  }

  if (confBadge) {
    confBadge.className = `conf-badge conf-${conf.level.toLowerCase()}`;
    confBadge.textContent = conf.level;
  }

  if (enterBtn) {
    if (conf.level === 'HIGH') {
      enterBtn.classList.remove('hidden');
      enterBtn.classList.add('pulse');
      enterBtn.textContent = conf.majority === 'LONG' ? 'ENTER ↑ UP' : 'ENTER ↓ DOWN';
    } else {
      enterBtn.classList.add('hidden');
      enterBtn.classList.remove('pulse');
    }
  }

  if (indConf) {
    indConf.dataset.signal = conf.majority === 'LONG' ? 'buy' : 'sell';
  }
}

/* ════════════════════════════════════════════════
   RENDERIZAR SIGNAL HISTORY
   ════════════════════════════════════════════════ */
function renderSignalHistory() {
  const list = document.getElementById('signal-history-list');
  if (!list || !state.signalHistory.length) return;
  list.innerHTML = state.signalHistory.slice(-5).reverse().map(s => `
    <li>
      <span class="${s.result === 'win' ? 'sh-icon-ok' : 'sh-icon-fail'}">${s.result === 'win' ? '✓' : '✗'}</span>
      <span class="mono" style="font-size:0.65rem">${s.time}</span>
      <span style="font-weight:700;color:${s.signal === 'LONG' ? 'var(--up)' : 'var(--down)'}">${s.signal}</span>
    </li>`).join('');
}

/* ════════════════════════════════════════════════
   ATUALIZAÇÃO DO "LAST UPDATE AGO"
   ════════════════════════════════════════════════ */
function updateLastAgo() {
  const el = document.getElementById('last-update-ago');
  if (!el) return;
  const diff = Math.round((Date.now() - state.lastUpdateTs) / 1000);
  el.textContent = diff;
}

/* ════════════════════════════════════════════════
   SIMULAR REFRESH (MOCK) — substitua por SSE real
   Quando app.js receber dados do SSE, chame
   updateDashboardExtras(data) abaixo.
   ════════════════════════════════════════════════ */
function refreshMockData() {
  // Simular mudança nos indicadores
  const rsiDelta = (Math.random() - 0.49) * 1.5;
  state.indicators.rsi.value = Math.max(20, Math.min(80, state.indicators.rsi.value + rsiDelta));
  state.indicators.rsi.history.push(+state.indicators.rsi.value.toFixed(1));
  if (state.indicators.rsi.history.length > 12) state.indicators.rsi.history.shift();

  const macdDelta = (Math.random() - 0.52) * 0.8;
  state.indicators.macd.value = +( state.indicators.macd.value + macdDelta ).toFixed(2);
  state.indicators.macd.history.push(state.indicators.macd.value);
  if (state.indicators.macd.history.length > 12) state.indicators.macd.history.shift();

  // Odds
  const upShift = (Math.random() - 0.5) * 0.03;
  state.event.upOdds   = Math.max(0.1, Math.min(0.9, state.event.upOdds + upShift));
  state.event.downOdds = +(1 - state.event.upOdds).toFixed(2);
  state.oddsHistory.push({ up: +state.event.upOdds.toFixed(2), down: state.event.downOdds });
  if (state.oddsHistory.length > 12) state.oddsHistory.shift();

  // Forecast
  const long = Math.round(state.event.upOdds * 100 + (Math.random() - 0.5) * 6);
  state.forecast.long  = Math.max(20, Math.min(80, long));
  state.forecast.short = 100 - state.forecast.long;

  // Determinar sinal dos indicadores dinamicamente
  state.indicators.rsi.signal       = state.indicators.rsi.value > 55 ? 'BUY' : state.indicators.rsi.value < 45 ? 'SELL' : 'NEUTRAL';
  state.indicators.macd.signal      = state.indicators.macd.value > 0 ? 'BUY' : 'SELL';

  state.lastUpdateTs = Date.now();
  renderAllUI();
}

/* ════════════════════════════════════════════════
   RENDERIZAR TUDO NA UI
   ════════════════════════════════════════════════ */
function renderAllUI() {
  // Forecast bar
  const upBar   = document.getElementById('up-bar');
  const downBar = document.getElementById('down-bar');
  if (upBar) {
    upBar.style.width = state.forecast.long + '%';
    upBar.querySelector('.pct').textContent = state.forecast.long + '%';
  }
  if (downBar) {
    downBar.style.width = state.forecast.short + '%';
    downBar.querySelector('.pct').textContent = state.forecast.short + '%';
  }

  // Odds bars
  const upFill   = document.getElementById('poly-bar-up');
  const downFill = document.getElementById('poly-bar-down');
  const upPrice  = document.getElementById('up-outcome-price');
  const downPrice= document.getElementById('down-outcome-price');
  if (upFill)   upFill.style.width   = `${(state.event.upOdds   * 100).toFixed(0)}%`;
  if (downFill) downFill.style.width = `${(state.event.downOdds * 100).toFixed(0)}%`;
  if (upPrice)  upPrice.textContent  = `${(state.event.upOdds   * 100).toFixed(0)}¢`;
  if (downPrice)downPrice.textContent= `${(state.event.downOdds * 100).toFixed(0)}¢`;

  // Indicator cards border color
  const sigMap = {
    'ind-rsi':    state.indicators.rsi.signal.toLowerCase().replace('neutral','neutral').replace('buy','buy').replace('sell','sell'),
    'ind-macd':   state.indicators.macd.signal.toLowerCase().replace('sell','sell').replace('buy','buy').replace('neutral','neutral'),
    'ind-vwap':   state.indicators.vwap.signal.toLowerCase(),
    'ind-heiken': state.indicators.heikenAshi.signal.toLowerCase()
  };
  Object.entries(sigMap).forEach(([id, sig]) => {
    const el = document.getElementById(id);
    if (el) el.dataset.signal = sig === 'buy' ? 'buy' : sig === 'sell' ? 'sell' : 'neutral';
  });

  // RSI badge
  const rsiBadge = document.querySelector('#ind-rsi .ind-badge');
  if (rsiBadge) {
    rsiBadge.className = `ind-badge badge-${state.indicators.rsi.signal === 'BUY' ? 'buy' : state.indicators.rsi.signal === 'SELL' ? 'sell' : 'neutral'}`;
    rsiBadge.textContent = state.indicators.rsi.signal;
  }
  const rsiValEl = document.getElementById('rsi-val');
  if (rsiValEl) animateValue(rsiValEl, state.indicators.rsi.value.toFixed(1));

  // MACD badge
  const macdBadge = document.querySelector('#ind-macd .ind-badge');
  if (macdBadge) {
    macdBadge.className = `ind-badge badge-${state.indicators.macd.signal === 'BUY' ? 'buy' : 'sell'}`;
    macdBadge.textContent = state.indicators.macd.signal === 'BUY' ? 'BULLISH' : 'BEARISH';
  }
  const macdValEl = document.getElementById('macd-val');
  if (macdValEl) animateValue(macdValEl, state.indicators.macd.value.toFixed(2));

  updateOddsChart();
  updateConfluenceCard();
  renderAllSparklines();
  renderSignalHistory();
  updateLastAgo();
}

/* ════════════════════════════════════════════════
   ANIMAÇÃO DE VALOR (NUM-FLIP)
   ════════════════════════════════════════════════ */
function animateValue(el, newText) {
  if (!el || el.textContent === String(newText)) return;
  el.classList.remove('num-flip');
  void el.offsetWidth; // reflow
  el.textContent = newText;
  el.classList.add('num-flip');
}

/* ════════════════════════════════════════════════
   HOOK PARA INTEGRAÇÃO COM APP.JS (SSE real)
   Chame window.updateDashboardExtras(data) quando
   o SSE receber novos dados.
   ════════════════════════════════════════════════ */
window.updateDashboardExtras = function(data) {
  state.lastUpdateTs = Date.now();

  if (data.prediction) {
    state.forecast.long  = Math.round(data.prediction.up   * 100);
    state.forecast.short = Math.round(data.prediction.down * 100);
  }
  if (data.prices) {
    if (data.prices.up)   state.event.upOdds   = data.prices.up;
    if (data.prices.down) state.event.downOdds = data.prices.down;
    state.oddsHistory.push({ up: state.event.upOdds, down: state.event.downOdds });
    if (state.oddsHistory.length > 12) state.oddsHistory.shift();
  }
  if (data.indicators) {
    if (data.indicators.rsi !== undefined) {
      const rsi = data.indicators.rsi;
      state.indicators.rsi.value  = rsi;
      state.indicators.rsi.signal = rsi > 55 ? 'BUY' : rsi < 45 ? 'SELL' : 'NEUTRAL';
      state.indicators.rsi.history.push(+rsi.toFixed(1));
      if (state.indicators.rsi.history.length > 12) state.indicators.rsi.history.shift();
    }
    if (data.indicators.macd) {
      const h = data.indicators.macd.hist || 0;
      state.indicators.macd.value  = h;
      state.indicators.macd.signal = h >= 0 ? 'BUY' : 'SELL';
      state.indicators.macd.history.push(h);
      if (state.indicators.macd.history.length > 12) state.indicators.macd.history.shift();
    }
  }
  if (data.event?.timeRemaining !== undefined) {
    state.event.timeRemaining = data.event.timeRemaining;
    state.totalTimeSeconds    = data.event.totalTime || state.totalTimeSeconds;
  }

  renderAllUI();
};

/* ════════════════════════════════════════════════
   COPY SLUG
   ════════════════════════════════════════════════ */
window.copySlug = function() {
  const el = document.getElementById('active-event-id');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    el.textContent = '✓ Copiado!';
    setTimeout(() => renderAllUI(), 1500);
  });
};

/* ════════════════════════════════════════════════
   INICIALIZAR
   ════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initOddsChart();
  renderAllUI();
  startCountdown();

  // Auto-refresh de mock a cada 5s (será substituído pelo SSE real do app.js)
  setInterval(refreshMockData, 5000);

  // Atualiza o "X s ago" a cada segundo
  setInterval(updateLastAgo, 1000);
});
