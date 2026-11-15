
const VERSION = "0.4.1";

const ALLOWED_SYMBOLS = [
  "XAU/USD", "XAG/USD", "EUR/USD", "GBP/USD",
  "USD/JPY", "BTC/USD", "ETH/USD",
  "BRENT", "WTI", "SPX", "NDX"
];

const ALLOWED_INTERVALS = [
  "1min", "5min", "15min", "30min",
  "1h", "4h", "1day"
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

// MARKET DATA

async function twelveData(path, params, env) {
  if (!env.TD_API_KEY) {
    throw new Error("Twelve Data API key missing");
  }

  const url = new URL(
    `https://api.twelvedata.com/${path}`
  );

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  url.searchParams.set("apikey", env.TD_API_KEY);

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || data.status === "error") {
    throw new Error(
      data.message || "Twelve Data request failed"
    );
  }

  return data;
}

// TECHNICAL INDICATORS

function calculateRSI(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    avgGain =
      (avgGain * (period - 1) +
        Math.max(change, 0)) / period;

    avgLoss =
      (avgLoss * (period - 1) +
        Math.max(-change, 0)) / period;
  }

  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return Number(
    (100 - 100 / (1 + rs)).toFixed(2)
  );
}

function sma(values, period) {
  if (values.length < period) return null;

  const slice = values.slice(-period);

  return Number(
    (slice.reduce((a, b) => a + b, 0) / period)
      .toFixed(5)
  );
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result =
    values.slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result =
      (values[i] - result) * multiplier + result;
  }

  return Number(result.toFixed(5));
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
  if (!candles.length) {
    throw new Error("No candles available");
  }

  const closes = candles.map(c => c.close);

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  const macd =
    ema12 !== null && ema26 !== null
      ? Number((ema12 - ema26).toFixed(5))
      : null;

  return {
    price: closes[closes.length - 1],
    SMA20: sma(closes, 20),
    SMA50: sma(closes, 50),
    SMA200: sma(closes, 200),
    EMA12: ema12,
    EMA26: ema26,
    RSI14: calculateRSI(closes),
    MACD: macd,
    ATR14: calculateATR(candles),

    trend:
      macd === null
        ? "INSUFFICIENT DATA"
        : macd > 0
          ? "BULLISH"
          : macd < 0
            ? "BEARISH"
            : "NEUTRAL",

    tradingSignal: "DISABLED",
    note: "Technical analysis only. No automatic trade execution."
  };
}

// NEWS SENTIMENT

function buildGdeltQuery(symbol) {
  const queries = {
    "XAU/USD": "gold OR bullion OR XAU",
    "XAG/USD": "silver OR XAG",
    "EUR/USD": "euro OR ECB",
    "GBP/USD": "British pound OR GBP",
    "USD/JPY": "Japanese yen OR Bank of Japan",
    "BTC/USD": "Bitcoin OR BTC",
    "ETH/USD": "Ethereum OR ETH",
    "BRENT": "Brent crude oil OR OPEC",
    "WTI": "WTI crude oil OR oil prices",
    "SPX": "\"S&P 500\" OR Wall Street",
    "NDX": "Nasdaq OR technology stocks"
  };

  const query = queries[symbol] || symbol;

  return query.includes(" OR ")
    ? `(${query})`
    : query;
}

function getNewsTerms(symbol) {
  const terms = {
    "XAU/USD": ["gold", "bullion", "XAU", "precious metal"],
    "XAG/USD": ["silver", "XAG", "precious metal"],
    "EUR/USD": ["euro", "ECB", "EUR"],
    "GBP/USD": ["pound", "GBP", "Bank of England"],
    "USD/JPY": ["yen", "USD/JPY", "Bank of Japan"],
    "BTC/USD": ["bitcoin", "BTC", "crypto"],
    "ETH/USD": ["ethereum", "ETH", "crypto"],
    "BRENT": ["Brent", "crude oil", "OPEC"],
    "WTI": ["WTI", "crude oil", "OPEC"],
    "SPX": ["S&P 500", "Wall Street", "US stocks"],
    "NDX": ["Nasdaq", "technology stocks"]
  };

  return terms[symbol] || [symbol];
}

function isRelevant(title, symbol) {
  const text = (title || "").toLowerCase();

  return getNewsTerms(symbol).some(term =>
    text.includes(term.toLowerCase())
  );
}

function scoreHeadline(title) {
  const text = (title || "").toLowerCase();

  const positive = [
    "surge", "rally", "rises", "rise", "gains",
    "gain", "bullish", "higher", "record high",
    "beats", "strong demand", "inflows",
    "upgrade", "optimism", "rebound", "growth"
  ];

  const negative = [
    "crash", "plunge", "falls", "fall", "drops",
    "drop", "bearish", "lower", "selloff",
    "sell-off", "misses", "outflows",
    "downgrade", "weakness", "crisis",
    "recession", "decline"
  ];

  let score = 0;

  positive.forEach(word => {
    if (text.includes(word)) score++;
  });

  negative.forEach(word => {
    if (text.includes(word)) score--;
  });

  return Math.max(-2, Math.min(2, score));
}

// FINNHUB NEWS

async function getFinnhubNews(symbol, env) {
  if (!env.FINNHUB_API_KEY) {
    throw new Error("Finnhub API key missing");
  }

  const url = new URL(
    "https://finnhub.io/api/v1/news"
  );

  url.searchParams.set("category", "general");
  url.searchParams.set("token", env.FINNHUB_API_KEY);

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(
      `Finnhub request failed: HTTP ${res.status}`
    );
  }

  const data = await res.json();

  if (!Array.isArray(data)) return [];

  return data
    .filter(item =>
      isRelevant(item.headline, symbol)
    )
    .slice(0, 30)
    .map(item => ({
      source: "Finnhub",
      title: item.headline || "",
      url: item.url || "",
      datetime: item.datetime
        ? new Date(item.datetime * 1000).toISOString()
        : null
    }));
}

// GDELT NEWS

async function getGdeltNews(symbol) {
  const url = new URL(
    "https://api.gdeltproject.org/api/v2/doc/doc"
  );

  url.searchParams.set(
    "query",
    buildGdeltQuery(symbol)
  );

  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "30");
  url.searchParams.set("timespan", "7d");
  url.searchParams.set("sort", "DateDesc");

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(
      `GDELT request failed: HTTP ${res.status}`
    );
  }

  const contentType =
    res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const body = (await res.text()).slice(0, 180);
    throw new Error(
      `GDELT returned non-JSON response: ${body}`
    );
  }

  const data = await res.json();

  if (!Array.isArray(data.articles)) return [];

  return data.articles
    .filter(item =>
      isRelevant(item.title, symbol)
    )
    .map(item => ({
      source: "GDELT",
      title: item.title || "",
      url: item.url || "",
      datetime: item.seendate || null
    }))
    .filter(item => item.title);
}

// SENTIMENT ENGINE

async function getSentiment(symbol, env) {
  const results = await Promise.allSettled([
    getFinnhubNews(symbol, env),
    getGdeltNews(symbol)
  ]);

  const news = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      news.push(...result.value);
    } else {
      errors.push({
        source: index === 0 ? "Finnhub" : "GDELT",
        message: result.reason?.message || "Unavailable"
      });
    }
  });

  const seen = new Set();

  const uniqueNews = news.filter(item => {
    const key = item.title.toLowerCase().trim();

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  const scoredNews = uniqueNews.map(item => ({
    ...item,
    score: scoreHeadline(item.title)
  }));

  const count = scoredNews.length;

  const totalScore = scoredNews.reduce(
    (sum, item) => sum + item.score, 0
  );

  const average = count ? totalScore / count : 0;

  const score = Math.max(
    -10,
    Math.min(10, Math.round(average * 5))
  );

  const sentiment =
    count < 3
      ? "INSUFFICIENT DATA"
      : score >= 2
        ? "BULLISH"
        : score <= -2
          ? "BEARISH"
          : "NEUTRAL";

  const confidence =
    count >= 20
      ? "HIGH"
      : count >= 8
        ? "MEDIUM"
        : count >= 3
          ? "LOW"
          : "INSUFFICIENT";

  return {
    success: true,
    symbol,
    sentiment,
    score,
    confidence,
    articleCount: count,

    sources: [
      ...new Set(scoredNews.map(n => n.source))
    ],

    methodology:
      "Headline keyword scoring across Finnhub and GDELT. Not official market positioning.",

    errors,
    news: scoredNews.slice(0, 30),
    lastUpdated: new Date().toISOString()
  };
}

// REQUEST HANDLER

export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    if (request.method !== "GET") {
      return response({
        error: "Method not allowed"
      }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {

      // HEALTH CHECK

      if (path === "/api/health") {
        return response({
          status: "online",
          service: "GODS EYE DATA GATEWAY",
          version: VERSION,

          // Dashboard health status fix
          apiConfigured: Boolean(env.TD_API_KEY),

          twelveDataConfigured: Boolean(env.TD_API_KEY),
          finnhubConfigured: Boolean(env.FINNHUB_API_KEY),

          timestamp: new Date().toISOString()
        });
      }

      const symbol =
        url.searchParams.get("symbol") || "XAU/USD";

      if (!ALLOWED_SYMBOLS.includes(symbol)) {
        return response({
          error: "Symbol not allowed",
          allowedSymbols: ALLOWED_SYMBOLS
        }, 400);
      }

      // SENTIMENT

      if (path === "/api/sentiment") {
        const result = await getSentiment(symbol, env);
        return response(result);
      }

      // LIVE QUOTE

      if (path === "/api/quote") {
        const data = await twelveData(
          "quote",
          { symbol },
          env
        );

        return response({
          success: true,
          symbol,
          data,
          lastUpdated: new Date().toISOString()
        });
      }

      // CANDLES / ANALYSIS

      if (
        path === "/api/time_series" ||
        path === "/api/analyze"
      ) {

        const interval =
          url.searchParams.get("interval") || "15min";

        if (!ALLOWED_INTERVALS.includes(interval)) {
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

        if (!Array.isArray(data.values) ||
            data.values.length === 0) {
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

        if (candles.some(c =>
          !Number.isFinite(c.open) ||
          !Number.isFinite(c.high) ||
          !Number.isFinite(c.low) ||
          !Number.isFinite(c.close)
        )) {
          throw new Error(
            "Invalid candle values received"
          );
        }

        if (path === "/api/time_series") {
          return response({
            success: true,
            symbol,
            interval,
            candleCount: candles.length,
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

      // UNKNOWN ENDPOINT

      return response({
        error: "Endpoint not found",
        endpoints: [
          "/api/health",
          "/api/quote?symbol=XAU/USD",
          "/api/time_series?symbol=XAU/USD&interval=15min",
          "/api/analyze?symbol=XAU/USD&interval=15min",
          "/api/sentiment?symbol=XAU/USD"
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
