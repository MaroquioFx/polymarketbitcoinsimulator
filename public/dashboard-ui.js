/**
 * dashboard-ui.js
 * Versão 2.2 — Smart Sniper Strategy - FIXED SINTAX
 */

/* ════════════════════════════════════════════════
   ESTADO GLOBAL
   ════════════════════════════════════════════════ */
const state = {
  event: {
    slug: 'btc-updown-15m',
    targetPrice: 0,
    upOdds: 0.5,
    downOdds: 0.5,
    volume: 0,
    timeRemaining: null,
    timeframe: '15min',
  },
  indicators: {
    rsi:       { value: 50,  signal: 'NEUTRAL', history: [], slope: 0 },
    macd:      { value: 0,   signal: 'NEUTRAL', history: [] },
    vwap:      { value: 0,   signal: 'NEUTRAL', history: [] },
    heikenAshi:{ value: 'neutral x0', signal: 'NEUTRAL', history: [] },
    emaCross:  { trend: 'NEUTRAL', gap: 0 },
    atr:       null,
    rsiDivergence: { divergence: 'NONE' },
    priceDistance: { absDistance: 0 }
  },
  priceHistory: [],
  forecast: { long: 50, short: 50 },
  signalHistory: [],
  oddsHistory: [],
  lastUpdateTs: Date.now(),
  totalTimeSeconds: 15 * 60,
  currentBtcPrice: null,
  currentPolyPrice: null, // Preço Chainlink vindo da Polymarket (usado para liquidação)
  currentInterval: 15,
  hasRealPrice: false  // Flag: true somente após receber preço real do servidor
};

/* ════════════════════════════════════════════════
   HISTÓRICO MOCK INICIAL (apenas odds, sem preço falso)
   ════════════════════════════════════════════════ */
(function initMockHistory() {
  // NOTA: currentBtcPrice e currentPolyPrice permanecem null até receberem
  // dados reais do servidor via SSE (updateDashboardExtras).
  // Removemos o mock de preço (base: 67000) para evitar que preços falsos
  // sejam usados como finalPrice na resolução de predições.
  for (let k = 0; k < 12; k++) {
    state.oddsHistory.push({ up: 0.5, down: 0.5 });
  }
})();

/* ════════════════════════════════════════════════
   ROBOT PREDICTOR: SMART SNIPER ENGINE
   ════════════════════════════════════════════════ */
const RobotPredictor = (() => {
  const STORAGE_KEY = 'btc_robot_predictions';
  let predictionMadeThisCycle = false;
  let retryAt3MinDone = false;
  let predictionData = null;
  let lastNoTradeAlertReason = null;

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      let history = Array.isArray(arr) ? arr.slice(-1000) : [];
      const now = Date.now();
      const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
      return history.filter(h => (now - (h.timestamp || now)) <= FORTY_EIGHT_HOURS_MS);
    } catch { return []; }
  }

  function saveHistory(history) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-1000))); } catch {}
  }

  function computeSmartDirection() {
    let upScore = 0;
    let downScore = 0;
    const details = [];
    const MAX_SCORE = 100;

    // 1. Odds (40 pts)
    const upOdds = state.event.upOdds || 0.5;
    const downOdds = state.event.downOdds || 0.5;
    if (upOdds > downOdds) {
      const s = Math.min((upOdds - 0.5) * 100, 40);
      upScore += s;
      details.push({ factor: 'Odds', dir: 'UP', pts: +s.toFixed(1), max: 40 });
    } else if (downOdds > upOdds) {
      const s = Math.min((downOdds - 0.5) * 100, 40);
      downScore += s;
      details.push({ factor: 'Odds', dir: 'DOWN', pts: +s.toFixed(1), max: 40 });
    }

    // 2. EMA (25 pts)
    const ema = state.indicators.emaCross || { trend: 'NEUTRAL', gap: 0 };
    if (ema.trend === 'UP') {
      const s = Math.min(Math.abs(ema.gap) * 50, 25);
      upScore += s;
      details.push({ factor: 'EMA', dir: 'UP', pts: +s.toFixed(1), max: 25 });
    } else if (ema.trend === 'DOWN') {
      const s = Math.min(Math.abs(ema.gap) * 50, 25);
      downScore += s;
      details.push({ factor: 'EMA', dir: 'DOWN', pts: +s.toFixed(1), max: 25 });
    }

    // 3. MACD (20 pts)
    const macdVal = state.indicators.macd.value || 0;
    if (state.indicators.macd.signal === 'BUY') {
      const s = Math.min(Math.abs(macdVal) * 3, 20);
      upScore += s;
      details.push({ factor: 'MACD', dir: 'UP', pts: +s.toFixed(1), max: 20 });
    } else if (state.indicators.macd.signal === 'SELL') {
      const s = Math.min(Math.abs(macdVal) * 3, 20);
      downScore += s;
      details.push({ factor: 'MACD', dir: 'DOWN', pts: +s.toFixed(1), max: 20 });
    }

    // 4. RSI (15 pts)
    const rsiDiv = state.indicators.rsiDivergence || { divergence: 'NONE' };
    if (rsiDiv.divergence === 'NONE') {
      if (state.indicators.rsi.signal === 'BUY') { upScore += 15; details.push({ factor: 'RSI', dir: 'UP', pts: 15, max: 15 }); }
      else if (state.indicators.rsi.signal === 'SELL') { downScore += 15; details.push({ factor: 'RSI', dir: 'DOWN', pts: 15, max: 15 }); }
    } else if (rsiDiv.divergence === 'BEARISH') {
      upScore -= 10; downScore += 10; details.push({ factor: 'RSI', dir: 'DIV↓', pts: -10, max: 15 });
    } else if (rsiDiv.divergence === 'BULLISH') {
      downScore -= 10; upScore += 10; details.push({ factor: 'RSI', dir: 'DIV↑', pts: -10, max: 15 });
    }

    upScore = Math.max(0, upScore);
    downScore = Math.max(0, downScore);
    const direction = upScore >= downScore ? 'UP' : 'DOWN';
    const score = Math.max(upScore, downScore);

    return { direction, score: +score.toFixed(1), maxScore: MAX_SCORE, upScore, downScore, details };
  }

  function checkSmartNoTrade(direction, score, upScore, downScore) {
    const upOdds = state.event.upOdds || 0.5;
    const downOdds = state.event.downOdds || 0.5;
    const dirOdds = direction === 'UP' ? upOdds : downOdds;

    if (score < 55) return { noTrade: true, reason: `Low score · ${score}/100` };
    if (Math.abs(upScore - downScore) < 15) return { noTrade: true, reason: `Split signal` };
    if (dirOdds < 0.52) return { noTrade: true, reason: `Market disagrees` };
    if (state.indicators.atr !== null && state.indicators.atr < 15) return { noTrade: true, reason: `Low volatility` };
    if (dirOdds >= 0.88) return { noTrade: true, reason: `Saturated odds` };

    return { noTrade: false };
  }

  function makePrediction(interval) {
    if (predictionMadeThisCycle) return;
    const smart = computeSmartDirection();
    const tradeCheck = checkSmartNoTrade(smart.direction, smart.score, smart.upScore, smart.downScore);
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    predictionMadeThisCycle = true;
    predictionData = {
      ...smart,
      timeLabel: now,
      interval,
      noTrade: tradeCheck.noTrade,
      noTradeReason: tradeCheck.reason,
      priceAtPrediction: state.currentBtcPrice,
      targetPrice: state.event.targetPrice,
      oddsAtPrediction: smart.direction === 'UP' ? state.event.upOdds : state.event.downOdds,
      upOdds: state.event.upOdds,
      downOdds: state.event.downOdds,
      indicators: {
        rsi: state.indicators.rsi.signal,
        macd: state.indicators.macd.signal,
        ema: state.indicators.emaCross.trend,
        ha: state.indicators.heikenAshi.signal
      }
    };

    renderCurrentPrediction();
    if (tradeCheck.noTrade) {
      if (lastNoTradeAlertReason !== tradeCheck.reason) showNoTradeAlert(smart.direction, tradeCheck.reason);
      lastNoTradeAlertReason = tradeCheck.reason;
    } else {
      showPredictionAlert(smart.direction, smart.score, 100);
    }
  }

  function resolvePrediction(finalPrice) {
    if (!predictionData) return;
    const tgt = predictionData.targetPrice;
    // Prioridade: 1) Preço Chainlink/Polymarket (preço real de liquidação)
    //             2) Preço Binance live
    // NUNCA usar se ainda não recebemos preço real do servidor
    const ep = state.currentPolyPrice || finalPrice || state.currentBtcPrice;
    if (!tgt || ep === null || !state.hasRealPrice) {
      // Sem preço real de mercado, não podemos calcular resultado correto.
      // Aguarda próximo ciclo com dados reais.
      resetCycle();
      return;
    }

    const correct = (predictionData.direction === 'UP' && ep >= tgt) || (predictionData.direction === 'DOWN' && ep < tgt);
    const history = loadHistory();
    history.push({
      ...predictionData,
      result: predictionData.noTrade ? 'notrade' : (correct ? 'win' : 'loss'),
      finalPrice: ep,
      timestamp: Date.now()
    });
    saveHistory(history);
    renderRobotHistory();
    renderCurrentPrediction();
    resetCycle();
  }

  function resetCycle() {
    predictionMadeThisCycle = false;
    retryAt3MinDone = false;
    predictionData = null;
    lastNoTradeAlertReason = null;
  }

  function renderCurrentPrediction() {
    const el = document.getElementById('robot-current-pred');
    if (!el) return;

    if (!predictionData) {
      const s = state.event.timeRemaining;
      if (s === null) {
        el.innerHTML = `<div class="robot-waiting">⏳ Waiting for data…</div>`;
      } else {
        const sUntil = Math.max(0, s - 300);
        const m = Math.floor(sUntil / 60), sec = sUntil % 60;
        el.innerHTML = `<div class="robot-waiting">⏳ Prediction in <strong class="mono">${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}</strong></div>`;
      }
    } else {
      const color = predictionData.noTrade ? 'robot-pred-notrade' : (predictionData.direction === 'UP' ? 'robot-pred-up' : 'robot-pred-down');
      const icon = predictionData.noTrade ? '⚠' : (predictionData.direction === 'UP' ? '↑' : '↓');
      const label = predictionData.noTrade ? 'NO TRADE' : (predictionData.direction === 'UP' ? 'YES — BTC UP' : 'NO — BTC DOWN');
      el.innerHTML = `
        <div class="robot-pred-active ${color}">
          <span class="robot-pred-icon">${icon}</span>
          <div class="robot-pred-info">
            <span class="robot-pred-label">${label}</span>
            <span class="robot-pred-meta">${predictionData.noTrade ? predictionData.noTradeReason : 'Smart Sniper Active'}</span>
            <span class="robot-pred-meta">Score: ${predictionData.score}/100 · ${predictionData.timeLabel}</span>
          </div>
        </div>`;
    }
  }

  function renderRobotHistory() {
    const tableEl = document.getElementById('robot-history-table');
    const badgeEl = document.getElementById('robot-accuracy-badge');
    if (!tableEl) return;

    const history = loadHistory();
    const traded = history.filter(h => h.result === 'win' || h.result === 'loss');
    const wins = traded.filter(h => h.result === 'win').length;
    const rate = traded.length > 0 ? ((wins / traded.length) * 100).toFixed(0) : '--';

    if (badgeEl) {
      badgeEl.textContent = traded.length > 0 ? `${wins}/${traded.length} · ${rate}%` : 'No trades';
      badgeEl.className = 'robot-accuracy-badge ' + (traded.length === 0 ? '' : +rate >= 60 ? 'acc-high' : +rate >= 45 ? 'acc-mid' : 'acc-low');
    }

    const rows = history.slice().reverse().map(h => {
      const resClass = h.result === 'win' ? 'rht-pnl-up' : h.result === 'loss' ? 'rht-pnl-down' : 'rht-pnl-zero';
      const resIcon = h.result === 'win' ? '✓' : h.result === 'loss' ? '✗' : '⚠';
      const scoreClass = h.score >= 75 ? 'rht-conf-high' : h.score >= 55 ? 'rht-conf-mid' : 'rht-conf-low';
      const pnl = h.result === 'win' ? `+$${((1/h.oddsAtPrediction)-1).toFixed(2)}` : (h.result === 'loss' ? '-$1.00' : '$0.00');

      return `<tr class="rht-row">
        <td class="mono">${h.timeLabel}</td>
        <td><span class="${h.direction === 'UP' ? 'rht-entry-up' : 'rht-entry-down'}">${h.noTrade ? 'NO TRADE' : h.direction}</span></td>
        <td class="mono ${scoreClass}">${h.score}</td>
        <td>${h.indicators.rsi[0]}</td><td>${h.indicators.macd[0]}</td><td>${h.indicators.ema[0]}</td><td>${h.indicators.ha[0]}</td>
        <td class="mono">${(h.upOdds*100).toFixed(0)}/${(h.downOdds*100).toFixed(0)}</td>
        <td class="rht-reason">${h.noTradeReason || '—'}</td>
        <td class="mono">$${h.targetPrice ? Number(h.targetPrice).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : '--'}</td><td class="mono">$${h.finalPrice ? Number(h.finalPrice).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : '--'}</td>
        <td class="mono ${resClass}">${pnl}</td>
      </tr>`;
    }).join('');

    tableEl.querySelector('tbody').innerHTML = rows || '<tr><td colspan="12" class="rht-empty">Awaiting data...</td></tr>';
    updatePnL(history);
  }

  function updatePnL(history) {
    let p=0, l=0;
    const h24 = 24*60*60*1000, now = Date.now();
    history.forEach(h => {
      if (h.timestamp && (now - h.timestamp) < h24) {
        if (h.result === 'win') p += (1/h.oddsAtPrediction)-1;
        else if (h.result === 'loss') l += 1;
      }
    });
    const t = p - l;
    if (document.getElementById('pnl-profit-val')) document.getElementById('pnl-profit-val').innerText = `+$${p.toFixed(2)}`;
    if (document.getElementById('pnl-loss-val')) document.getElementById('pnl-loss-val').innerText = `-$${l.toFixed(2)}`;
    if (document.getElementById('pnl-total-val')) {
      const el = document.getElementById('pnl-total-val');
      el.innerText = `${t>=0?'+':''}$${t.toFixed(2)}`;
      el.style.color = t >= 0 ? 'var(--up)' : 'var(--down)';
    }
  }

  function showPredictionAlert(dir, score, max) {
    const el = document.createElement('div');
    el.className = `pred-alert ${dir==='UP'?'pred-alert-up':'pred-alert-down'}`;
    el.innerHTML = `<div class="pred-alert-icon">${dir==='UP'?'↑':'↓'}</div><div class="pred-alert-text"><strong>🎯 Sniper: ${dir}</strong><span>Score: ${score}/${max}</span></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  function showNoTradeAlert(dir, reason) {
    const el = document.createElement('div');
    el.className = 'pred-alert pred-alert-notrade';
    el.innerHTML = `<div class="pred-alert-icon">⚠</div><div class="pred-alert-text"><strong>NO TRADE</strong><span>${reason}</span></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 8000);
  }

  return {
    check(tr, inv, fp) {
      if (tr === null) { renderCurrentPrediction(); return; }
      if (!predictionMadeThisCycle && tr <= 300 && tr > 120) makePrediction(inv);
      if (predictionData && predictionData.noTrade && !retryAt3MinDone && tr <= 180 && tr > 0) {
        retryAt3MinDone = true; predictionMadeThisCycle = false; makePrediction(inv);
      }
      if (predictionData && (tr <= 0 || tr > 310)) resolvePrediction(fp);
      renderCurrentPrediction();
    },
    renderHistory: renderRobotHistory,
    clearHistory: () => { localStorage.removeItem(STORAGE_KEY); renderRobotHistory(); }
  };
})();

/* ════════════════════════════════════════════════
   START COUNTDOWN (FIXED)
   ════════════════════════════════════════════════ */
function startCountdown() {
  const timeEl = document.getElementById('time-left');
  const ring = document.getElementById('countdown-ring');
  const circumference = 2 * Math.PI * 26;
  if (ring) ring.style.strokeDasharray = `${circumference} ${circumference}`;

  setInterval(() => {
    if (state.event.timeRemaining !== null && state.event.timeRemaining > 0) {
      state.event.timeRemaining--;
    }
    const s = state.event.timeRemaining;
    if (s !== null) {
      const m = Math.floor(s/60), sec = s%60;
      if (timeEl) timeEl.textContent = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
      if (ring) {
        const progress = s / (state.totalTimeSeconds || 900);
        ring.style.strokeDashoffset = circumference * (1 - progress);
        ring.className = `countdown-fill ${s < 60 ? 'danger' : s < 180 ? 'warn' : ''}`;
      }
    }
    // Passamos o preço da Polymarket (Chainlink) para resolução, se disponível. 
    // É o valor final real usado para liquidação no mercado.
    RobotPredictor.check(state.event.timeRemaining, state.currentInterval, state.currentPolyPrice || state.currentBtcPrice);
  }, 1000);
}

/* ════════════════════════════════════════════════
   UI HELPERS
   ════════════════════════════════════════════════ */
let oddsChart = null;
function initOddsChart() {
  const ctx = document.getElementById('odds-chart');
  if (!ctx) return;
  oddsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: state.oddsHistory.map((_,i) => i),
      datasets: [
        { label: 'UP', data: state.oddsHistory.map(o => o.up*100), borderColor: '#00d4aa', pointRadius: 0, tension: 0.3 },
        { label: 'DOWN', data: state.oddsHistory.map(o => o.down*100), borderColor: '#ff4d6d', pointRadius: 0, tension: 0.3 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } } }
  });
}

function updateOddsChart() {
  if (!oddsChart) return;
  oddsChart.data.datasets[0].data = state.oddsHistory.map(o => o.up*100);
  oddsChart.data.datasets[1].data = state.oddsHistory.map(o => o.down*100);
  oddsChart.update('none');
}

function updateConfluenceCard() {
  const smart = RobotPredictor.check ? { direction: 'UP', score: 0 } : { direction: 'UP', score: 0 }; // Placeholder if called outside
  // Esta função agora é chamada dentro do renderAllUI com dados frescos
  const s = RobotPredictor.check ? RobotPredictor.check_internal_score?.() || { score: 0, direction: 'UP' } : {score:0};

  // Re-calculo simplificado para o card visual
  const numEl = document.getElementById('confluence-num');
  const bar = document.getElementById('conf-progress-bar');
  const badge = document.getElementById('confluence-badge');

  // Para o card visual, vamos pegar o score em tempo real
  const current = (typeof RobotPredictor.computeSmartDirection === 'function') ? RobotPredictor.computeSmartDirection() : {score: 0};
  if (numEl) numEl.textContent = current.score || 0;
  if (bar) {
    bar.style.width = `${current.score}%`;
    bar.style.background = current.score >= 75 ? 'var(--up)' : current.score >= 55 ? '#ffca28' : '#ff4d6d';
  }
  if (badge) {
    badge.textContent = current.score >= 75 ? 'HIGH' : current.score >= 55 ? 'MEDIUM' : 'LOW';
    badge.className = `ind-badge badge-${current.score >= 55 ? 'buy' : 'neutral'}`;
  }
}

function renderAllUI() {
  // Update Indicators
  const map = { 'rsi-val': state.indicators.rsi.value.toFixed(1), 'macd-val': state.indicators.macd.value.toFixed(2), 'vwap-val': state.indicators.vwap.value || '--', 'heiken-val': state.indicators.heikenAshi.value };
  Object.entries(map).forEach(([id, val]) => { if(document.getElementById(id)) document.getElementById(id).textContent = val; });

  const rsiB = document.querySelector('#ind-rsi .ind-badge');
  if (rsiB) {
    rsiB.textContent = state.indicators.rsi.signal;
    rsiB.className = `ind-badge badge-${state.indicators.rsi.signal.toLowerCase()}`;
  }

  // Odds bars
  if(document.getElementById('poly-bar-up')) document.getElementById('poly-bar-up').style.width = `${(state.event.upOdds*100).toFixed(0)}%`;
  if(document.getElementById('poly-bar-down')) document.getElementById('poly-bar-down').style.width = `${(state.event.downOdds*100).toFixed(0)}%`;
  if(document.getElementById('up-outcome-price')) document.getElementById('up-outcome-price').textContent = `${(state.event.upOdds*100).toFixed(0)}¢`;
  if(document.getElementById('down-outcome-price')) document.getElementById('down-outcome-price').textContent = `${(state.event.downOdds*100).toFixed(0)}¢`;

  updateOddsChart();
  updateConfluenceCard();
  updateLastAgo();
}

function updateLastAgo() {
  const el = document.getElementById('last-update-ago');
  if (el) el.textContent = Math.round((Date.now() - state.lastUpdateTs)/1000) + 's';
}

/* ════════════════════════════════════════════════
   SSE HOOK
   ════════════════════════════════════════════════ */
window.updateDashboardExtras = function(data) {
  state.lastUpdateTs = Date.now();
  if (data.btcPrice) {
    state.currentBtcPrice = data.btcPrice;
    state.hasRealPrice = true; // Marcamos que agora temos preço real do servidor
  }
  if (data.polymarketPrice) {
    state.currentPolyPrice = data.polymarketPrice;
    state.hasRealPrice = true;
  }
  if (data.priceToBeat) state.event.targetPrice = data.priceToBeat;
  if (data.interval) state.currentInterval = data.interval;
  if (data.prices) {
    state.event.upOdds = data.prices.up;
    state.event.downOdds = data.prices.down;
    state.oddsHistory.push({ up: data.prices.up, down: data.prices.down });
    if (state.oddsHistory.length > 20) state.oddsHistory.shift();
  }
  if (data.indicators) {
    if (data.indicators.rsi) {
      state.indicators.rsi.value = data.indicators.rsi;
      state.indicators.rsi.signal = data.indicators.rsi > 55 ? 'BUY' : data.indicators.rsi < 45 ? 'SELL' : 'NEUTRAL';
    }
    if (data.indicators.macd) {
      state.indicators.macd.value = data.indicators.macd.hist;
      state.indicators.macd.signal = data.indicators.macd.hist >= 0 ? 'BUY' : 'SELL';
    }
    if (data.indicators.heiken) {
      state.indicators.heikenAshi.value = `${data.indicators.heiken.color} x${data.indicators.heiken.count}`;
      state.indicators.heikenAshi.signal = data.indicators.heiken.color === 'green' ? 'BUY' : 'SELL';
    }
    state.indicators.emaCross = data.indicators.emaCross || state.indicators.emaCross;
    state.indicators.atr = data.indicators.atr || state.indicators.atr;
    state.indicators.rsiDivergence = data.indicators.rsiDivergence || state.indicators.rsiDivergence;
  }
  if (data.timeRemainingSeconds !== undefined) {
    state.event.timeRemaining = data.timeRemainingSeconds;
    state.totalTimeSeconds = data.totalTimeSeconds || state.totalTimeSeconds;
  }
  renderAllUI();
};

document.addEventListener('DOMContentLoaded', () => {
  initOddsChart();
  startCountdown();
  RobotPredictor.renderHistory();
  setInterval(updateLastAgo, 1000);
});
