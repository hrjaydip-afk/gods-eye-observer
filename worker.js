
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
  let score = 0;

  // Positive gold factors
  const positive = [
    "gold rises", "gold gains", "gold rally",
    "gold surges", "gold jumps", "gold rebounds",
    "dollar weakens", "yields fall",
    "treasury yields fall", "rate cuts",
    "safe haven demand", "central bank buying"
  ];

  // Negative gold factors
  const negative = [
    "gold falls", "gold drops", "gold sinks",
    "gold plunges", "gold selloff", "gold declines",
    "dollar strengthens", "dollar rises",
    "yields rise", "treasury yields rise",
    "rate hikes", "hawkish fed"
  ];

  positive.forEach(word => {
    if (text.includes(word)) score++;
  });

  negative.forEach(word => {
    if (text.includes(word)) score--;
  });

  return Math.max(-2, Math.min(2, score));
}
