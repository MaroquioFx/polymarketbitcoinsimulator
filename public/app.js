const statusBadge = document.getElementById('connection-status');
const btcPriceEl = document.getElementById('btc-price');
const intervalBadge = document.getElementById('current-interval-badge');
const polyPriceEl = document.getElementById('poly-price');
const marketTitleEl = document.getElementById('market-title');
const timeLeftEl = document.getElementById('time-left');
const ptbEl = document.getElementById('price-to-beat');
const upBar = document.getElementById('up-bar');
const downBar = document.getElementById('down-bar');
const recBadge = document.getElementById('recommendation-badge');
const rsiVal = document.getElementById('rsi-val');
const rsiSlope = document.getElementById('rsi-slope');
const macdVal = document.getElementById('macd-val');
const vwapVal = document.getElementById('vwap-val');
const vwapDist = document.getElementById('vwap-dist');
const rsiTendencyEl = document.getElementById('rsi-tendency');
const vwapTendencyEl = document.getElementById('vwap-tendency');
const heikenVal = document.getElementById('heiken-val');
const upPriceEl = document.getElementById('up-outcome-price');
const downPriceEl = document.getElementById('down-outcome-price');
const activeEventIdEl = document.getElementById('active-event-id');

const intervalBtns = document.querySelectorAll('.interval-btn');
const eventInput = document.getElementById('event-input');
const applyBtn = document.getElementById('apply-config');
const autoDetectBtn = document.getElementById('auto-detect-btn');

let eventSource = null;
let marketChart = null;
let activeInterval = null;

function formatPrice(val, decimals = 2) {
    if (val === null || val === undefined) return '$--,---';
    return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatMinutes(mins) {
    if (mins === null) return '--:--';
    const totalSeconds = Math.max(0, Math.floor(mins * 60));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function connect() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource('/stream');
    eventSource.onopen = () => {
        statusBadge.textContent = 'Online';
        statusBadge.className = 'status-badge online';
    };
    eventSource.onerror = () => {
        statusBadge.textContent = 'Erro de Conexão';
        statusBadge.className = 'status-badge connecting';
    };
    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        updateUI(data);
    };
}

function updateUI(data) {
    btcPriceEl.textContent = formatPrice(data.btcPrice, 0);
    polyPriceEl.textContent = formatPrice(data.polymarketPrice, 2);
    
    // Update Auto-detect button state
    if (data.autoDetect !== undefined) {
        autoDetectBtn.classList.toggle('active', data.autoDetect);
        autoDetectBtn.style.background = data.autoDetect ? 'var(--accent)' : 'rgba(39, 166, 154, 0.1)';
        autoDetectBtn.style.color = data.autoDetect ? '#fff' : 'var(--accent)';
        eventInput.disabled = data.autoDetect;
        if (data.autoDetect) eventInput.value = '';
    }
    
    if (data.market) {
        marketTitleEl.textContent = data.market.question || data.market.title || 'Mercado Ativo';
        // Show active event ID / slug
        const eventId = data.market.conditionId || data.market.slug || data.market.id || '--';
        activeEventIdEl.textContent = eventId;
    }
    
    timeLeftEl.textContent = formatMinutes(data.timeLeft);
    ptbEl.textContent = formatPrice(data.priceToBeat, 0);
    
    const upPct = (data.prediction.up * 100).toFixed(0);
    const downPct = (data.prediction.down * 100).toFixed(0);
    upBar.style.width = upPct + '%';
    downBar.style.width = downPct + '%';
    upBar.querySelector('.pct').textContent = upPct + '%';
    downBar.querySelector('.pct').textContent = downPct + '%';

    recBadge.textContent = data.rec.action === 'ENTER' ? `${data.rec.action} ${data.rec.side}` : data.rec.action;
    recBadge.className = 'badge ' + (data.rec.side ? data.rec.side.toLowerCase() : '');

    rsiVal.textContent = data.indicators.rsi ? data.indicators.rsi.toFixed(1) : '--.-';
    rsiSlope.textContent = data.indicators.rsiSlope > 0 ? '↑' : (data.indicators.rsiSlope < 0 ? '↓' : '-');
    
    // RSI Tendency
    if (data.indicators.rsi) {
        const rsi = data.indicators.rsi;
        if (rsi > 55) {
            rsiTendencyEl.textContent = 'COMPRA';
            rsiTendencyEl.className = 'tendency buy';
        } else if (rsi < 45) {
            rsiTendencyEl.textContent = 'VENDA';
            rsiTendencyEl.className = 'tendency sell';
        } else {
            rsiTendencyEl.textContent = 'NEUTRO';
            rsiTendencyEl.className = 'tendency neutral';
        }
    }

    macdVal.textContent = data.indicators.macd ? (data.indicators.macd.hist > 0 ? 'Bullish' : 'Bearish') : '--';
    macdVal.className = 'val ' + (data.indicators.macd?.hist > 0 ? 'up-val' : 'down-val');

    vwapVal.textContent = data.indicators.vwap ? data.indicators.vwap.toFixed(0) : '--';
    vwapDist.textContent = data.indicators.vwapDist ? (data.indicators.vwapDist * 100).toFixed(2) + '%' : '--%';
    
    // VWAP Tendency
    if (data.indicators.vwapDist !== undefined && data.indicators.vwapDist !== null) {
        const dist = data.indicators.vwapDist;
        if (dist > 0.0001) { // small threshold
            vwapTendencyEl.textContent = 'COMPRA';
            vwapTendencyEl.className = 'tendency buy';
        } else if (dist < -0.0001) {
            vwapTendencyEl.textContent = 'VENDA';
            vwapTendencyEl.className = 'tendency sell';
        } else {
            vwapTendencyEl.textContent = 'NEUTRO';
            vwapTendencyEl.className = 'tendency neutral';
        }
    }
    
    heikenVal.textContent = data.indicators.heiken ? `${data.indicators.heiken.color} x${data.indicators.heiken.count}` : '--';
    heikenVal.className = 'val ' + (data.indicators.heiken?.color === 'green' ? 'up-val' : 'down-val');

    upPriceEl.textContent = data.prices.up ? (data.prices.up * 100).toFixed(0) + '¢' : '--¢';
    downPriceEl.textContent = data.prices.down ? (data.prices.down * 100).toFixed(0) + '¢' : '--¢';

    if (data.interval) {
        intervalBadge.textContent = `${data.interval} min`;
        activeInterval = data.interval;
        intervalBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.min === String(data.interval));
        });
    }

    if (data.history && data.history.labels.length > 0) {
        updateChart(data.history);
    }
}

function updateChart(history) {
    if (!marketChart) initChart();
    marketChart.data.labels = history.labels;
    marketChart.data.datasets[0].data = history.prices;
    marketChart.data.datasets[1].data = history.macdHist;
    marketChart.data.datasets[1].backgroundColor = history.macdHist.map(v => v >= 0 ? '#27a69a' : '#ef5350');
    marketChart.update('none');
}

function clearChart() {
    if (marketChart) {
        marketChart.data.labels = [];
        marketChart.data.datasets.forEach(ds => ds.data = []);
        marketChart.update();
    }
}

function initChart() {
    const ctx = document.getElementById('market-chart').getContext('2d');
    marketChart = new Chart(ctx, {
        data: {
            labels: [],
            datasets: [
                {
                    label: 'BTC Price',
                    type: 'line',
                    data: [],
                    borderColor: '#5d5fef',
                    borderWidth: 2,
                    yAxisID: 'y',
                    tension: 0.1,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'MACD Hist',
                    type: 'bar',
                    data: [],
                    yAxisID: 'y1',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#b2b5be', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#b2b5be' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#b2b5be' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            }
        }
    });
}

intervalBtns.forEach(btn => {
    btn.onclick = () => {
        intervalBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeInterval = btn.dataset.min;
    };
});

applyBtn.onclick = async () => {
    const interval = activeInterval;
    const eventVal = eventInput.value.trim();
    const body = { interval };
    if (eventVal) {
        if (/^\d+$/.test(eventVal)) body.seriesId = eventVal;
        else body.marketSlug = eventVal;
    }
    applyBtn.disabled = true;
    applyBtn.textContent = 'Aplicando...';
    try {
        clearChart(); // Limpa imediatamente no front
        await fetch('/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (e) {
        alert('Erro ao aplicar configuração');
    } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Aplicar';
    }
};

autoDetectBtn.onclick = async () => {
    const isCurrentlyAuto = autoDetectBtn.classList.contains('active');
    const newState = !isCurrentlyAuto;
    
    autoDetectBtn.disabled = true;
    try {
        await fetch('/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoDetect: newState, interval: activeInterval })
        });
    } catch (e) {
        console.error('Erro ao alternar AUTO');
    } finally {
        autoDetectBtn.disabled = false;
    }
};

connect();
