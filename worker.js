const VERSION = "0.1.0";

const ALLOWED_SYMBOLS = [
  "XAU/USD",
  "XAG/USD",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "BTC/USD",
  "ETH/USD",
  "BRENT",
  "WTI",
  "SPX",
  "NDX"
];

const ALLOWED_INTERVALS = [
  "1min",
  "5min",
  "15min",
  "30min",
  "1h",
  "4h",
  "1day"
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

async function twelveData(path, params, env) {
  if (!env.TD_API_KEY) {
    throw new Error("Twelve Data API key is missing");
  }

  const url = new URL(
    `https://api.twelvedata.com/${path}`
  );

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  url.searchParams.set("apikey", env.TD_API_KEY);

  const result = await fetch(url.toString());
  const data = await result.json();

  if (!result.ok || data.status === "error") {
    throw new Error(data.message || "Market data request failed");
  }

  return data;
}

function validateSymbol(symbol) {
  return ALLOWED_SYMBOLS.includes(symbol);
}

function validateInterval(interval) {
  return ALLOWED_INTERVALS.includes(interval);
}

function calculateRSI(closes, period = 14) {
  if (closes.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    avgGain =
      (avgGain * (period - 1) + Math.max(change, 0)) / period;

    avgLoss =
      (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

function sma(values, period) {
  if (values.length < period) return null;

  const slice = values.slice(-period);
  const average =
    slice.reduce((sum, value) => sum + value, 0) / period;

  return Number(average.toFixed(5));
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result =
      (values[i] - result) * multiplier + result;
  }

  return result;
}

function calculateATR(candles, period = 14) {
  if (candles.length <= period) return null;

  const ranges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }

  return sma(ranges, period);
}

function analyze(candles) {
  const closes = candles.map(c => c.close);

  const lastPrice = closes[closes.length - 1];

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  const macd = ema12 !== null && ema26 !== null
    ? Number((ema12 - ema26).toFixed(5))
    : null;

  return {
    price: lastPrice,
    SMA20: sma(closes, 20),
    SMA50: sma(closes, 50),
    SMA200: sma(closes, 200),
    RSI14: calculateRSI(closes),
    MACD: macd,
    ATR14: calculateATR(candles),
    trend:
      macd === null ? "INSUFFICIENT DATA" :
      macd > 0 ? "BULLISH" :
      macd < 0 ? "BEARISH" : "NEUTRAL",
    tradingSignal: "DISABLED",
    note: "Indicator analysis only. No BUY/SELL recommendation."
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    if (request.method !== "GET") {
      return response({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/health") {
        return response({
          status: "online",
          service: "GODS EYE DATA GATEWAY",
          version: VERSION,
          apiConfigured: Boolean(env.TD_API_KEY),
          timestamp: new Date().toISOString()
        });
      }

      const symbol = url.searchParams.get("symbol") || "XAU/USD";

      if (!validateSymbol(symbol)) {
        return response({
          error: "Symbol not allowed",
          allowedSymbols: ALLOWED_SYMBOLS
        }, 400);
      }

      if (path === "/api/quote") {
        const data = await twelveData(
          "quote",
          { symbol },
          env
        );

        return response({
          success: true,
          symbol,
          data
        });
      }

      if (
        path === "/api/time_series" ||
        path === "/api/analyze"
      ) {
        const interval =
          url.searchParams.get("interval") || "15min";

        if (!validateInterval(interval)) {
          return response({
            error: "Invalid interval",
            allowedIntervals: ALLOWED_INTERVALS
          }, 400);
        }

        const data = await twelveData(
          "time_series",
          {
            symbol,
            interval,
            outputsize: "250",
            order: "ASC"
          },
          env
        );

        if (!data.values || !Array.isArray(data.values)) {
          return response({
            error: "No candle data available",
            details: data
          }, 502);
        }

        const candles = data.values.map(c => ({
          datetime: c.datetime,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume || 0)
        }));

        if (path === "/api/time_series") {
          return response({
            success: true,
            symbol,
            interval,
            candles
          });
        }

        return response({
          success: true,
          symbol,
          interval,
          analysis: analyze(candles),
          lastUpdated: new Date().toISOString()
        });
      }

      return response({
        error: "Endpoint not found",
        endpoints: [
          "/api/health",
          "/api/quote?symbol=XAU/USD",
          "/api/time_series?symbol=XAU/USD&interval=15min",
          "/api/analyze?symbol=XAU/USD&interval=15min"
        ]
      }, 404);

    } catch (error) {
      return response({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  }
};
