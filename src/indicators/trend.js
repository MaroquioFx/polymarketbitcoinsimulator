/**
 * trend.js — EMA Cross + ATR + RSI Divergence indicators
 * Smart Sniper Strategy v1.0
 */

/**
 * Calcula EMA (Exponential Moving Average)
 */
export function computeEma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Calcula EMA20 e EMA50 e retorna sinal de tendência
 * @returns {{ ema20, ema50, trend: 'UP'|'DOWN'|'NEUTRAL', gap }}
 */
export function computeEmaCross(closes) {
  if (!Array.isArray(closes) || closes.length < 50) {
    return { ema20: null, ema50: null, trend: 'NEUTRAL', gap: 0 };
  }
  const ema20 = computeEma(closes, 20);
  const ema50 = computeEma(closes, 50);
  if (ema20 === null || ema50 === null) {
    return { ema20, ema50, trend: 'NEUTRAL', gap: 0 };
  }
  const gap = ((ema20 - ema50) / ema50) * 100; // gap em %
  let trend = 'NEUTRAL';
  if (ema20 > ema50) trend = 'UP';
  if (ema20 < ema50) trend = 'DOWN';
  return { ema20, ema50, trend, gap };
}

/**
 * Calcula ATR (Average True Range) sobre candles de 1m
 * @param {Array} candles — [{high, low, close}]
 * @param {number} period — período (default 15)
 * @returns {number|null}
 */
export function computeAtr(candles, period = 15) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const recent = candles.slice(-period - 1);
  let sum = 0;
  for (let i = 1; i < recent.length; i++) {
    const high = recent[i].high;
    const low = recent[i].low;
    const prevClose = recent[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    sum += tr;
  }
  return sum / period;
}

/**
 * Detecta divergência entre preço e RSI
 * Compara a direção do preço vs direção do RSI nos últimos N candles
 * @returns {{ divergence: 'BULLISH'|'BEARISH'|'NONE', priceDir, rsiDir }}
 */
export function detectRsiDivergence(closes, rsiSeries, lookback = 10) {
  if (!Array.isArray(closes) || !Array.isArray(rsiSeries)) {
    return { divergence: 'NONE', priceDir: 0, rsiDir: 0 };
  }
  if (closes.length < lookback || rsiSeries.length < lookback) {
    return { divergence: 'NONE', priceDir: 0, rsiDir: 0 };
  }

  const recentCloses = closes.slice(-lookback);
  const recentRsi = rsiSeries.slice(-lookback);

  const priceDir = recentCloses[recentCloses.length - 1] - recentCloses[0];
  const rsiDir = recentRsi[recentRsi.length - 1] - recentRsi[0];

  // Preço subindo mas RSI caindo = bearish divergence
  if (priceDir > 5 && rsiDir < -2) {
    return { divergence: 'BEARISH', priceDir, rsiDir };
  }
  // Preço caindo mas RSI subindo = bullish divergence
  if (priceDir < -5 && rsiDir > 2) {
    return { divergence: 'BULLISH', priceDir, rsiDir };
  }
  return { divergence: 'NONE', priceDir, rsiDir };
}

/**
 * Calcula a distância do preço atual ao price-to-beat
 * @returns {{ distance, absDistance, direction: 'ABOVE'|'BELOW'|'AT' }}
 */
export function calcPriceDistance(currentPrice, priceToBeat) {
  if (currentPrice == null || priceToBeat == null) {
    return { distance: 0, absDistance: 0, direction: 'AT' };
  }
  const distance = currentPrice - priceToBeat;
  const absDistance = Math.abs(distance);
  let direction = 'AT';
  if (distance > 1) direction = 'ABOVE';
  if (distance < -1) direction = 'BELOW';
  return { distance, absDistance, direction };
}
