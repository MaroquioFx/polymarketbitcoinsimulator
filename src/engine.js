import { CONFIG } from "./config.js";
import { fetchKlines, fetchLastPrice } from "./data/binance.js";
import { fetchChainlinkBtcUsd } from "./data/chainlink.js";
import { startChainlinkPriceStream } from "./data/chainlinkWs.js";
import { startPolymarketChainlinkPriceStream } from "./data/polymarketLiveWs.js";
import {
  fetchMarketBySlug,
  fetchLiveEventsBySeriesId,
  fetchMarketsBySeriesSlug,
  flattenEventMarkets,
  pickLatestLiveMarket,
  fetchClobPrice,
  fetchOrderBook,
  summarizeOrderBook
} from "./data/polymarket.js";
import { computeSessionVwap, computeVwapSeries } from "./indicators/vwap.js";
import { computeRsi, sma, slopeLast } from "./indicators/rsi.js";
import { computeMacd } from "./indicators/macd.js";
import { computeHeikenAshi, countConsecutive } from "./indicators/heikenAshi.js";
import { detectRegime } from "./engines/regime.js";
import { scoreDirection, applyTimeAwareness } from "./engines/probability.js";
import { computeEdge, decide } from "./engines/edge.js";
import { appendCsvRow, formatNumber, formatPct, getCandleWindowTiming, sleep } from "./utils.js";
import { startBinanceTradeStream } from "./data/binanceWs.js";
import { applyGlobalProxyFromEnv } from "./net/proxy.js";

applyGlobalProxyFromEnv();

export class AssistantEngine {
  constructor(customConfig = {}) {
    this.config = { ...CONFIG, autoDetect: true, ...customConfig };
    this.state = {
      btcPrice: null,
      polymarketPrice: null,
      chainlinkPrice: null,
      indicators: {},
      market: null,
      prediction: { up: 0, down: 0 },
      rec: { action: "WAIT", side: null, phase: "IDLE" },
      timeLeft: null,
      lastUpdate: null,
      priceToBeat: null
    };
    this.running = false;
    this.onUpdate = null;
    this.priceToBeatState = { slug: null, value: null, setAtMs: null };
    this.history = { labels: [], prices: [], macdHist: [], rsi: [] };
  }

  async resolveCurrentMarket() {
    // Priority 1: explicitly specified slug (Manual mode)
    if (!this.config.autoDetect && this.config.polymarket.marketSlug) {
      return await fetchMarketBySlug(this.config.polymarket.marketSlug);
    }
    
    // Priority 2: Auto-discovery using the current seriesId
    let events = await fetchLiveEventsBySeriesId({ seriesId: this.config.polymarket.seriesId, limit: 10 });
    
    // Fallback: search by seriesSlug if ID returns nothing
    if (events.length === 0 && this.config.polymarket.seriesSlug) {
        console.log(`Fallback: Searching for markets with seriesSlug: ${this.config.polymarket.seriesSlug}`);
        const markets = await fetchMarketsBySeriesSlug({ seriesSlug: this.config.polymarket.seriesSlug, limit: 10 });
        if (markets.length > 0) {
            const discovered = pickLatestLiveMarket(markets);
            if (discovered && this.config.autoDetect) {
                this.config.polymarket.marketSlug = discovered.slug;
            }
            return discovered;
        }
    }

    const markets = flattenEventMarkets(events);
    
    // Pick the most relevant market for the current timeframe from our known series
    const discovered = pickLatestLiveMarket(markets);
    
    // Update internal slug if auto-detected to sync with state
    if (discovered && this.config.autoDetect) {
        this.config.polymarket.marketSlug = discovered.slug;
    }
    
    return discovered;
  }

  async fetchSnapshot() {
    const market = await this.resolveCurrentMarket();
    if (!market) return { ok: false };

    const outcomes = Array.isArray(market.outcomes) ? market.outcomes : JSON.parse(market.outcomes || "[]");
    const outcomePrices = Array.isArray(market.outcomePrices) ? market.outcomePrices : JSON.parse(market.outcomePrices || "[]");
    const clobTokenIds = Array.isArray(market.clobTokenIds) ? market.clobTokenIds : JSON.parse(market.clobTokenIds || "[]");

    let upTokenId = null, downTokenId = null;
    for (let i = 0; i < outcomes.length; i++) {
        const label = String(outcomes[i]).toLowerCase();
        if (label === this.config.polymarket.upOutcomeLabel.toLowerCase()) upTokenId = clobTokenIds[i];
        if (label === this.config.polymarket.downOutcomeLabel.toLowerCase()) downTokenId = clobTokenIds[i];
    }

    let upBuy = null, downBuy = null;
    if (upTokenId && downTokenId) {
        try {
            [upBuy, downBuy] = await Promise.all([
                fetchClobPrice({ tokenId: upTokenId, side: "buy" }),
                fetchClobPrice({ tokenId: downTokenId, side: "buy" })
            ]);
        } catch (e) {
            const upIndex = outcomes.findIndex(x => String(x).toLowerCase() === this.config.polymarket.upOutcomeLabel.toLowerCase());
            const downIndex = outcomes.findIndex(x => String(x).toLowerCase() === this.config.polymarket.downOutcomeLabel.toLowerCase());
            upBuy = upIndex >= 0 ? Number(outcomePrices[upIndex]) : null;
            downBuy = downIndex >= 0 ? Number(outcomePrices[downIndex]) : null;
        }
    }

    return {
      ok: true,
      market,
      prices: { up: upBuy, down: downBuy }
    };
  }

  updateInterval(minutes) {
    const prev = this.config.candleWindowMinutes;
    this.config.candleWindowMinutes = minutes;
    
    // Auto-switch series for BTC Price markets if not explicitly overridden
    if (minutes === 5) {
      this.config.polymarket.seriesId = "10684"; // BTC 5m
      this.config.polymarket.seriesSlug = "btc-up-or-down-5m";
    } else if (minutes === 15) {
      this.config.polymarket.seriesId = "10192"; // BTC 15m
      this.config.polymarket.seriesSlug = "btc-up-or-down-15m";
    }
    
    // Atualiza o estado imediatamente para evitar desvio no front
    this.state.interval = minutes;

    // NOTE: autoDetect is NOT forced here — user's manual mode is preserved.
    // If user is in AUTO mode, it remains AUTO. If manual, it stays manual.

    if (prev !== minutes) {
      this.history = { labels: [], prices: [], macdHist: [], rsi: [] };
      this.priceToBeatState = { slug: null, value: null, setAtMs: null };
    }
  }

  updateMarketSlug(slug) {
    if (slug) {
        this.config.polymarket.marketSlug = slug;
        this.config.autoDetect = false; // Manual input turns off auto-detect
    } else {
        this.config.autoDetect = true; // Emply slug turns on auto-detect
    }
    this.priceToBeatState = { slug: null, value: null, setAtMs: null };
  }

  updateSeriesId(id) {
    this.config.polymarket.seriesId = String(id);
    this.history = { labels: [], prices: [], macdHist: [], rsi: [] };
    this.priceToBeatState = { slug: null, value: null, setAtMs: null };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.priceToBeatState = { slug: null, value: null, setAtMs: null };
  }

  async start() {
    if (this.running) return;
    this.running = true;

    const binanceStream = startBinanceTradeStream({ symbol: this.config.symbol });
    const polymarketLiveStream = startPolymarketChainlinkPriceStream({});
    const chainlinkStream = startChainlinkPriceStream({});

    while (this.running) {
      try {
        const timing = getCandleWindowTiming(this.config.candleWindowMinutes);
        const wsPrice = binanceStream.getLast()?.price ?? null;
        const polyWsPrice = polymarketLiveStream.getLast()?.price ?? null;
        const clWsPrice = chainlinkStream.getLast()?.price ?? null;

        const chainlinkPromise = polyWsPrice !== null 
            ? Promise.resolve({ price: polyWsPrice }) 
            : clWsPrice !== null 
            ? Promise.resolve({ price: clWsPrice }) 
            : fetchChainlinkBtcUsd();

        const [klines1m, lastPrice, chainlink, poly] = await Promise.all([
          fetchKlines({ interval: "1m", limit: 240 }),
          fetchLastPrice(),
          chainlinkPromise,
          this.fetchSnapshot()
        ]);

        const spotPrice = wsPrice ?? lastPrice;
        const currentPrice = chainlink?.price ?? null;
        
        // Settlement timing
        const settlementMs = poly.ok && poly.market?.endDate ? new Date(poly.market.endDate).getTime() : null;
        const nowMs = Date.now();
        const settlementLeftSec = settlementMs ? Math.floor((settlementMs - nowMs) / 1000) : null;
        const timeRemainingSeconds = settlementLeftSec ?? timing.remainingSeconds;
        const timeLeftMin = timeRemainingSeconds / 60;

        // Indicators
        const closes = klines1m.map(c => c.close);
        const vwapSeries = computeVwapSeries(klines1m);
        const vwapNow = vwapSeries[vwapSeries.length - 1];
        const vwapDist = vwapNow ? (spotPrice - vwapNow) / vwapNow : null;
        const lookback = this.config.vwapSlopeLookbackMinutes;
        const vwapSlope = vwapSeries.length >= lookback ? (vwapNow - vwapSeries[vwapSeries.length - lookback]) / lookback : null;

        const rsiNow = computeRsi(closes, this.config.rsiPeriod);
        const rsiSeries = closes.map((_, i) => computeRsi(closes.slice(0, i + 1), this.config.rsiPeriod)).filter(r => r !== null);
        const rsiSlope = slopeLast(rsiSeries, 3);

        const macd = computeMacd(closes, this.config.macdFast, this.config.macdSlow, this.config.macdSignal);
        const ha = computeHeikenAshi(klines1m);
        const consec = countConsecutive(ha);

        // Scoring & Decision
        const scored = scoreDirection({
          price: spotPrice,
          vwap: vwapNow,
          vwapSlope,
          rsi: rsiNow,
          rsiSlope,
          macd,
          heikenColor: consec.color,
          heikenCount: consec.count
        });

        const timeAware = applyTimeAwareness(scored.rawUp, timeLeftMin, this.config.candleWindowMinutes);
        const marketUp = poly.ok ? poly.prices.up : null;
        const marketDown = poly.ok ? poly.prices.down : null;
        const edge = computeEdge({ modelUp: timeAware.adjustedUp, modelDown: timeAware.adjustedDown, marketYes: marketUp, marketNo: marketDown });
        const rec = decide({ remainingMinutes: timeLeftMin, edgeUp: edge.edgeUp, edgeDown: edge.edgeDown, modelUp: timeAware.adjustedUp, modelDown: timeAware.adjustedDown });

        // Price to beat logic
        const marketSlug = poly.ok ? poly.market.slug : null;
        if (marketSlug && this.priceToBeatState.slug !== marketSlug) {
            this.priceToBeatState = { slug: marketSlug, value: null, setAtMs: null };
        }
        if (this.priceToBeatState.slug && this.priceToBeatState.value === null && currentPrice !== null) {
            const startMs = poly.ok && poly.market.eventStartTime ? new Date(poly.market.eventStartTime).getTime() : null;
            if (!startMs || Date.now() >= startMs) {
                this.priceToBeatState.value = Number(currentPrice);
            }
        }

        // Atualizar Histórico (Buffer para o gráfico)
        const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        this.history.labels.push(timeStr);
        this.history.prices.push(spotPrice);
        this.history.macdHist.push(macd ? macd.hist : 0);
        this.history.rsi.push(rsiNow);
        if (this.history.labels.length > 50) {
          this.history.labels.shift();
          this.history.prices.shift();
          this.history.macdHist.shift();
          this.history.rsi.shift();
        }

        // Update state
        this.state = {
          btcPrice: spotPrice,
          polymarketPrice: currentPrice,
          priceToBeat: this.priceToBeatState.value,
          market: poly.ok ? { ...poly.market, volume: poly.market.volume } : null,
          prices: { up: marketUp, down: marketDown },
          timeLeft: timeLeftMin,
          timeRemainingSeconds: timeRemainingSeconds,
          totalTimeSeconds: this.config.candleWindowMinutes * 60,
          indicators: {
            rsi: rsiNow,
            rsiSlope,
            macd,
            vwap: vwapNow,
            vwapDist,
            vwapSlope,
            heiken: consec
          },
          prediction: {
            up: timeAware.adjustedUp,
            down: timeAware.adjustedDown
          },
          interval: this.config.candleWindowMinutes,
          autoDetect: this.config.autoDetect,
          history: this.history,
          edge,
          rec,
          lastUpdate: new Date().toISOString()
        };

        if (this.onUpdate) this.onUpdate(this.state);

      } catch (err) {
        console.error("Engine Error:", err);
      }
      await sleep(this.config.pollIntervalMs);
    }
  }

  stop() {
    this.running = false;
  }
}
