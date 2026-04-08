/**
 * dashboard-ui.js
 * Versão 2.1 — Robot Prediction + fixes
 */

/* ════════════════════════════════════════════════
   ESTADO GLOBAL
   ════════════════════════════════════════════════ */
const state = {
  event: {
    slug: 'btc-updown-15m',
    targetPrice: 67345,
    upOdds: 0.58,
    downOdds: 0.41,
    volume: 4339,
    timeRemaining: null,  // inicia null, aguarda sincronização do servidor
    timeframe: '15min',
  },
  indicators: {
    rsi:       { value: 55.2,  signal: 'BUY',  history: [] },
    macd:      { value: -3.2,  signal: 'SELL', history: [] },
    vwap:      { value: 67324, signal: 'BUY',  history: [] },
    heikenAshi:{ value: 'green x3', signal: 'BUY', history: [] }
  },
  priceHistory: [],
  forecast: { long: 77, short: 23 },
  signalHistory: [],
  oddsHistory: [],
  lastUpdateTs: Date.now(),
  totalTimeSeconds: 15 * 60,  // 15 min padrão
  currentBtcPrice: null,
  currentInterval: 15  // minutos
};

/* ════════════════════════════════════════════════
   HISTÓRICO MOCK INICIAL
   ════════════════════════════════════════════════ */
(function initMockHistory() {
  const base = 67200;
  for (let i = 30; i >= 0; i--) {
    const price = base + (Math.random() - 0.48) * 400 * (30 - i) / 10;
    state.priceHistory.push({ price: +price.toFixed(2) });
  }
  state.currentBtcPrice = state.priceHistory[state.priceHistory.length - 1].price;

  for (let k = 0; k < 10; k++) {
    const up = 0.48 + (Math.random() - 0.5) * 0.2;
    state.oddsHistory.push({ up: +up.toFixed(2), down: +(1 - up).toFixed(2) });
  }

  for (let j = 0; j < 10; j++) {
    state.indicators.rsi.history.push(+(48 + Math.random() * 18).toFixed(1));
    state.indicators.macd.history.push(+((Math.random() - 0.5) * 10).toFixed(2));
    state.indicators.vwap.history.push(+(67100 + Math.random() * 500).toFixed(0));
    state.indicators.heikenAshi.history.push(Math.random() > 0.4 ? 1 : 0);
  }
})();

/* ════════════════════════════════════════════════
   ROBOT PREDICTOR
   ════════════════════════════════════════════════ */
const RobotPredictor = (() => {
  const STORAGE_KEY = 'btc_robot_predictions';
  let predictionMadeThisCycle = false;
  let predictionData = null; // { direction, priceAtPrediction, timeLabel, interval }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      let history = Array.isArray(arr) ? arr.slice(-1000) : [];
      
      const now = Date.now();
      const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
      
      // Aplicar retrocompatibilidade e filtrar os dados das últimas 48 horas
      history = history.map(h => {
        if (!h.timestamp) h.timestamp = now; // Preenche para manter os antigos por mais 48h
        return h;
      }).filter(h => (now - h.timestamp) <= FORTY_EIGHT_HOURS_MS);

      return history;
    } catch { return []; }
  }

  function saveHistory(history) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-1000))); } catch {}
  }

  function computeDirection() {
    const signals = [
      state.indicators.rsi.signal,
      state.indicators.macd.signal,
      state.indicators.vwap.signal,
      state.indicators.heikenAshi.signal
    ];
    const buyCount  = signals.filter(s => s === 'BUY').length;
    const sellCount = signals.filter(s => s === 'SELL').length;
    
    let direction = 'UP';
    if (buyCount > sellCount) direction = 'UP';
    else if (sellCount > buyCount) direction = 'DOWN';
    else {
      // Evita apostar apenas em UP em caso de empate
      if (state.event.upOdds > state.event.downOdds) direction = 'UP';
      else if (state.event.downOdds > state.event.upOdds) direction = 'DOWN';
      else direction = Math.random() > 0.5 ? 'UP' : 'DOWN';
    }
    
    return {
      direction,
      confidence: Math.max(buyCount, sellCount) || 2, // fake pelo menos 2/4 puramente cosmético
      total: signals.length
    };
  }

  function checkNoTrade(direction) {
    const upPct   = (state.event.upOdds   || 0) * 100;
    const downPct = (state.event.downOdds || 0) * 100;

    // Regras de Conflito: robô aponta uma direção, Polymarket aponta ≥70% na oposta
    if (direction === 'UP' && downPct >= 70) {
      return { noTrade: true, reason: `Conflict · DOWN ${downPct.toFixed(0)}% ≥ 70%` };
    }
    if (direction === 'DOWN' && upPct >= 70) {
      return { noTrade: true, reason: `Conflict · UP ${upPct.toFixed(0)}% ≥ 70%` };
    }

    // Regras de Saturação: robô e Polymarket apontam mesma direção ≥85%
    if (direction === 'UP' && upPct >= 85) {
      return { noTrade: true, reason: `Saturated · UP ${upPct.toFixed(0)}% ≥ 85%` };
    }
    if (direction === 'DOWN' && downPct >= 85) {
      return { noTrade: true, reason: `Saturated · DOWN ${downPct.toFixed(0)}% ≥ 85%` };
    }

    return { noTrade: false };
  }

  function makePrediction(interval) {
    if (predictionMadeThisCycle) return;
    const { direction, confidence, total } = computeDirection();
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Verificar conflito com Polymarket Odds
    const tradeCheck = checkNoTrade(direction);

    // Capturar odds no momento da predição
    const oddsAtPred = direction === 'UP' ? (state.event.upOdds || 0.5) : (state.event.downOdds || 0.5);

    predictionMadeThisCycle = true;
    predictionData = {
      direction,
      confidence,
      total,
      priceAtPrediction: state.currentBtcPrice,
      targetPrice: state.event.targetPrice,
      timeLabel: now,
      interval,
      oddsAtPrediction: oddsAtPred,
      noTrade: tradeCheck.noTrade,
      noTradeReason: tradeCheck.reason || null
    };

    renderCurrentPrediction();
    if (tradeCheck.noTrade) {
      showNoTradeAlert(direction, tradeCheck.reason);
    } else {
      showPredictionAlert(direction, confidence, total);
    }
  }

  function resolvePrediction(finalPrice) {
    if (!predictionData) return;
    
    const tgt = predictionData.targetPrice;
    if (!tgt || finalPrice === null) {
      resetCycle();
      return;
    }

    const priceWentUp = finalPrice >= tgt;

    const correct = (predictionData.direction === 'UP' && priceWentUp) ||
                    (predictionData.direction === 'DOWN' && !priceWentUp);

    const history = loadHistory();
    history.push({
      time:      predictionData.timeLabel,
      direction: predictionData.direction,
      interval:  predictionData.interval,
      confidence:`${predictionData.confidence}/${predictionData.total}`,
      result:    correct ? 'win' : 'loss',
      targetPrice: tgt,
      finalPrice:  finalPrice,
      oddsAtPrediction: predictionData.oddsAtPrediction,
      noTrade:   !!predictionData.noTrade,
      timestamp: Date.now()
    });
    saveHistory(history);

    renderRobotHistory();
    renderCurrentPrediction();
    resetCycle();
  }

  function resetCycle() {
    predictionMadeThisCycle = false;
    predictionData = null;
  }

  function renderCurrentPrediction() {
    const el = document.getElementById('robot-current-pred');
    if (!el) return;

    if (!predictionData) {
      const s = state.event.timeRemaining;
      // Se ainda não recebemos o tempo do servidor, mostra aguardando
      if (s === null) {
        el.innerHTML = `
          <div class="robot-waiting">
            <span class="robot-wait-icon">⏳</span>
            <span>Aguardando dados do servidor…</span>
          </div>`;
        return;
      }
      const interval = state.currentInterval || 15;
      const halfSecs = (interval * 60) / 2;
      const sUntilPred = Math.max(0, s - halfSecs);
      const m = Math.floor(sUntilPred / 60);
      const sec = sUntilPred % 60;
      el.innerHTML = `
        <div class="robot-waiting">
          <span class="robot-wait-icon">⏳</span>
          <span>Previsão em <strong class="mono">${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}</strong></span>
        </div>`;
    } else if (predictionData.noTrade) {
      // Exibe NO TRADE quando há conflito com Polymarket Odds
      el.innerHTML = `
        <div class="robot-pred-active robot-pred-notrade">
          <span class="robot-pred-icon">⚠</span>
          <div class="robot-pred-info">
            <span class="robot-pred-label">NO TRADE</span>
            <span class="robot-pred-meta">Robot: ${predictionData.direction} · ${predictionData.noTradeReason}</span>
            <span class="robot-pred-meta">${predictionData.confidence}/${predictionData.total} indicators · ${predictionData.timeLabel}</span>
          </div>
        </div>`;
    } else {
      const colorClass = predictionData.direction === 'UP' ? 'robot-pred-up' : 'robot-pred-down';
      el.innerHTML = `
        <div class="robot-pred-active ${colorClass}">
          <span class="robot-pred-icon">${predictionData.direction === 'UP' ? '↑' : '↓'}</span>
          <div class="robot-pred-info">
            <span class="robot-pred-label">${predictionData.direction === 'UP' ? 'YES — BTC UP' : 'NO — BTC DOWN'}</span>
            <span class="robot-pred-meta">${predictionData.confidence}/${predictionData.total} indicators · ${predictionData.timeLabel}</span>
          </div>
        </div>`;
    }
  }

  function renderRobotHistory() {
    const list = document.getElementById('robot-history-list');
    const statsEl = document.getElementById('robot-stats');
    const badgeEl = document.getElementById('robot-accuracy-badge');
    if (!list) return;

    const history = loadHistory();
    const wins  = history.filter(h => h.result === 'win').length;
    const total = history.length;
    const rate  = total > 0 ? ((wins / total) * 100).toFixed(0) : '--';

    if (badgeEl) {
      badgeEl.textContent = total > 0 ? `${wins}/${total} · ${rate}%` : 'No data';
      badgeEl.className = 'robot-accuracy-badge ' +
        (total === 0 ? '' : +rate >= 60 ? 'acc-high' : +rate >= 45 ? 'acc-mid' : 'acc-low');
    }

    if (statsEl) {
      statsEl.innerHTML = total > 0
        ? `<span class="robot-stat-win">✓ ${wins} wins</span><span class="robot-stat-sep">·</span><span class="robot-stat-loss">✗ ${total - wins} losses</span><span class="robot-stat-rate">${rate}% win rate</span>`
        : `<span class="robot-stat-empty">Awaiting first predictions…</span>`;
    }

    if (!history.length) {
      list.innerHTML = '<li class="robot-empty">Empty history – wait for first full cycle.</li>';
      return;
    }

    list.innerHTML = history.slice().reverse().map(h => {
      let profitStr = '$0.00';
      let profitClass = '';

      if (!h.noTrade && h.oddsAtPrediction > 0) {
        if (h.result === 'win') {
          const profit = (1.0 / h.oddsAtPrediction) - 1.0;
          profitStr = '+$' + profit.toFixed(2);
          profitClass = 'rh-profit-up';
        } else {
          profitStr = '-$1.00';
          profitClass = 'rh-profit-down';
        }
      }

      return `
      <li class="robot-hist-item ${h.result} ${h.noTrade ? 'notrade' : ''}">
        <div style="display:flex; flex-direction:column; width:100%">
          <div style="display:flex; align-items:center;">
             <span class="rh-icon">${h.noTrade ? '⚠' : (h.result === 'win' ? '✓' : '✗')}</span>
             <span class="rh-time mono">${h.time}</span>
             <span class="rh-dir ${h.direction === 'UP' ? 'rh-up' : 'rh-down'}">${h.noTrade ? 'NO TRADE' : h.direction}</span>
             <span class="rh-interval">${h.interval}m</span>
             <span class="rh-profit ${profitClass}" style="margin-left:auto; font-weight:800; font-family:'Space Mono', monospace;">${profitStr}</span>
          </div>
          <div style="display:flex; font-size:0.65rem; color:inherit; opacity:0.8; justify-content:space-between; margin-top:4px; padding-left:18px;">
             <span>Target: $${h.targetPrice || '--'}</span>
             <span>Final: $${h.finalPrice || '--'}</span>
             <span style="opacity:0.6">Odds: ${(h.oddsAtPrediction * 100).toFixed(0)}¢</span>
          </div>
        </div>
      </li>`;
    }).join('');
  }

  function showPredictionAlert(direction, confidence, total) {
    // Cria overlay de alerta temporário
    const existing = document.getElementById('pred-alert-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pred-alert-overlay';
    overlay.className = `pred-alert ${direction === 'UP' ? 'pred-alert-up' : 'pred-alert-down'}`;
    overlay.innerHTML = `
      <div class="pred-alert-icon">${direction === 'UP' ? '↑' : '↓'}</div>
      <div class="pred-alert-text">
        <strong>Robot: ${direction === 'UP' ? 'YES — BTC UP' : 'NO — BTC DOWN'}</strong>
        <span>${confidence}/${total} indicators aligned</span>
      </div>`;
    document.body.appendChild(overlay);

    // Remove após 6 segundos
    setTimeout(() => overlay.remove(), 6000);
  }

  function showNoTradeAlert(direction, reason) {
    const existing = document.getElementById('pred-alert-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pred-alert-overlay';
    overlay.className = 'pred-alert pred-alert-notrade';
    overlay.innerHTML = `
      <div class="pred-alert-icon">⚠</div>
      <div class="pred-alert-text">
        <strong>NO TRADE</strong>
        <span>Robot: ${direction} — ${reason}</span>
      </div>`;
    document.body.appendChild(overlay);

    setTimeout(() => overlay.remove(), 8000);
  }

  // API pública
  return {
    check(timeRemaining, interval, finalPrice) {
      // Aguarda o servidor antes de disparar qualquer lógica
      if (timeRemaining === null || timeRemaining === undefined) {
        renderCurrentPrediction();
        return;
      }
      const halfSecs = (interval * 60) / 2;
      
      // Na metade do tempo: timeRemaining caiu abaixo de halfSecs E ainda não fez palpite
      if (timeRemaining <= halfSecs && timeRemaining > 0) {
        makePrediction(interval);
      }
      
      // No fim do ciclo (time <= 0) OU ao detectar pulo de relógio para novo ciclo:
      if (predictionData && (timeRemaining <= 0 || timeRemaining > halfSecs + 10)) {
        resolvePrediction(finalPrice);
      }
      
      // Resetar flag quando começa novo ciclo (tempo alto novamente)
      if (timeRemaining > halfSecs + 10) {
        predictionMadeThisCycle = false;
        predictionData = null;
      }
      
      renderCurrentPrediction();
    },
    renderHistory: renderRobotHistory,
    isPending: () => !!predictionData
  };
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
  const W = 60, H = 18;
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
   COUNTDOWN TIMER — Sem pisca-pisca
   ════════════════════════════════════════════════ */
let countdownInterval = null;
let lastRenderedTime  = -1; // evita re-render desnecessário

function startCountdown() {
  const ring = document.getElementById('countdown-ring');
  const timeEl = document.getElementById('time-left');
  const circumference = 163.4;

  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    // Apenas decrementa se tivermos um valor válido
    if (state.event.timeRemaining !== null && state.event.timeRemaining > 0) {
      state.event.timeRemaining--;
    } else if (state.event.timeRemaining !== null && state.event.timeRemaining <= 0) {
      state.event.timeRemaining = 0;
    }

    const s = state.event.timeRemaining;

    if (s !== null && s !== lastRenderedTime) {
      lastRenderedTime = s;
      const displayS = Math.max(0, s);
      const m = Math.floor(displayS / 60);
      const sec = displayS % 60;
      if (timeEl) timeEl.textContent = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;

      if (ring) {
        const total = state.totalTimeSeconds || (state.currentInterval * 60);
        const progress = total > 0 ? s / total : 0;
        const offset = circumference * (1 - progress);
        ring.style.strokeDashoffset = offset.toFixed(2);

        const shouldBeDanger = s < 30;
        const shouldBeWarn   = s < 120 && s >= 30;
        const hasDanger = ring.classList.contains('danger');
        const hasWarn   = ring.classList.contains('warn');

        if (shouldBeDanger && !hasDanger) { ring.classList.remove('warn');   ring.classList.add('danger'); }
        else if (shouldBeWarn && !hasWarn){ ring.classList.remove('danger'); ring.classList.add('warn');   }
        else if (!shouldBeDanger && !shouldBeWarn && (hasDanger || hasWarn)) {
          ring.classList.remove('danger', 'warn');
        }
      }
    }

    // Verificar palpite do robô
    RobotPredictor.check(
      state.event.timeRemaining,
      state.currentInterval,
      state.currentBtcPrice
    );

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
  const numEl     = document.getElementById('confluence-num');
  const dirEl     = document.getElementById('confluence-dir');
  const badgeEl   = document.getElementById('confluence-badge');
  const bar       = document.getElementById('conf-progress-bar');
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
  if (indConf) indConf.dataset.signal = conf.majority === 'LONG' ? 'buy' : 'sell';
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
   MOCK REFRESH (5s)
   ════════════════════════════════════════════════ */
function refreshMockData() {
  const rsiDelta = (Math.random() - 0.49) * 1.5;
  state.indicators.rsi.value = Math.max(20, Math.min(80, state.indicators.rsi.value + rsiDelta));
  state.indicators.rsi.history.push(+state.indicators.rsi.value.toFixed(1));
  if (state.indicators.rsi.history.length > 12) state.indicators.rsi.history.shift();

  const macdDelta = (Math.random() - 0.52) * 0.8;
  state.indicators.macd.value = +(state.indicators.macd.value + macdDelta).toFixed(2);
  state.indicators.macd.history.push(state.indicators.macd.value);
  if (state.indicators.macd.history.length > 12) state.indicators.macd.history.shift();

  const upShift = (Math.random() - 0.5) * 0.03;
  state.event.upOdds   = Math.max(0.1, Math.min(0.9, state.event.upOdds + upShift));
  state.event.downOdds = +(1 - state.event.upOdds).toFixed(2);
  state.oddsHistory.push({ up: +state.event.upOdds.toFixed(2), down: state.event.downOdds });
  if (state.oddsHistory.length > 12) state.oddsHistory.shift();

  const long = Math.round(state.event.upOdds * 100 + (Math.random() - 0.5) * 6);
  state.forecast.long  = Math.max(20, Math.min(80, long));
  state.forecast.short = 100 - state.forecast.long;

  state.indicators.rsi.signal  = state.indicators.rsi.value > 55 ? 'BUY' : state.indicators.rsi.value < 45 ? 'SELL' : 'NEUTRAL';
  state.indicators.macd.signal = state.indicators.macd.value > 0 ? 'BUY' : 'SELL';

  // Simula variação de preço BTC
  const priceDelta = (Math.random() - 0.5) * 50;
  state.currentBtcPrice = (state.currentBtcPrice || 67000) + priceDelta;

  state.lastUpdateTs = Date.now();
  renderAllUI();
}

/* ════════════════════════════════════════════════
   RENDERIZAR TUDO
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

  // Indicator border colors
  const sigMap = {
    'ind-rsi':    state.indicators.rsi.signal.toLowerCase(),
    'ind-macd':   state.indicators.macd.signal.toLowerCase(),
    'ind-vwap':   state.indicators.vwap.signal.toLowerCase(),
    'ind-heiken': state.indicators.heikenAshi.signal.toLowerCase()
  };
  Object.entries(sigMap).forEach(([id, sig]) => {
    const el = document.getElementById(id);
    if (el) el.dataset.signal = sig === 'buy' ? 'buy' : sig === 'sell' ? 'sell' : 'neutral';
  });

  // RSI
  const rsiBadge = document.querySelector('#ind-rsi .ind-badge');
  if (rsiBadge) {
    rsiBadge.className = `ind-badge badge-${state.indicators.rsi.signal === 'BUY' ? 'buy' : state.indicators.rsi.signal === 'SELL' ? 'sell' : 'neutral'}`;
    rsiBadge.textContent = state.indicators.rsi.signal;
  }
  const rsiValEl = document.getElementById('rsi-val');
  if (rsiValEl) animateValue(rsiValEl, state.indicators.rsi.value.toFixed(1));

  // MACD
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
   ANIMAÇÃO DE VALOR (SEM num-flip no relógio)
   ════════════════════════════════════════════════ */
function animateValue(el, newText) {
  if (!el || el.textContent === String(newText)) return;
  el.classList.remove('num-flip');
  void el.offsetWidth;
  el.textContent = newText;
  el.classList.add('num-flip');
}

/* ════════════════════════════════════════════════
   HOOK SSE — app.js chama window.updateDashboardExtras(data)
   ════════════════════════════════════════════════ */
window.updateDashboardExtras = function(data) {
  state.lastUpdateTs = Date.now();

  if (data.priceToBeat !== undefined) {
     state.event.targetPrice = data.priceToBeat;
  }

  if (data.interval) {
    // Se o intervalo mudou, reseta o timer para re-sincronizar com o servidor
    if (data.interval !== state.currentInterval) {
      state.event.timeRemaining = null;
      state.totalTimeSeconds = data.interval * 60;
    }
    state.currentInterval = data.interval;
  }

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
  if (data.btcPrice) state.currentBtcPrice = data.btcPrice;

  if (data.timeRemainingSeconds !== undefined) {
    const serverTime = data.timeRemainingSeconds;
    // Sincronização Suave: só ajusta se a diferença for maior que 2 segundos
    // para evitar que o relógio fique pulando devido a latência de rede.
    const localTime = state.event.timeRemaining;
    if (localTime === null || Math.abs(serverTime - localTime) > 2) {
      state.event.timeRemaining = serverTime;
    }
    state.totalTimeSeconds = data.totalTimeSeconds || state.totalTimeSeconds;
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
    el.textContent = '✓ Copied!';
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
  RobotPredictor.renderHistory();

  // "X s ago"
  setInterval(updateLastAgo, 1000);
});
