(() => {
  'use strict';

  const START = 10000;
  const STORAGE_KEY = 'vela.paper.v1';
  const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const INTERVAL_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
  const GECKO_TF = {
    '1m': ['minute', 1],
    '5m': ['minute', 5],
    '15m': ['minute', 15],
    '1h': ['hour', 1],
    '4h': ['hour', 4],
    '1d': ['day', 1],
  };
  const GECKO_NET = {
    solana: 'solana',
    ethereum: 'eth',
    bsc: 'bsc',
    base: 'base',
    arbitrum: 'arbitrum',
    polygon: 'polygon',
    avalanche: 'avax',
    optimism: 'optimism',
    fantom: 'ftm',
    pulsechain: 'pulsechain',
  };
  const REST_BASES = ['https://data-api.binance.vision', 'https://api.binance.com'];
  const WS_BASES = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443'];
  const PRESETS = ['#FOMO', '#Breakout', '#Reversal', '#Scalp', '#Momentum'];
  const FIBS = [
    { level: 0, color: '#9a96ad', label: '0%' },
    { level: 0.236, color: '#ff5d73', label: '23.6%' },
    { level: 0.382, color: '#ff9f43', label: '38.2%' },
    { level: 0.5, color: '#f7d154', label: '50%' },
    { level: 0.618, color: '#14f195', label: '61.8%' },
    { level: 0.786, color: '#7c8cff', label: '78.6%' },
    { level: 1, color: '#9a96ad', label: '100%' },
  ];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const REASONS = { manual: 'Manual', tp: 'Take profit', sl: 'Stop loss', trail: 'Trailing stop' };
  const MAJORS = [
    { id: 'BTCUSDT', kind: 'binance', symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', name: 'Bitcoin' },
    { id: 'ETHUSDT', kind: 'binance', symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', name: 'Ethereum' },
    { id: 'SOLUSDT', kind: 'binance', symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', name: 'Solana' },
    { id: 'BNBUSDT', kind: 'binance', symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT', name: 'BNB' },
    { id: 'XRPUSDT', kind: 'binance', symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT', name: 'XRP' },
    { id: 'DOGEUSDT', kind: 'binance', symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT', name: 'Dogecoin' },
  ];

  const $ = (id) => document.getElementById(id);
  const nowDate = new Date();

  const state = {
    balance: START,
    startBalance: START,
    positions: [],
    orders: [],
    trades: [],
    drawings: {},
    dexMarkets: [],
    customTags: [],
    selectedTags: new Set(),
    active: null,
    activeId: 'BTCUSDT',
    interval: '15m',
    last: {},
    stats: {},
    candles: [],
    draftSide: 'long',
    draftType: 'market',
    tab: 'positions',
    mobileView: 'chart',
    drawMode: null,
    journalTag: 'all',
    journalDay: null,
    calendar: { y: nowDate.getFullYear(), m: nowDate.getMonth() },
    pairChoices: [],
    loadGen: 0,
    klinePath: '',
    klineLive: false,
    klineTries: 0,
    dexLive: false,
    dexError: false,
    chartError: false,
    submitting: false,
  };

  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let overlayCtx = null;
  let barsReady = false;
  let draftPoint = null;
  let previewPoint = null;
  let paintQueued = false;
  let evalLock = false;
  let saveTimer = 0;
  let stopKline = () => {};
  let stopMini = () => {};
  let miniStarted = false;
  const priceLines = new Map();
  const dexJobs = new Map();
  const historyWarned = new Set();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function num(value) {
    const n = Number(String(value ?? '').replace(/[$,\s]/g, ''));
    return n;
  }

  function formatMoney(n) {
    const v = Number(n) || 0;
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function signedMoney(n) {
    const v = round2(n);
    if (v > 0) return `+${formatMoney(v)}`;
    return formatMoney(v);
  }

  function formatPrice(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    let max = 2;
    if (a > 0 && a < 0.000001) max = 10;
    else if (a < 0.0001) max = 8;
    else if (a < 0.01) max = 6;
    else if (a < 1) max = 5;
    else if (a < 100) max = 4;
    return v.toLocaleString(undefined, { maximumFractionDigits: max });
  }

  function formatPriceInput(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    const a = Math.abs(v);
    let d = 2;
    if (a > 0 && a < 0.000001) d = 12;
    else if (a < 0.0001) d = 10;
    else if (a < 0.01) d = 8;
    else if (a < 1) d = 6;
    else if (a < 100) d = 4;
    return v.toFixed(d).replace(/\.?0+$/, '');
  }

  function formatQty(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  function formatCompact(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? '-' : '';
    const a = Math.abs(v);
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
    return formatMoney(v);
  }

  function formatVol(n) {
    if (!Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return n.toFixed(2);
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function formatChange(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return '—';
    const v = Number(pct);
    return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  }

  function dayKeyFromDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function toast(message, tone) {
    const stack = $('toasts');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast${tone === 'error' ? ' error' : ''}`;
    el.textContent = message;
    stack.appendChild(el);
    while (stack.children.length > 4) stack.firstChild.remove();
    setTimeout(() => el.remove(), 3600);
  }

  function showFatal(message) {
    const el = $('fatal');
    el.textContent = message;
    el.classList.remove('is-hidden');
  }

  let modalResolve = null;
  function askReset() {
    $('modal').classList.remove('is-hidden');
    $('modalCancel').focus();
    return new Promise((resolve) => { modalResolve = resolve; });
  }
  function closeModal(value) {
    $('modal').classList.add('is-hidden');
    if (modalResolve) modalResolve(value);
    modalResolve = null;
  }

  function snapshotMarket(market) {
    if (!market) return null;
    if (market.kind === 'binance') {
      return {
        id: market.id, kind: 'binance', symbol: market.symbol,
        base: market.base, quote: market.quote, name: market.name,
      };
    }
    return {
      id: market.id,
      kind: 'dex',
      chain: market.chain,
      address: market.address,
      pairAddress: market.pairAddress,
      dexId: market.dexId,
      base: market.base,
      quote: market.quote,
      name: market.name,
      gecko: market.gecko || null,
      priceUsd: market.priceUsd,
      liquidity: market.liquidity,
      change24: market.change24,
    };
  }

  function persist() {
    try {
      const data = {
        v: 1,
        balance: state.balance,
        startBalance: state.startBalance,
        positions: state.positions,
        orders: state.orders,
        trades: state.trades.slice(0, 500),
        drawings: state.drawings,
        dexMarkets: state.dexMarkets,
        customTags: state.customTags,
        activeId: state.active ? state.active.id : state.activeId,
        interval: state.interval,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error(err);
      toast('Could not save the desk in this browser.', 'error');
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  }

  function finite(n) {
    return Number.isFinite(Number(n));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return;
      if (finite(data.balance)) state.balance = round2(data.balance);
      if (finite(data.startBalance)) state.startBalance = round2(data.startBalance);
      state.positions = Array.isArray(data.positions) ? data.positions.filter(validPosition) : [];
      state.orders = Array.isArray(data.orders) ? data.orders.filter(validOrder) : [];
      state.trades = Array.isArray(data.trades) ? data.trades.filter(validTrade).slice(0, 500) : [];
      state.drawings = data.drawings && typeof data.drawings === 'object' ? data.drawings : {};
      state.dexMarkets = Array.isArray(data.dexMarkets) ? data.dexMarkets.filter(validDex).slice(0, 12) : [];
      state.customTags = Array.isArray(data.customTags) ? data.customTags.filter((tag) => typeof tag === 'string').slice(0, 24) : [];
      if (typeof data.activeId === 'string') state.activeId = data.activeId;
      if (INTERVALS.includes(data.interval)) state.interval = data.interval;
    } catch (err) {
      console.error(err);
      toast('Saved desk was unreadable. Starting fresh.', 'error');
    }
  }

  function validPosition(pos) {
    return pos && typeof pos.id === 'string' && typeof pos.marketId === 'string'
      && (pos.side === 'long' || pos.side === 'short')
      && finite(pos.entry) && finite(pos.qty) && finite(pos.margin) && pos.market;
  }

  function validOrder(order) {
    return order && typeof order.id === 'string' && finite(order.limit) && finite(order.margin) && order.market;
  }

  function validTrade(trade) {
    return trade && finite(trade.pnl) && finite(trade.closedAt) && finite(trade.entry) && finite(trade.exit);
  }

  function validDex(market) {
    return market && market.kind === 'dex' && market.chain && market.address && market.pairAddress && market.id;
  }

  function markets() {
    return [...MAJORS, ...state.dexMarkets];
  }

  function findMarket(id) {
    return markets().find((market) => market.id === id) || null;
  }

  function hasExposure(id) {
    return state.positions.some((pos) => pos.marketId === id) || state.orders.some((order) => order.marketId === id);
  }

  function upnl(pos) {
    const px = state.last[pos.marketId];
    if (!Number.isFinite(px)) return 0;
    return pos.side === 'long' ? (px - pos.entry) * pos.qty : (pos.entry - px) * pos.qty;
  }

  function lockedMargin() {
    const pos = state.positions.reduce((sum, item) => sum + item.margin, 0);
    const ord = state.orders.reduce((sum, item) => sum + item.margin, 0);
    return pos + ord;
  }

  function unrealized() {
    return state.positions.reduce((sum, pos) => sum + upnl(pos), 0);
  }

  function equityNow() {
    return state.balance + lockedMargin() + unrealized();
  }

  function optionalPrice(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return { ok: true, value: null };
    const n = num(text);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, value: null };
    return { ok: true, value: n };
  }

  function canonicalTag(raw) {
    let tag = String(raw ?? '').trim().replace(/\s+/g, '');
    if (!tag) return null;
    if (!tag.startsWith('#')) tag = `#${tag}`;
    if (!/^#[A-Za-z][A-Za-z0-9_]{1,16}$/.test(tag)) return null;
    const preset = PRESETS.find((item) => item.toLowerCase() === tag.toLowerCase());
    return preset || tag;
  }

  function drawings() {
    if (!state.active) return [];
    if (!Array.isArray(state.drawings[state.active.id])) state.drawings[state.active.id] = [];
    return state.drawings[state.active.id];
  }

  function makeTrail(side, entry, distance) {
    if (!distance) return null;
    return {
      distance,
      extreme: entry,
      stop: side === 'long' ? entry * (1 - distance) : entry * (1 + distance),
    };
  }

  function effectiveStop(pos) {
    const stops = [];
    if (pos.sl != null && Number.isFinite(pos.sl)) stops.push(pos.sl);
    if (pos.trail && Number.isFinite(pos.trail.stop)) stops.push(pos.trail.stop);
    if (!stops.length) return null;
    return pos.side === 'long' ? Math.max(...stops) : Math.min(...stops);
  }

  function bindingReason(pos) {
    if (!pos.trail || !Number.isFinite(pos.trail.stop)) return 'sl';
    if (pos.sl == null) return 'trail';
    if (pos.side === 'long') return pos.trail.stop >= pos.sl ? 'trail' : 'sl';
    return pos.trail.stop <= pos.sl ? 'trail' : 'sl';
  }

  function updateTrail(pos, price) {
    if (!pos.trail) return false;
    if (pos.side === 'long' && price > pos.trail.extreme) {
      pos.trail.extreme = price;
      pos.trail.stop = price * (1 - pos.trail.distance);
      return true;
    }
    if (pos.side === 'short' && price < pos.trail.extreme) {
      pos.trail.extreme = price;
      pos.trail.stop = price * (1 + pos.trail.distance);
      return true;
    }
    return false;
  }

  function closePosition(pos, exit, reason) {
    const raw = pos.side === 'long' ? (exit - pos.entry) * pos.qty : (pos.entry - exit) * pos.qty;
    const pnl = round2(raw);
    state.balance = round2(state.balance + pos.margin + pnl);
    state.positions = state.positions.filter((item) => item.id !== pos.id);
    state.trades.unshift({
      id: uid(),
      marketId: pos.marketId,
      symbol: pos.symbol,
      pair: pos.pair,
      side: pos.side,
      qty: pos.qty,
      entry: pos.entry,
      exit,
      pnl,
      reason,
      tags: pos.tags || [],
      openedAt: pos.openedAt,
      closedAt: Date.now(),
    });
    if (state.trades.length > 500) state.trades.length = 500;
    removeLines(pos.id);
    persist();
    renderAll();
    toast(`Closed ${pos.side} ${pos.symbol} ${signedMoney(pnl)} · ${REASONS[reason] || reason}`);
  }

  function fillLimit(order, fill) {
    state.orders = state.orders.filter((item) => item.id !== order.id);
    state.positions.unshift({
      id: uid(),
      marketId: order.marketId,
      market: order.market,
      symbol: order.symbol,
      pair: order.pair,
      side: order.side,
      qty: order.margin / fill,
      entry: fill,
      margin: order.margin,
      tp: order.tp,
      sl: order.sl,
      trail: makeTrail(order.side, fill, order.trailDistance),
      tags: order.tags || [],
      openedAt: Date.now(),
    });
    removeLines(order.id);
    persist();
    renderAll();
    toast(`Limit filled ${order.symbol} @ ${formatPrice(fill)}`);
  }

  function evaluate(id, price) {
    if (evalLock || !Number.isFinite(price)) return;
    evalLock = true;
    try {
      let moved = false;
      for (const order of [...state.orders]) {
        if (order.marketId !== id) continue;
        const hit = order.side === 'long' ? price <= order.limit : price >= order.limit;
        if (hit) fillLimit(order, price);
      }
      for (const pos of [...state.positions]) {
        if (pos.marketId !== id) continue;
        if (updateTrail(pos, price)) moved = true;
        if (pos.side === 'long') {
          if (pos.tp != null && price >= pos.tp) {
            closePosition(pos, pos.tp, 'tp');
            continue;
          }
          const stop = effectiveStop(pos);
          if (stop != null && price <= stop) closePosition(pos, stop, bindingReason(pos));
        } else {
          if (pos.tp != null && price <= pos.tp) {
            closePosition(pos, pos.tp, 'tp');
            continue;
          }
          const stop = effectiveStop(pos);
          if (stop != null && price >= stop) closePosition(pos, stop, bindingReason(pos));
        }
      }
      if (moved) saveSoon();
    } finally {
      evalLock = false;
    }
  }

  function pushPrice(id, price) {
    if (!Number.isFinite(price) || price <= 0) return;
    state.last[id] = price;
    if (!state.stats[id]) state.stats[id] = { price, changePct: null };
    else state.stats[id].price = price;
    evaluate(id, price);
    queuePaint();
  }

  function placeOrder() {
    if (state.submitting) return;
    const market = state.active;
    if (!market) return;
    const price = state.last[market.id];
    if (!Number.isFinite(price)) {
      toast('Waiting for a live price.', 'error');
      return;
    }
    const margin = round2(num($('sizeUsd').value));
    if (!Number.isFinite(margin) || margin < 10) {
      toast('Minimum size is $10.', 'error');
      return;
    }
    if (margin > round2(state.balance)) {
      toast('Not enough buying power.', 'error');
      return;
    }
    const limit = optionalPrice($('limitPrice').value);
    const tp = optionalPrice($('tpPrice').value);
    const sl = optionalPrice($('slPrice').value);
    if (!tp.ok) { toast('Take-profit must be a price.', 'error'); return; }
    if (!sl.ok) { toast('Stop-loss must be a price.', 'error'); return; }
    let entry = price;
    if (state.draftType === 'limit') {
      if (!limit.ok || limit.value == null) {
        toast('Enter a limit price.', 'error');
        return;
      }
      entry = limit.value;
    }
    if (state.draftSide === 'long') {
      if (tp.value != null && tp.value <= entry) { toast('Long take-profit sits above entry.', 'error'); return; }
      if (sl.value != null && sl.value >= entry) { toast('Long stop sits below entry.', 'error'); return; }
    } else {
      if (tp.value != null && tp.value >= entry) { toast('Short take-profit sits below entry.', 'error'); return; }
      if (sl.value != null && sl.value <= entry) { toast('Short stop sits above entry.', 'error'); return; }
    }
    let trailDistance = null;
    if ($('trailEnabled').checked) {
      const pct = num($('trailPct').value);
      if (!Number.isFinite(pct) || pct < 0.1 || pct > 50) {
        toast('Trailing distance must be between 0.1% and 50%.', 'error');
        return;
      }
      trailDistance = pct / 100;
    }
    state.submitting = true;
    try {
      state.balance = round2(state.balance - margin);
      const shared = {
        marketId: market.id,
        market: snapshotMarket(market),
        symbol: market.base,
        pair: market.kind === 'binance' ? market.symbol : `${market.base}/${market.quote}`,
        side: state.draftSide,
        margin,
        tp: tp.value,
        sl: sl.value,
        tags: [...state.selectedTags],
      };
      if (state.draftType === 'limit') {
        const marketable = state.draftSide === 'long' ? price <= entry : price >= entry;
        if (marketable) {
          state.positions.unshift({
            ...shared,
            id: uid(),
            qty: margin / price,
            entry: price,
            trail: makeTrail(state.draftSide, price, trailDistance),
            openedAt: Date.now(),
          });
          toast(`Marketable limit filled at ${formatPrice(price)}.`);
        } else {
          state.orders.unshift({
            ...shared,
            id: uid(),
            type: 'limit',
            limit: entry,
            trailDistance,
            createdAt: Date.now(),
          });
          toast('Limit is working.');
        }
      } else {
        state.positions.unshift({
          ...shared,
          id: uid(),
          qty: margin / price,
          entry: price,
          trail: makeTrail(state.draftSide, price, trailDistance),
          openedAt: Date.now(),
        });
        toast(`${state.draftSide === 'long' ? 'Long' : 'Short'} ${market.base} filled.`);
      }
      clearPriceInputs();
      $('trailEnabled').checked = false;
      persist();
      syncFeeds();
      renderAll();
      syncPriceLines();
      drawOverlay();
    } finally {
      state.submitting = false;
    }
  }

  function cancelOrder(id) {
    const order = state.orders.find((item) => item.id === id);
    if (!order) return;
    state.balance = round2(state.balance + order.margin);
    state.orders = state.orders.filter((item) => item.id !== id);
    removeLines(id);
    persist();
    syncFeeds();
    renderAll();
    toast('Limit cancelled. Margin returned.');
  }

  function manualClose(id) {
    const pos = state.positions.find((item) => item.id === id);
    if (!pos) return;
    const px = state.last[pos.marketId];
    if (!Number.isFinite(px)) {
      toast('No live price to close against.', 'error');
      return;
    }
    closePosition(pos, px, 'manual');
    syncFeeds();
  }

  async function binanceGet(path) {
    let lastError = null;
    for (const base of REST_BASES) {
      try {
        const res = await fetch(base + path);
        const data = await res.json();
        if (!res.ok || (data && data.code && data.msg)) {
          lastError = new Error(data && data.msg ? data.msg : 'Binance refused the request');
          continue;
        }
        return data;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Binance is unavailable');
  }

  function connectWs(path, onMessage, hooks) {
    let attempt = 0;
    let stopped = false;
    let socket = null;
    let timer = 0;
    const open = () => {
      if (stopped) return;
      const base = WS_BASES[attempt % WS_BASES.length];
      let ws;
      try {
        ws = new WebSocket(base + path);
      } catch (err) {
        console.error(err);
        attempt += 1;
        timer = setTimeout(open, 1500);
        return;
      }
      socket = ws;
      ws.onmessage = (event) => {
        try { onMessage(event); } catch (err) { console.error(err); }
      };
      ws.onopen = () => {
        attempt = 0;
        if (hooks.onOpen) hooks.onOpen();
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        if (hooks.onClose) hooks.onClose();
        if (stopped) return;
        attempt += 1;
        if (hooks.onRetry) hooks.onRetry(attempt);
        timer = setTimeout(open, Math.min(8000, 400 * 2 ** Math.min(attempt, 5)));
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        try { socket.close(); } catch (err) { console.error(err); }
      }
    };
  }

  function handleMini(event) {
    const msg = JSON.parse(event.data);
    const tick = msg.data || msg;
    if (!tick.s || tick.c == null) return;
    const id = tick.s;
    const price = Number(tick.c);
    const open = Number(tick.o);
    const changePct = open ? ((price - open) / open) * 100 : null;
    const activeKline = state.active && state.active.kind === 'binance' && state.active.id === id && state.klineLive;
    const prev = state.stats[id] || {};
    state.stats[id] = {
      price: activeKline ? (state.last[id] ?? price) : price,
      changePct: changePct == null ? prev.changePct : changePct,
    };
    if (!activeKline) pushPrice(id, price);
    else queuePaint();
  }

  function handleKline(event) {
    const msg = JSON.parse(event.data);
    const kline = msg.k || (msg.data && msg.data.k);
    if (!kline || !state.active || state.active.kind !== 'binance') return;
    if (kline.s !== state.active.symbol || kline.i !== state.interval) return;
    const bar = normalizeBar({
      time: Math.floor(kline.t / 1000),
      open: Number(kline.o),
      high: Number(kline.h),
      low: Number(kline.l),
      close: Number(kline.c),
      volume: Number(kline.v),
    });
    commitBar(bar);
    state.klineLive = true;
    state.chartError = false;
    pushPrice(state.active.id, bar.close);
    paintConnection();
  }

  function ensureMini() {
    if (miniStarted) return;
    miniStarted = true;
    const streams = MAJORS.map((market) => `${market.symbol.toLowerCase()}@miniTicker`).join('/');
    stopMini = connectWs(`/stream?streams=${streams}`, handleMini, {
      onOpen: () => queuePaint(),
      onClose: () => {},
    });
  }

  function syncFeeds() {
    ensureMini();
    if (state.active && state.active.kind === 'binance') {
      const path = `/ws/${state.active.symbol.toLowerCase()}@kline_${state.interval}`;
      if (path !== state.klinePath) {
        state.klinePath = path;
        state.klineLive = false;
        stopKline();
        stopKline = connectWs(path, handleKline, {
          onOpen: () => {
            state.klineLive = true;
            state.klineTries = 0;
            state.chartError = false;
            paintConnection();
          },
          onClose: () => {
            state.klineLive = false;
            paintConnection();
          },
          onRetry: (attempt) => {
            state.klineTries = attempt;
            paintConnection();
          },
        });
      }
    } else {
      state.klinePath = '';
      state.klineLive = false;
      stopKline();
      stopKline = () => {};
    }
    syncDexJobs();
    paintConnection();
  }

  function syncDexJobs() {
    const needed = new Map();
    const add = (market) => {
      if (market && market.kind === 'dex') needed.set(market.id, market);
    };
    state.positions.forEach((pos) => add(pos.market));
    state.orders.forEach((order) => add(order.market));
    add(state.active);
    for (const [id, job] of dexJobs) {
      if (!needed.has(id)) {
        clearInterval(job.timer);
        dexJobs.delete(id);
      }
    }
    for (const [id, market] of needed) {
      const job = dexJobs.get(id);
      if (job) job.market = market;
      else {
        const created = { market, warned: false, timer: setInterval(() => pollDex(id), 4000) };
        dexJobs.set(id, created);
        pollDex(id);
      }
    }
  }

  async function pollDex(id) {
    const job = dexJobs.get(id);
    if (!job) return;
    const market = job.market;
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(market.chain)}/${encodeURIComponent(market.pairAddress)}`);
      if (!res.ok) throw new Error(`DexScreener ${res.status}`);
      const data = await res.json();
      const pair = (data.pairs && data.pairs[0]) || data.pair;
      const price = pair ? Number(pair.priceUsd) : NaN;
      if (!Number.isFinite(price) || price <= 0) throw new Error('No pool price');
      const change = pair.priceChange && pair.priceChange.h24 != null ? Number(pair.priceChange.h24) : null;
      state.stats[id] = {
        price,
        changePct: change,
        liquidity: pair.liquidity && pair.liquidity.usd,
      };
      if (state.active && state.active.id === id) {
        state.dexLive = true;
        state.dexError = false;
        state.chartError = false;
        rollCandle(price);
        paintConnection();
      }
      job.warned = false;
      pushPrice(id, price);
    } catch (err) {
      console.error(err);
      if (state.active && state.active.id === id) {
        state.dexLive = false;
        state.dexError = true;
        paintConnection();
      }
      if (!job.warned) {
        job.warned = true;
        toast('DexScreener price update failed. Retrying.', 'error');
      }
    }
  }

  function mapRestKline(row) {
    return normalizeBar({
      time: Math.floor(row[0] / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    });
  }

  function normalizeBar(bar) {
    const open = Number(bar.open);
    const close = Number(bar.close);
    return {
      time: Number(bar.time),
      open,
      close,
      high: Math.max(Number(bar.high), open, close),
      low: Math.min(Number(bar.low), open, close),
      volume: Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : 0,
    };
  }

  function cleanBars(bars) {
    const sorted = bars
      .filter((bar) => Number.isFinite(bar.time) && Number.isFinite(bar.open) && Number.isFinite(bar.close) && bar.high >= bar.low)
      .sort((a, b) => a.time - b.time);
    const out = [];
    for (const bar of sorted) {
      const prev = out[out.length - 1];
      if (prev && prev.time === bar.time) out[out.length - 1] = bar;
      else out.push(bar);
    }
    return out;
  }

  function seedCandle(price, interval) {
    const sec = INTERVAL_SEC[interval];
    const time = Math.floor(Date.now() / 1000 / sec) * sec;
    return [normalizeBar({ time, open: price, high: price, low: price, close: price, volume: 0 })];
  }

  async function fetchGecko(market, interval) {
    if (!market.gecko) throw new Error('No pool history for this chain.');
    const spec = GECKO_TF[interval];
    const url = `https://api.geckoterminal.com/api/v2/networks/${market.gecko}/pools/${encodeURIComponent(market.pairAddress)}/ohlcv/${spec[0]}?aggregate=${spec[1]}&limit=300&currency=usd`;
    const res = await fetch(url);
    if (res.status === 429) throw new Error('Chart history is rate limited.');
    if (!res.ok) throw new Error('Pool history is unavailable.');
    const data = await res.json();
    const list = data && data.data && data.data.attributes && data.data.attributes.ohlcv_list;
    if (!Array.isArray(list)) throw new Error('Pool history is unavailable.');
    return cleanBars(list.map((row) => normalizeBar({
      time: row[0] > 1e12 ? Math.floor(row[0] / 1000) : row[0],
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5] || 0),
    })));
  }

  async function fetchCandles(market, interval) {
    if (market.kind === 'binance') {
      const rows = await binanceGet(`/api/v3/klines?symbol=${market.symbol}&interval=${interval}&limit=300`);
      if (!Array.isArray(rows) || !rows.length) throw new Error('Candle history was empty.');
      return cleanBars(rows.map(mapRestKline));
    }
    const price = Number(market.priceUsd || state.last[market.id]);
    try {
      const bars = await fetchGecko(market, interval);
      if (bars.length) return bars;
    } catch (err) {
      console.error(err);
      if (!historyWarned.has(market.id)) {
        historyWarned.add(market.id);
        toast(err.message || 'Pool history is unavailable. Charting live ticks only.', 'error');
      }
    }
    if (!Number.isFinite(price) || price <= 0) throw new Error('No price for this pool yet.');
    return seedCandle(price, interval);
  }

  function showLoading(on) {
    $('chartLoading').classList.toggle('is-hidden', !on);
  }

  function showChartMessage(message) {
    const el = $('chartMessage');
    if (!message) {
      el.textContent = '';
      el.classList.add('is-hidden');
      el.classList.remove('flex');
      return;
    }
    el.textContent = message;
    el.classList.remove('is-hidden');
    el.classList.add('flex');
  }

  async function reloadCandles() {
    const market = state.active;
    if (!market) return;
    const interval = state.interval;
    const gen = ++state.loadGen;
    barsReady = false;
    state.chartError = false;
    showChartMessage('');
    showLoading(true);
    try {
      const bars = await fetchCandles(market, interval);
      if (gen !== state.loadGen) return;
      if (!bars.length) throw new Error('No candles returned.');
      applyBars(bars);
      showLoading(false);
    } catch (err) {
      if (gen !== state.loadGen) return;
      console.error(err);
      barsReady = false;
      state.candles = [];
      clearAllLines();
      if (candleSeries) {
        try {
          candleSeries.setData([]);
          volumeSeries.setData([]);
        } catch (inner) { console.error(inner); }
      }
      showLoading(false);
      state.chartError = true;
      showChartMessage(err.message || 'Candles unavailable.');
      toast(err.message || 'Could not load candles.', 'error');
    }
    paintConnection();
  }

  async function setActive(market, opts = {}) {
    const same = state.active && state.active.id === market.id && !opts.force;
    state.active = market;
    state.activeId = market.id;
    if (!same) clearPriceInputs();
    if (market.kind === 'dex') {
      state.dexLive = false;
      state.dexError = false;
    }
    persist();
    renderWatchlist();
    renderMeta();
    renderTicket();
    renderDrawingChips();
    syncFeeds();
    if (!same || opts.force) await reloadCandles();
    syncPriceLines();
    drawOverlay();
    paintConnection();
  }

  async function setInterval(interval) {
    if (!INTERVALS.includes(interval) || interval === state.interval) return;
    state.interval = interval;
    persist();
    renderIntervals();
    syncFeeds();
    await reloadCandles();
  }

  function clearPriceInputs() {
    ['limitPrice', 'tpPrice', 'slPrice'].forEach((id) => { $(id).value = ''; });
  }

  function toCandle(bar) {
    return { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
  }

  function toVol(bar) {
    return {
      time: bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? 'rgba(20,241,149,0.45)' : 'rgba(255,93,115,0.45)',
    };
  }

  function commitBar(bar) {
    if (!barsReady || !candleSeries) return;
    const next = normalizeBar(bar);
    const last = state.candles[state.candles.length - 1];
    if (last && next.time < last.time) return;
    if (!last || next.time > last.time) state.candles.push(next);
    else state.candles[state.candles.length - 1] = next;
    try {
      candleSeries.update(toCandle(next));
      volumeSeries.update(toVol(next));
    } catch (err) {
      console.error(err);
    }
    paintLegend(next);
  }

  function rollCandle(price) {
    if (!barsReady || !state.candles.length) return;
    const sec = INTERVAL_SEC[state.interval];
    const bucket = Math.floor(Date.now() / 1000 / sec) * sec;
    const last = state.candles[state.candles.length - 1];
    const time = bucket >= last.time ? bucket : last.time;
    if (time === last.time) {
      commitBar({
        time,
        open: last.open,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
        volume: last.volume,
      });
    } else {
      commitBar({ time, open: price, high: price, low: price, close: price, volume: 0 });
    }
  }

  function applyBars(bars) {
    state.candles = bars;
    clearAllLines();
    candleSeries.setData(bars.map(toCandle));
    volumeSeries.setData(bars.map(toVol));
    barsReady = true;
    const count = bars.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, count - 90), to: count + 5 });
    showChartMessage('');
    const last = bars[bars.length - 1];
    paintLegend(last);
    if (state.active && last) pushPrice(state.active.id, last.close);
    syncPriceLines();
    drawOverlay();
  }

  function clearAllLines() {
    if (!candleSeries) {
      priceLines.clear();
      return;
    }
    for (const line of priceLines.values()) {
      try { candleSeries.removePriceLine(line); } catch (err) { console.error(err); }
    }
    priceLines.clear();
  }

  function removeLines(prefix) {
    for (const [key, line] of priceLines) {
      if (!key.startsWith(`${prefix}:`)) continue;
      try { candleSeries.removePriceLine(line); } catch (err) { console.error(err); }
      priceLines.delete(key);
    }
  }

  function ghostLevels() {
    if (!state.active) return { entry: null, tp: null, sl: null };
    const tp = optionalPrice($('tpPrice').value);
    const sl = optionalPrice($('slPrice').value);
    const limit = optionalPrice($('limitPrice').value);
    const live = state.last[state.active.id];
    const entry = state.draftType === 'limit' && limit.ok && limit.value ? limit.value : live;
    return {
      entry: Number.isFinite(entry) ? entry : null,
      tp: tp.ok ? tp.value : null,
      sl: sl.ok ? sl.value : null,
    };
  }

  function syncPriceLines() {
    if (!candleSeries || !barsReady || !state.active) return;
    const wanted = new Map();
    const add = (key, price, color, style, title) => {
      if (!Number.isFinite(price) || price <= 0) return;
      wanted.set(key, { price, color, style, title });
    };
    for (const pos of state.positions) {
      if (pos.marketId !== state.active.id) continue;
      add(`${pos.id}:entry`, pos.entry, 'rgba(244,242,251,0.7)', 2, `${pos.symbol} entry`);
      add(`${pos.id}:tp`, pos.tp, '#14f195', 0, 'TP');
      add(`${pos.id}:sl`, pos.sl, '#ff5d73', 0, 'SL');
      if (pos.trail) add(`${pos.id}:trail`, pos.trail.stop, '#f7d154', 2, 'TRAIL');
    }
    for (const order of state.orders) {
      if (order.marketId !== state.active.id) continue;
      add(`${order.id}:limit`, order.limit, '#7c8cff', 2, 'LIMIT');
      add(`${order.id}:tp`, order.tp, 'rgba(20,241,149,0.8)', 1, 'TP');
      add(`${order.id}:sl`, order.sl, 'rgba(255,93,115,0.8)', 1, 'SL');
    }
    const ghost = ghostLevels();
    const limitDraft = optionalPrice($('limitPrice').value);
    add('ghost:tp', ghost.tp, 'rgba(20,241,149,0.55)', 1, 'TP preview');
    add('ghost:sl', ghost.sl, 'rgba(255,93,115,0.55)', 1, 'SL preview');
    if (state.draftType === 'limit' && limitDraft.ok && limitDraft.value) {
      add('ghost:limit', limitDraft.value, 'rgba(124,140,255,0.7)', 2, 'Limit preview');
    }
    if ($('trailEnabled').checked && Number.isFinite(ghost.entry)) {
      const pct = num($('trailPct').value);
      if (pct >= 0.1 && pct <= 50) {
        const distance = pct / 100;
        const stop = state.draftSide === 'long' ? ghost.entry * (1 - distance) : ghost.entry * (1 + distance);
        add('ghost:trail', stop, 'rgba(247,209,84,0.8)', 1, 'Trail preview');
      }
    }
    for (const [key, line] of priceLines) {
      if (wanted.has(key)) continue;
      try { candleSeries.removePriceLine(line); } catch (err) { console.error(err); }
      priceLines.delete(key);
    }
    for (const [key, opt] of wanted) {
      const existing = priceLines.get(key);
      if (existing) {
        existing.applyOptions({ price: opt.price, color: opt.color, title: opt.title, lineStyle: opt.style });
      } else {
        try {
          priceLines.set(key, candleSeries.createPriceLine({
            price: opt.price,
            color: opt.color,
            lineWidth: 1,
            lineStyle: opt.style,
            axisLabelVisible: true,
            title: opt.title,
          }));
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  function initChart() {
    if (typeof LightweightCharts === 'undefined') {
      showFatal('Chart library failed to load. Check the connection and refresh.');
      return;
    }
    const wrap = $('chartWrap');
    chart = LightweightCharts.createChart($('chart'), {
      width: wrap.clientWidth,
      height: wrap.clientHeight,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#9a96ad',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode ? LightweightCharts.CrosshairMode.Normal : 0,
        vertLine: { color: 'rgba(171,159,242,0.45)', labelBackgroundColor: '#1c1b26' },
        horzLine: { color: 'rgba(171,159,242,0.45)', labelBackgroundColor: '#1c1b26' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      localization: { priceFormatter: (price) => formatPrice(price) },
    });
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    candleSeries = chart.addCandlestickSeries({
      upColor: '#14f195',
      downColor: '#ff5d73',
      borderUpColor: '#14f195',
      borderDownColor: '#ff5d73',
      wickUpColor: '#14f195',
      wickDownColor: '#ff5d73',
      priceLineColor: '#c4b5fd',
    });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    chart.subscribeCrosshairMove((param) => {
      if (!param || param.time == null || !param.seriesData || !param.seriesData.get) {
        const last = state.candles[state.candles.length - 1];
        if (last) paintLegend(last);
        return;
      }
      const bar = param.seriesData.get(candleSeries);
      if (!bar) return;
      const vol = param.seriesData.get(volumeSeries);
      paintLegend({
        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        volume: vol ? vol.value : null,
      });
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawOverlay());
    overlayCtx = $('overlay').getContext('2d');
    new ResizeObserver(() => resizeChart()).observe(wrap);
    resizeChart();
  }

  function resizeChart() {
    if (!chart) return;
    const wrap = $('chartWrap');
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (width < 10 || height < 10) return;
    chart.resize(width, height);
    sizeOverlay();
    drawOverlay();
  }

  function sizeOverlay() {
    const canvas = $('overlay');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function timeToNum(value) {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && Number.isFinite(value.timestamp)) return value.timestamp;
    if (typeof value === 'object' && value.year) return Date.UTC(value.year, value.month - 1, value.day) / 1000;
    return null;
  }

  function timeToX(time) {
    if (!chart) return null;
    const direct = chart.timeScale().timeToCoordinate(time);
    if (direct != null) return direct;
    const range = chart.timeScale().getVisibleRange();
    if (!range) return null;
    const x1 = chart.timeScale().timeToCoordinate(range.from);
    const x2 = chart.timeScale().timeToCoordinate(range.to);
    const t1 = timeToNum(range.from);
    const t2 = timeToNum(range.to);
    if (x1 == null || x2 == null || t1 == null || t2 == null || t1 === t2) return null;
    return x1 + ((time - t1) / (t2 - t1)) * (x2 - x1);
  }

  function priceToY(price) {
    if (!candleSeries || !Number.isFinite(price)) return null;
    const direct = candleSeries.priceToCoordinate(price);
    if (direct != null) return direct;
    const plotH = Math.max(10, $('overlay').clientHeight - 28);
    const top = candleSeries.coordinateToPrice(0);
    const bot = candleSeries.coordinateToPrice(plotH);
    if (top == null || bot == null || top === bot) return null;
    return ((top - price) / (top - bot)) * plotH;
  }

  function eventToPoint(event) {
    const rect = $('overlay').getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const time = timeToNum(chart.timeScale().coordinateToTime(x));
    const price = candleSeries.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time, price };
  }

  function drawBand(ctx, plotW, y1, y2, color) {
    if (y1 == null || y2 == null) return;
    ctx.fillStyle = color;
    ctx.fillRect(0, Math.min(y1, y2), plotW, Math.abs(y2 - y1));
  }

  function drawOverlay() {
    if (!overlayCtx || !chart || !candleSeries) return;
    const canvas = $('overlay');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 8 || height < 8) return;
    overlayCtx.clearRect(0, 0, width, height);
    const plotW = chart.timeScale().width() || width;
    overlayCtx.save();
    overlayCtx.beginPath();
    overlayCtx.rect(0, 0, plotW, height);
    overlayCtx.clip();
    try {
      if (state.active) {
        for (const pos of state.positions) {
          if (pos.marketId !== state.active.id) continue;
          const yEntry = priceToY(pos.entry);
          drawBand(overlayCtx, plotW, yEntry, priceToY(pos.tp), 'rgba(20,241,149,0.08)');
          drawBand(overlayCtx, plotW, yEntry, priceToY(pos.sl), 'rgba(255,93,115,0.08)');
          strokeBracket(overlayCtx, plotW, yEntry, priceToY(pos.tp), '#14f195');
          strokeBracket(overlayCtx, plotW, yEntry, priceToY(pos.sl), '#ff5d73');
        }
        const ghost = ghostLevels();
        if (ghost.entry) {
          drawBand(overlayCtx, plotW, priceToY(ghost.entry), priceToY(ghost.tp), 'rgba(20,241,149,0.05)');
          drawBand(overlayCtx, plotW, priceToY(ghost.entry), priceToY(ghost.sl), 'rgba(255,93,115,0.05)');
        }
        for (const drawing of drawings()) {
          if (drawing.type === 'trend') drawTrend(overlayCtx, drawing.a, drawing.b, '#ab9ff2');
          if (drawing.type === 'fib') drawFib(overlayCtx, drawing, plotW);
        }
        if (draftPoint && previewPoint && state.drawMode === 'trend') drawTrend(overlayCtx, draftPoint, previewPoint, 'rgba(171,159,242,0.7)');
        if (draftPoint && previewPoint && state.drawMode === 'fib') drawFib(overlayCtx, { a: draftPoint, b: previewPoint }, plotW);
        if (draftPoint) {
          const dot = { x: timeToX(draftPoint.time), y: priceToY(draftPoint.price) };
          if (dot.x != null && dot.y != null) {
            overlayCtx.fillStyle = '#ab9ff2';
            overlayCtx.beginPath();
            overlayCtx.arc(dot.x, dot.y, 3.5, 0, Math.PI * 2);
            overlayCtx.fill();
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
    overlayCtx.restore();
  }

  function strokeBracket(ctx, plotW, y1, y2, color) {
    if (y1 == null || y2 == null) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotW - 10, y1);
    ctx.lineTo(plotW - 10, y2);
    ctx.stroke();
  }

  function drawTrend(ctx, a, b, color) {
    const x1 = timeToX(a.time);
    const y1 = priceToY(a.price);
    const x2 = timeToX(b.time);
    const y2 = priceToY(b.price);
    if ([x1, y1, x2, y2].some((v) => v == null)) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = color;
    [ [x1, y1], [x2, y2] ].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawFib(ctx, drawing, plotW) {
    const left = Math.min(timeToX(drawing.a.time) ?? 0, timeToX(drawing.b.time) ?? 0);
    ctx.font = '11px JetBrains Mono, monospace';
    FIBS.forEach((level) => {
      const price = drawing.a.price + (drawing.b.price - drawing.a.price) * level.level;
      const y = priceToY(price);
      if (y == null) return;
      ctx.strokeStyle = level.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, left), y);
      ctx.lineTo(plotW - 14, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = level.color;
      ctx.fillText(`${level.label}  ${formatPrice(price)}`, Math.max(8, left + 8), y - 4);
    });
  }

  function setDrawMode(mode) {
    state.drawMode = state.drawMode === mode ? null : mode;
    draftPoint = null;
    previewPoint = null;
    $('overlay').classList.toggle('is-drawing', Boolean(state.drawMode));
    if (chart) {
      chart.applyOptions({
        handleScroll: !state.drawMode,
        handleScale: !state.drawMode,
      });
    }
    renderDrawTools();
    drawOverlay();
  }

  function paintLegend(bar) {
    if (!bar) return;
    const up = bar.close >= bar.open;
    const vol = bar.volume == null ? '' : `  V ${formatVol(bar.volume)}`;
    $('ohlcLegend').innerHTML = `O ${formatPrice(bar.open)}  H ${formatPrice(bar.high)}  L ${formatPrice(bar.low)}  C <span style="color:${up ? '#14f195' : '#ff5d73'}">${formatPrice(bar.close)}</span>${vol}`;
  }

  function paintConnection() {
    const label = $('connLabel');
    const dot = $('connDot');
    if (!state.active) return;
    let text = 'Connecting';
    let kind = 'wait';
    if (state.chartError) {
      text = 'Market data error';
      kind = 'bad';
    } else if (state.active.kind === 'binance') {
      if (state.klineLive) { text = 'Live · Binance'; kind = 'ok'; }
      else if (state.klineTries > 0) text = 'Reconnecting';
    } else if (state.dexLive) {
      text = 'Live · DexScreener';
      kind = 'ok';
    } else if (state.dexError) text = 'Price feed interrupted';
    if (window.matchMedia('(max-width: 1023px)').matches) {
      text = text
        .replace(' · Binance', '')
        .replace(' · DexScreener', '');
    }
    label.textContent = text;
    dot.dataset.kind = kind;
  }

  function queuePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      try {
        renderLive();
        syncPriceLines();
        drawOverlay();
      } catch (err) {
        console.error(err);
      }
    });
  }

  function renderLive() {
    const equity = equityNow();
    const delta = equity - state.startBalance;
    const pct = state.startBalance ? (delta / state.startBalance) * 100 : 0;
    $('equity').textContent = formatMoney(equity);
    const deltaEl = $('equityDelta');
    deltaEl.textContent = `${signedMoney(delta)} · ${formatChange(pct)}`;
    deltaEl.style.color = delta >= 0 ? '#14f195' : '#ff5d73';
    $('cash').textContent = formatMoney(state.balance);
    $('marginUsed').textContent = formatMoney(lockedMargin());
    const u = unrealized();
    const phoneEquity = $('phoneEquity');
    const phoneMeta = $('phoneMeta');
    if (phoneEquity) phoneEquity.textContent = formatMoney(equity);
    if (phoneMeta) {
      if (state.positions.length) {
        phoneMeta.textContent = `${signedMoney(u)} right now`;
        phoneMeta.style.color = u >= 0 ? '#14f195' : '#ff5d73';
      } else {
        phoneMeta.textContent = `Cash ${formatMoney(state.balance)}`;
        phoneMeta.style.color = '';
      }
    }
    paintOpenPnl(u);
    paintPortfolio();
    const uEl = $('unrealized');
    uEl.textContent = signedMoney(u);
    uEl.style.color = u >= 0 ? '#14f195' : '#ff5d73';
    $('buyingPower').textContent = `Buying power ${formatMoney(state.balance)}`;
    document.querySelectorAll('[data-chip-price]').forEach((el) => {
      const stats = state.stats[el.dataset.chipPrice];
      if (!stats || !Number.isFinite(stats.price)) return;
      el.textContent = formatPrice(stats.price);
    });
    document.querySelectorAll('[data-chip-change]').forEach((el) => {
      const stats = state.stats[el.dataset.chipChange];
      if (!stats) return;
      el.textContent = formatChange(stats.changePct);
      el.style.color = stats.changePct == null ? '#9a96ad' : stats.changePct >= 0 ? '#14f195' : '#ff5d73';
    });
    if (state.active) {
      const px = state.last[state.active.id];
      if (Number.isFinite(px)) $('marketPrice').textContent = formatPrice(px);
      const change = state.stats[state.active.id] && state.stats[state.active.id].changePct;
      const changeEl = $('marketChange');
      changeEl.textContent = formatChange(change);
      changeEl.style.color = change == null ? '#9a96ad' : change >= 0 ? '#14f195' : '#ff5d73';
    }
    state.positions.forEach((pos) => {
      const pnlEl = document.querySelector(`[data-pnl="${cssEscape(pos.id)}"]`);
      const markEl = document.querySelector(`[data-mark="${cssEscape(pos.id)}"]`);
      const trailEl = document.querySelector(`[data-trail="${cssEscape(pos.id)}"]`);
      const pnl = upnl(pos);
      if (pnlEl) {
        pnlEl.textContent = signedMoney(pnl);
        pnlEl.style.color = pnl >= 0 ? '#14f195' : '#ff5d73';
      }
      if (markEl) {
        const mark = state.last[pos.marketId];
        markEl.textContent = Number.isFinite(mark) ? formatPrice(mark) : '—';
      }
      if (trailEl) trailEl.textContent = pos.trail ? `Trail ${formatPrice(pos.trail.stop)}` : 'No trail';
    });
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function chainLabel(market) {
    if (market.kind === 'binance') return 'USDT';
    if (market.chain === 'solana') return 'SOL';
    if (market.chain === 'ethereum') return 'ETH';
    return String(market.chain || 'DEX').slice(0, 4).toUpperCase();
  }

  function renderWatchlist() {
    const html = markets().map((market) => {
      const on = state.active && state.active.id === market.id ? ' is-on' : '';
      const remove = market.kind === 'dex'
        ? `<button type="button" class="mini" data-remove-market="${esc(market.id)}" aria-label="Remove ${esc(market.base)}">×</button>`
        : '';
      return `<div class="flex items-stretch gap-1">
        <button type="button" class="market-chip${on}" data-market="${esc(market.id)}" title="${esc(market.name)}">
          <span class="flex items-center justify-between gap-3">
            <span class="font-semibold">${esc(market.base)}</span>
            <span class="text-[10px] uppercase muted">${esc(chainLabel(market))}</span>
          </span>
          <span class="mt-1 flex items-center justify-between gap-2 font-mono text-[11px]">
            <span data-chip-price="${esc(market.id)}">—</span>
            <span data-chip-change="${esc(market.id)}">—</span>
          </span>
        </button>
        ${remove}
      </div>`;
    }).join('');
    $('watchlist').innerHTML = html;
    renderLive();
  }

  function renderMeta() {
    const market = state.active;
    if (!market) return;
    $('marketName').textContent = market.name || market.base;
    if (market.kind === 'binance') {
      $('marketSub').textContent = `${market.symbol} · Binance`;
    } else {
      const liq = market.liquidity ? ` · liq ${formatCompact(market.liquidity)}` : '';
      $('marketSub').textContent = `${market.base}/${market.quote} · ${market.chain} · ${market.dexId || 'pool'}${liq}`;
    }
  }

  function renderIntervals() {
    $('intervalRow').innerHTML = INTERVALS.map((interval) => {
      const on = interval === state.interval ? ' is-on' : '';
      return `<button type="button" class="tool px-2.5${on}" data-interval="${interval}">${interval}</button>`;
    }).join('');
  }

  function renderDrawTools() {
    const tools = [
      ['cursor', 'Cursor'],
      ['trend', 'Trend'],
      ['fib', 'Fib'],
    ];
    $('drawTools').innerHTML = tools.map(([id, label]) => {
      const on = (id === 'cursor' && !state.drawMode) || state.drawMode === id ? ' is-on' : '';
      return `<button type="button" class="tool px-2.5${on}" data-draw="${id}">${label}</button>`;
    }).join('') + '<button type="button" class="tool px-2.5" data-draw="undo">Undo</button><button type="button" class="tool px-2.5" data-draw="clear">Clear</button>';
    const hints = {
      trend: draftPoint ? 'Click the second point of the trend' : 'Click the first point of the trend',
      fib: draftPoint ? 'Click the other swing of the Fibonacci' : 'Click the first swing of the Fibonacci',
    };
    $('drawHint').textContent = hints[state.drawMode] || 'Scroll and scale the chart, or draw a trend or Fibonacci';
  }

  function renderDrawingChips() {
    const list = state.active && Array.isArray(state.drawings[state.active.id]) ? state.drawings[state.active.id] : [];
    $('drawingChips').innerHTML = list.map((drawing) => {
      const name = drawing.type === 'fib' ? 'Fib' : 'Trend';
      return `<button type="button" class="mini" data-drop-drawing="${esc(drawing.id)}">${name} ${esc(formatPrice(drawing.a.price))} → ${esc(formatPrice(drawing.b.price))} ×</button>`;
    }).join('');
  }

  function paintOpenPnl(bookPnl) {
    const activeId = state.active && state.active.id;
    const mine = state.positions.filter((pos) => pos.marketId === activeId);
    const pnl = mine.reduce((sum, pos) => sum + upnl(pos), 0);
    const margin = mine.reduce((sum, pos) => sum + pos.margin, 0);
    const px = activeId ? state.last[activeId] : NaN;
    let text = '$0.00';
    let sub = 'No open trade. A fill starts the live number.';
    let color = '#9a96ad';
    if (mine.length) {
      const pct = margin ? (pnl / margin) * 100 : 0;
      text = signedMoney(pnl);
      sub = `${formatChange(pct)} on this coin${Number.isFinite(px) ? ` · mark ${formatPrice(px)}` : ''}`;
      color = pnl >= 0 ? '#14f195' : '#ff5d73';
    } else if (state.positions.length) {
      text = signedMoney(bookPnl);
      sub = 'Open profit is on another coin';
      color = bookPnl >= 0 ? '#14f195' : '#ff5d73';
    }
    [['livePnl', 'livePnlSub'], ['ticketPnl', 'ticketPnlSub']].forEach(([valueId, subId]) => {
      const valueEl = $(valueId);
      const subEl = $(subId);
      if (!valueEl || !subEl) return;
      valueEl.textContent = text;
      valueEl.style.color = color;
      subEl.textContent = sub;
    });
  }

  function renderTicket() {
    const market = state.active;
    $('ticketSymbol').textContent = market ? market.base : '—';
    $('ticketHint').textContent = market
      ? `${market.base} buys and sells spend paper cash. ${formatMoney(state.balance)} available.`
      : 'Buy and sell with paper cash.';
    $('sideToggle').querySelectorAll('[data-side]').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.side === state.draftSide);
    });
    $('typeToggle').querySelectorAll('[data-type]').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.type === state.draftType);
    });
    $('limitWrap').classList.toggle('is-hidden', state.draftType !== 'limit');
    $('trailWrap').classList.toggle('is-hidden', !$('trailEnabled').checked);
    const btn = $('submitOrder');
    btn.classList.toggle('long', state.draftSide === 'long');
    btn.classList.toggle('short', state.draftSide === 'short');
    if (state.draftSide === 'long') btn.textContent = state.draftType === 'limit' ? 'Place limit buy' : 'Buy / Long';
    else btn.textContent = state.draftType === 'limit' ? 'Place limit sell' : 'Sell / Short';
  }

  function tagCatalog() {
    const tags = [...PRESETS];
    state.customTags.forEach((tag) => { if (!tags.includes(tag)) tags.push(tag); });
    return tags;
  }

  function renderTags() {
    $('tagRow').innerHTML = tagCatalog().map((tag) => {
      const on = state.selectedTags.has(tag) ? ' is-on' : '';
      return `<button type="button" class="tag${on}" data-tag="${esc(tag)}">${esc(tag)}</button>`;
    }).join('');
  }

  function positionCard(pos) {
    const pnl = upnl(pos);
    const mark = state.last[pos.marketId];
    const tags = (pos.tags || []).map((tag) => `<span class="tag-static">${esc(tag)}</span>`).join('');
    return `<article class="item">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-semibold">${esc(pos.symbol)}</span>
            <span class="pill ${pos.side}">${pos.side === 'long' ? 'Long' : 'Short'}</span>
          </div>
          <p class="mt-1 font-mono text-xs muted">${formatQty(pos.qty)} @ ${formatPrice(pos.entry)}</p>
        </div>
        <div class="text-right">
          <p class="font-mono text-sm" data-pnl="${esc(pos.id)}" style="color:${pnl >= 0 ? '#14f195' : '#ff5d73'}">${signedMoney(pnl)}</p>
          <p class="font-mono text-[11px] muted">Mark <span data-mark="${esc(pos.id)}">${Number.isFinite(mark) ? formatPrice(mark) : '—'}</span></p>
        </div>
      </div>
      <p class="mt-2 font-mono text-[11px] muted">${pos.tp != null ? `TP ${formatPrice(pos.tp)}` : 'No TP'} · ${pos.sl != null ? `SL ${formatPrice(pos.sl)}` : 'No SL'} · <span data-trail="${esc(pos.id)}">${pos.trail ? `Trail ${formatPrice(pos.trail.stop)}` : 'No trail'}</span></p>
      <div class="mt-2 flex items-center justify-between gap-2">
        <div class="flex flex-wrap gap-1">${tags || '<span class="text-[11px] muted">Untagged</span>'}</div>
        <button type="button" class="mini" data-close="${esc(pos.id)}">Close</button>
      </div>
    </article>`;
  }

  function renderPositions() {
    $('posCount').textContent = String(state.positions.length);
    $('panel-positions').innerHTML = state.positions.length
      ? `<div class="grid gap-2">${state.positions.map(positionCard).join('')}</div>`
      : '<p class="item text-sm muted">No open paper positions. A fill from the ticket lands here with its bracket still working.</p>';
  }

  function renderOrders() {
    $('ordCount').textContent = String(state.orders.length);
    if (!state.orders.length) {
      $('panel-orders').innerHTML = '<p class="item text-sm muted">No working limits. A limit reserves margin until it fills or you cancel it.</p>';
      return;
    }
    $('panel-orders').innerHTML = `<div class="grid gap-2">${state.orders.map((order) => `
      <article class="item">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-semibold">${esc(order.symbol)}</span>
              <span class="pill ${order.side}">${order.side === 'long' ? 'Long' : 'Short'}</span>
              <span class="pill reason">Limit</span>
            </div>
            <p class="mt-1 font-mono text-xs muted">${formatMoney(order.margin)} @ ${formatPrice(order.limit)}</p>
          </div>
          <button type="button" class="mini" data-cancel="${esc(order.id)}">Cancel</button>
        </div>
        <p class="mt-2 font-mono text-[11px] muted">${order.tp != null ? `TP ${formatPrice(order.tp)}` : 'No TP'} · ${order.sl != null ? `SL ${formatPrice(order.sl)}` : 'No SL'} · ${order.trailDistance ? `Trail ${(order.trailDistance * 100).toFixed(2)}%` : 'No trail'}</p>
        <div class="mt-2 flex flex-wrap gap-1">${(order.tags || []).map((tag) => `<span class="tag-static">${esc(tag)}</span>`).join('') || '<span class="text-[11px] muted">Untagged</span>'}</div>
      </article>`).join('')}</div>`;
  }

  function visibleTrades() {
    return state.trades.filter((trade) => {
      if (state.journalDay && dayKeyFromDate(new Date(trade.closedAt)) !== state.journalDay) return false;
      if (state.journalTag !== 'all' && !(trade.tags || []).includes(state.journalTag)) return false;
      return true;
    });
  }

  function renderJournal() {
    const tags = ['all', ...new Set(state.trades.flatMap((trade) => trade.tags || []))];
    const filters = tags.map((tag) => {
      const on = state.journalTag === tag ? ' is-on' : '';
      const label = tag === 'all' ? 'All tags' : tag;
      return `<button type="button" class="mini${on}" data-filter-tag="${esc(tag)}">${esc(label)}</button>`;
    }).join('');
    const day = state.journalDay
      ? `<button type="button" class="mini is-on" data-clear-day="1">${esc(state.journalDay)} ×</button>`
      : '';
    const rows = visibleTrades();
    const list = rows.length ? rows.map((trade) => `
      <article class="item">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold">${esc(trade.symbol)}</span>
              <span class="pill ${trade.side}">${trade.side}</span>
              <span class="pill reason">${esc(REASONS[trade.reason] || trade.reason || 'Close')}</span>
            </div>
            <p class="mt-1 font-mono text-xs muted">${formatPrice(trade.entry)} → ${formatPrice(trade.exit)} · ${formatTime(trade.closedAt)}</p>
          </div>
          <p class="font-mono text-sm" style="color:${trade.pnl >= 0 ? '#14f195' : '#ff5d73'}">${signedMoney(trade.pnl)}</p>
        </div>
        <div class="mt-2 flex flex-wrap gap-1">${(trade.tags || []).map((tag) => `<button type="button" class="tag" data-filter-tag="${esc(tag)}">${esc(tag)}</button>`).join('') || '<span class="text-[11px] muted">Untagged</span>'}</div>
      </article>`).join('') : '<p class="item text-sm muted">No closed trades for this filter. Tags ride along from the ticket into the journal.</p>';
    $('panel-journal').innerHTML = `<div class="mb-3 flex flex-wrap gap-1.5">${filters}${day}</div><div class="grid gap-2">${list}</div>`;
  }

  function heatColor(pnl, max) {
    if (!pnl || !max) return 'rgba(255,255,255,0.04)';
    const t = Math.min(1, Math.abs(pnl) / max);
    const alpha = 0.18 + t * 0.75;
    return pnl > 0 ? `rgba(20,241,149,${alpha})` : `rgba(255,93,115,${alpha})`;
  }

  function summarize(trades) {
    let wins = 0;
    let losses = 0;
    let net = 0;
    let grossWin = 0;
    let grossLoss = 0;
    trades.forEach((trade) => {
      net += trade.pnl;
      if (trade.pnl > 0) { wins += 1; grossWin += trade.pnl; }
      else if (trade.pnl < 0) { losses += 1; grossLoss += trade.pnl; }
    });
    const n = trades.length;
    const pf = grossLoss < 0 ? grossWin / Math.abs(grossLoss) : (grossWin > 0 ? Infinity : 0);
    return {
      n,
      net,
      winRate: n ? (wins / n) * 100 : 0,
      pf,
      avgWin: wins ? grossWin / wins : 0,
      avgLoss: losses ? grossLoss / losses : null,
    };
  }

  function renderAnalytics() {
    const stats = summarize(state.trades);
    const pf = stats.pf === Infinity ? '∞' : stats.n ? stats.pf.toFixed(2) : '—';
    const { y, m } = state.calendar;
    const today = new Date();
    const canNext = y < today.getFullYear() || (y === today.getFullYear() && m < today.getMonth());
    const first = new Date(y, m, 1);
    const days = new Date(y, m + 1, 0).getDate();
    const totals = {};
    state.trades.forEach((trade) => {
      const date = new Date(trade.closedAt);
      if (date.getFullYear() !== y || date.getMonth() !== m) return;
      const key = date.getDate();
      if (!totals[key]) totals[key] = { pnl: 0, n: 0 };
      totals[key].pnl += trade.pnl;
      totals[key].n += 1;
    });
    let max = 0;
    Object.values(totals).forEach((bucket) => { max = Math.max(max, Math.abs(bucket.pnl)); });
    const pads = Array.from({ length: first.getDay() }, () => '<div class="heat-pad"></div>').join('');
    const cells = Array.from({ length: days }, (_, index) => {
      const day = index + 1;
      const bucket = totals[day];
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === day;
      const selected = state.journalDay === key;
      const title = bucket
        ? `${MONTHS[m]} ${day}: ${signedMoney(bucket.pnl)} · ${bucket.n} trade${bucket.n === 1 ? '' : 's'}`
        : `${MONTHS[m]} ${day}: no closes`;
      if (!bucket) {
        return `<div class="heat-cell flex items-center justify-center muted${isToday ? ' is-today' : ''}" style="background:rgba(255,255,255,0.03)" title="${esc(title)}">${day}</div>`;
      }
      return `<button type="button" class="heat-cell${isToday ? ' is-today' : ''}${selected ? ' is-on' : ''}" style="background:${heatColor(bucket.pnl, max)}" data-heat="${key}" title="${esc(title)}">${day}</button>`;
    }).join('');
    const tagMap = new Map();
    state.trades.forEach((trade) => {
      const tags = trade.tags && trade.tags.length ? trade.tags : ['#untagged'];
      tags.forEach((tag) => {
        const row = tagMap.get(tag) || { n: 0, wins: 0, pnl: 0 };
        row.n += 1;
        row.pnl += trade.pnl;
        if (trade.pnl > 0) row.wins += 1;
        tagMap.set(tag, row);
      });
    });
    const tagRows = [...tagMap.entries()].sort((a, b) => b[1].n - a[1].n);
    const tagHtml = tagRows.length ? tagRows.map(([tag, row]) => {
      const rate = (row.wins / row.n) * 100;
      return `<button type="button" class="item flex w-full items-center justify-between gap-3 text-left" data-jump-tag="${esc(tag === '#untagged' ? 'all' : tag)}">
        <span>
          <span class="font-semibold">${esc(tag)}</span>
          <span class="mt-1 block text-[11px] muted">${row.n} trade${row.n === 1 ? '' : 's'} · ${rate.toFixed(0)}% wins</span>
        </span>
        <span class="font-mono text-sm" style="color:${row.pnl >= 0 ? '#14f195' : '#ff5d73'}">${signedMoney(row.pnl)}</span>
      </button>`;
    }).join('') : '<p class="item text-sm muted">Tag a ticket with #FOMO, #Breakout, or #Reversal. Win rate by tag shows up after the first close.</p>';
    const equity = equityNow();
    const open = unrealized();
    const bars = ['#14f195', '#ab9ff2', '#7c8cff', '#f7d154', '#ff8fa3', '#5eead4'];
    const ranked = state.positions.slice().sort((a, b) => (b.margin + upnl(b)) - (a.margin + upnl(a)));
    const holdings = ranked.length ? ranked.map((pos, index) => {
      const pnl = upnl(pos);
      const value = pos.margin + pnl;
      const share = equity > 0 ? (value / equity) * 100 : 0;
      const color = bars[index % bars.length];
      return `<button type="button" class="item w-full text-left" data-port="${esc(pos.id)}" data-port-market="${esc(pos.marketId)}">
        <span class="flex items-start justify-between gap-3">
          <span>
            <span class="flex items-center gap-2">
              <span class="font-semibold">${esc(pos.symbol)}</span>
              <span class="pill ${pos.side}">${pos.side === 'long' ? 'Long' : 'Short'}</span>
            </span>
            <span class="mt-1 block font-mono text-[11px] muted">${formatQty(pos.qty)} @ ${formatPrice(pos.entry)}</span>
          </span>
          <span class="text-right">
            <span class="block font-mono text-sm" data-port-value>${formatMoney(value)}</span>
            <span class="mt-1 block font-mono text-[11px]" data-port-pnl style="color:${pnl >= 0 ? '#14f195' : '#ff5d73'}">${signedMoney(pnl)}</span>
          </span>
        </span>
        <span class="mt-2 flex items-center gap-2">
          <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <span class="block h-full rounded-full" data-port-bar style="width:${Math.max(2, Math.min(100, share))}%;background:${color}"></span>
          </span>
          <span class="font-mono text-[11px] muted" data-port-share>${share.toFixed(1)}%</span>
        </span>
      </button>`;
    }).join('') : '<p class="item text-sm muted">No coins yet. A fill shows up here with its live value and share of the account.</p>';
    const cashShare = equity > 0 ? (state.balance / equity) * 100 : 100;
    $('panel-analytics').innerHTML = `
      <section class="wallet-card">
        <div class="wallet-inner px-4 py-4">
          <p class="text-[11px] uppercase tracking-[0.16em] muted">Portfolio</p>
          <p id="portEquity" class="mt-1 font-mono text-3xl font-semibold">${formatMoney(equity)}</p>
          <p id="portDelta" class="mt-1 font-mono text-sm" style="color:${(equity - state.startBalance) >= 0 ? '#14f195' : '#ff5d73'}">${signedMoney(equity - state.startBalance)} · ${formatChange(state.startBalance ? ((equity - state.startBalance) / state.startBalance) * 100 : 0)} since start</p>
          <dl class="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <dt class="text-[10px] uppercase tracking-wider muted">Cash</dt>
              <dd id="portCash" class="font-mono text-sm">${formatMoney(state.balance)}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wider muted">In coins</dt>
              <dd id="portInvested" class="font-mono text-sm">${formatMoney(state.positions.reduce((sum, pos) => sum + pos.margin, 0))}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wider muted">Open</dt>
              <dd id="portOpen" class="font-mono text-sm" style="color:${open >= 0 ? '#14f195' : '#ff5d73'}">${signedMoney(open)}</dd>
            </div>
          </dl>
        </div>
      </section>
      <div class="mt-4">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">Holdings</h3>
          <span class="font-mono text-[11px] muted">${ranked.length} coin${ranked.length === 1 ? '' : 's'}</span>
        </div>
        <div class="grid gap-2">${holdings}</div>
        <div class="item mt-2">
          <div class="flex items-center justify-between gap-3">
            <span class="font-semibold">Cash</span>
            <span class="font-mono text-sm" id="portCashRow">${formatMoney(state.balance)}</span>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <span class="block h-full rounded-full bg-white/50" data-port-cashbar style="width:${Math.max(0, Math.min(100, cashShare))}%"></span>
            </span>
            <span class="font-mono text-[11px] muted" data-port-cashshare>${cashShare.toFixed(1)}%</span>
          </div>
        </div>
      </div>
      <h3 class="mb-2 mt-5 text-sm font-semibold">Closed trades</h3>
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <div class="stat"><p class="text-[10px] uppercase tracking-wider muted">Trades</p><p class="mt-1 font-mono text-lg">${stats.n}</p></div>
        <div class="stat"><p class="text-[10px] uppercase tracking-wider muted">Win rate</p><p class="mt-1 font-mono text-lg">${stats.n ? `${stats.winRate.toFixed(0)}%` : '—'}</p></div>
        <div class="stat"><p class="text-[10px] uppercase tracking-wider muted">Net PnL</p><p class="mt-1 font-mono text-lg" style="color:${stats.net >= 0 ? '#14f195' : '#ff5d73'}">${signedMoney(stats.net)}</p></div>
        <div class="stat"><p class="text-[10px] uppercase tracking-wider muted">Profit factor</p><p class="mt-1 font-mono text-lg">${pf}</p></div>
        <div class="stat"><p class="text-[10px] uppercase tracking-wider muted">Avg win</p><p class="mt-1 font-mono text-lg">${stats.n ? formatMoney(stats.avgWin) : '—'}</p></div>
        <div class="stat"><p class="text-[10px] uppercase tracking-wider muted">Avg loss</p><p class="mt-1 font-mono text-lg">${stats.avgLoss == null ? '—' : formatMoney(stats.avgLoss)}</p></div>
      </div>
      <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
        <div>
          <div class="mb-2 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">${MONTHS[m]} ${y}</h3>
            <div class="flex gap-1.5">
              <button type="button" class="mini" data-month="-1" aria-label="Previous month">←</button>
              <button type="button" class="mini" data-month="1" aria-label="Next month" ${canNext ? '' : 'disabled'}>→</button>
            </div>
          </div>
          <div class="grid grid-cols-7 gap-1 text-center text-[10px] muted"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
          <div class="mt-1 grid grid-cols-7 gap-1">${pads}${cells}</div>
          <p class="mt-2 text-[11px] muted">Each day is the sum of closed paper PnL. Click a day to open it in the journal.</p>
        </div>
        <div>
          <h3 class="mb-2 text-sm font-semibold">Tag performance</h3>
          <div class="grid gap-2">${tagHtml}</div>
          <p class="mt-2 text-[11px] muted">A close with several tags counts in each tag. Spot marks stream from Binance. Contract marks poll DexScreener.</p>
        </div>
      </div>`;
  }

  function paintPortfolio() {
    const root = $('panel-analytics');
    if (!root || !root.querySelector('#portEquity')) return;
    const equity = equityNow();
    const open = unrealized();
    const delta = equity - state.startBalance;
    const pct = state.startBalance ? (delta / state.startBalance) * 100 : 0;
    const put = (id, text, color) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      if (color) el.style.color = color;
    };
    put('portEquity', formatMoney(equity));
    put('portDelta', `${signedMoney(delta)} · ${formatChange(pct)} since start`, delta >= 0 ? '#14f195' : '#ff5d73');
    put('portCash', formatMoney(state.balance));
    put('portCashRow', formatMoney(state.balance));
    put('portInvested', formatMoney(state.positions.reduce((sum, pos) => sum + pos.margin, 0)));
    put('portOpen', signedMoney(open), open >= 0 ? '#14f195' : '#ff5d73');
    state.positions.forEach((pos) => {
      const row = root.querySelector(`[data-port="${cssEscape(pos.id)}"]`);
      if (!row) return;
      const pnl = upnl(pos);
      const value = pos.margin + pnl;
      const share = equity > 0 ? (value / equity) * 100 : 0;
      const pnlEl = row.querySelector('[data-port-pnl]');
      const valueEl = row.querySelector('[data-port-value]');
      const bar = row.querySelector('[data-port-bar]');
      const shareEl = row.querySelector('[data-port-share]');
      if (pnlEl) {
        pnlEl.textContent = signedMoney(pnl);
        pnlEl.style.color = pnl >= 0 ? '#14f195' : '#ff5d73';
      }
      if (valueEl) valueEl.textContent = formatMoney(value);
      if (shareEl) shareEl.textContent = `${share.toFixed(1)}%`;
      if (bar) bar.style.width = `${Math.max(2, Math.min(100, share))}%`;
    });
    const cashShare = equity > 0 ? (state.balance / equity) * 100 : 100;
    const cashBar = root.querySelector('[data-port-cashbar]');
    const cashShareEl = root.querySelector('[data-port-cashshare]');
    if (cashBar) cashBar.style.width = `${Math.max(0, Math.min(100, cashShare))}%`;
    if (cashShareEl) cashShareEl.textContent = `${cashShare.toFixed(1)}%`;
  }

  function renderAll() {
    renderWatchlist();
    renderMeta();
    renderIntervals();
    renderDrawTools();
    renderDrawingChips();
    renderTicket();
    renderTags();
    renderPositions();
    renderOrders();
    renderJournal();
    renderAnalytics();
    renderLive();
    paintConnection();
    paintNav();
  }

  function setTab(tab) {
    state.tab = tab;
    ['positions', 'orders', 'journal', 'analytics'].forEach((name) => {
      $('panel-' + name).classList.toggle('is-hidden', name !== tab);
      const btn = document.querySelector(`[data-tab="${name}"]`);
      if (btn) btn.classList.toggle('is-on', name === tab);
    });
  }

  function syncPhoneLayout() {
    const phone = window.matchMedia('(max-width: 1023px)').matches;
    document.body.classList.toggle('is-phone', phone);
    document.body.classList.remove('phone-chart', 'phone-trade', 'phone-book');
    if (!phone) return;
    if (state.mobileView === 'trade') document.body.classList.add('phone-trade');
    else if (state.mobileView === 'book' || state.mobileView === 'stats') document.body.classList.add('phone-book');
    else document.body.classList.add('phone-chart');
  }

  function setMobileView(view) {
    state.mobileView = view;
    const phone = window.matchMedia('(max-width: 1023px)').matches;
    $('view-chart').classList.toggle('m-hide', phone && view !== 'chart' && view !== 'trade');
    $('view-trade').classList.toggle('m-hide', phone && view !== 'trade');
    $('view-book').classList.toggle('m-hide', phone && view !== 'book' && view !== 'stats');
    if (view === 'stats') setTab('analytics');
    if (view === 'book' && state.tab === 'analytics') setTab('positions');
    syncPhoneLayout();
    paintNav();
    if (phone) window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      resizeChart();
      requestAnimationFrame(resizeChart);
    });
  }

  function paintNav() {
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.nav === state.mobileView);
    });
  }

  function looksLikeAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(value) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  }

  function sameAddr(a, b) {
    if (!a || !b) return false;
    if (/^0x/i.test(a) || /^0x/i.test(b)) return a.toLowerCase() === b.toLowerCase();
    return a === b;
  }

  async function findPairs(address) {
    const tokenRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`);
    if (tokenRes.ok) {
      const data = await tokenRes.json();
      if (Array.isArray(data.pairs) && data.pairs.length) {
        const asBase = data.pairs.filter((pair) => sameAddr(pair.baseToken && pair.baseToken.address, address));
        return asBase.length ? asBase : data.pairs;
      }
    }
    const searchRes = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(address)}`);
    if (!searchRes.ok) throw new Error('DexScreener is unavailable.');
    const data = await searchRes.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const matched = pairs.filter((pair) => sameAddr(pair.baseToken && pair.baseToken.address, address) || sameAddr(pair.pairAddress, address));
    return matched;
  }

  function liq(pair) {
    return (pair.liquidity && pair.liquidity.usd) || 0;
  }

  function marketFromPair(pair) {
    const base = pair.baseToken || {};
    const quote = pair.quoteToken || {};
    return {
      id: `${pair.chainId}:${base.address}`,
      kind: 'dex',
      chain: pair.chainId,
      address: base.address,
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
      base: base.symbol || 'TOKEN',
      quote: quote.symbol || 'USD',
      name: base.name || base.symbol || 'Token',
      gecko: GECKO_NET[pair.chainId] || null,
      priceUsd: Number(pair.priceUsd),
      liquidity: liq(pair),
      change24: pair.priceChange && pair.priceChange.h24 != null ? Number(pair.priceChange.h24) : null,
    };
  }

  function renderPairSelect(pairs) {
    const wrap = $('pairWrap');
    const select = $('pairSelect');
    state.pairChoices = pairs || [];
    if (!pairs || pairs.length < 2) {
      wrap.classList.add('is-hidden');
      select.innerHTML = '';
      return;
    }
    wrap.classList.remove('is-hidden');
    select.innerHTML = pairs.map((pair, index) => {
      const quote = pair.quoteToken ? pair.quoteToken.symbol : 'USD';
      const label = `${pair.dexId} · ${quote} · liq ${formatCompact(liq(pair))}`;
      return `<option value="${index}">${esc(label)}</option>`;
    }).join('');
  }

  function rememberDex(market) {
    state.dexMarkets = state.dexMarkets.filter((item) => item.id !== market.id);
    state.dexMarkets.unshift(market);
    while (state.dexMarkets.length > 12) {
      const last = state.dexMarkets[state.dexMarkets.length - 1];
      if (hasExposure(last.id)) break;
      state.dexMarkets.pop();
    }
  }

  async function adoptPair(pair) {
    const market = marketFromPair(pair);
    if (Number.isFinite(market.priceUsd)) {
      state.last[market.id] = market.priceUsd;
      state.stats[market.id] = { price: market.priceUsd, changePct: market.change24, liquidity: market.liquidity };
    }
    rememberDex(market);
    for (const pos of state.positions) if (pos.marketId === market.id) pos.market = snapshotMarket(market);
    for (const order of state.orders) if (order.marketId === market.id) order.market = snapshotMarket(market);
    await setActive(market, { force: true });
  }

  function extractAddress(raw) {
    const text = String(raw || '').trim();
    const evm = text.match(/0x[a-fA-F0-9]{40}/);
    if (evm) return evm[0];
    const sol = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (sol && sol.length) return sol.sort((a, b) => b.length - a.length)[0];
    return text;
  }

  function preparePaperTicket() {
    state.draftSide = 'long';
    state.draftType = 'market';
    clearPriceInputs();
    $('trailEnabled').checked = false;
    renderTicket();
    syncPriceLines();
    drawOverlay();
    if (window.innerWidth < 1024) setMobileView('trade');
    $('view-trade').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('sizeUsd').focus();
  }

  async function loadContract(raw) {
    const address = extractAddress(raw);
    if (!address) {
      toast('Paste a contract address.', 'error');
      return;
    }
    if (!looksLikeAddress(address)) {
      toast('That does not look like a Solana or Ethereum contract.', 'error');
      return;
    }
    const pairs = await findPairs(address);
    if (!pairs.length) {
      toast('No market for that contract yet.', 'error');
      return;
    }
    const sorted = pairs.slice().sort((a, b) => liq(b) - liq(a)).slice(0, 6);
    renderPairSelect(sorted);
    await adoptPair(sorted[0]);
    preparePaperTicket();
    const base = sorted[0].baseToken ? sorted[0].baseToken.symbol : 'Token';
    const price = state.last[state.active.id];
    toast(`${base} is ready. Buy it with paper cash${Number.isFinite(price) ? ` at ${formatPrice(price)}` : ''}.`);
  }

  function applyBracket(kind, pct) {
    const market = state.active;
    const live = market && state.last[market.id];
    const limit = optionalPrice($('limitPrice').value);
    const entry = state.draftType === 'limit' && limit.ok && limit.value ? limit.value : live;
    if (!Number.isFinite(entry)) {
      toast('Waiting for a live price.', 'error');
      return;
    }
    const long = state.draftSide === 'long';
    const price = kind === 'tp'
      ? (long ? entry * (1 + pct) : entry * (1 - pct))
      : (long ? entry * (1 - pct) : entry * (1 + pct));
    $(kind === 'tp' ? 'tpPrice' : 'slPrice').value = formatPriceInput(price);
    syncPriceLines();
    drawOverlay();
  }

  function onDrawPointerDown(event) {
    if (!state.drawMode) return;
    event.preventDefault();
    const point = eventToPoint(event);
    if (!point) return;
    if (!draftPoint) {
      draftPoint = point;
      previewPoint = point;
      renderDrawTools();
      drawOverlay();
      return;
    }
    if (state.drawMode === 'fib' && draftPoint.price === point.price) {
      toast('Fibonacci needs two different prices.', 'error');
      return;
    }
    drawings().push({ id: uid(), type: state.drawMode, a: draftPoint, b: point });
    draftPoint = null;
    previewPoint = null;
    persist();
    renderDrawingChips();
    renderDrawTools();
    drawOverlay();
  }

  function bind() {
    $('resetBtn').addEventListener('click', async () => {
      const ok = await askReset();
      if (!ok) return;
      state.balance = START;
      state.startBalance = START;
      state.positions = [];
      state.orders = [];
      state.trades = [];
      state.journalTag = 'all';
      state.journalDay = null;
      clearAllLines();
      persist();
      syncFeeds();
      renderAll();
      syncPriceLines();
      drawOverlay();
      toast('Paper account reset to $10,000.');
    });
    $('modalCancel').addEventListener('click', () => closeModal(false));
    $('modalOk').addEventListener('click', () => closeModal(true));
    $('modal').addEventListener('click', (event) => {
      if (event.target === $('modal')) closeModal(false);
    });
    $('caForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const btn = $('caSubmit');
      btn.disabled = true;
      try {
        await loadContract($('caInput').value);
      } catch (err) {
        console.error(err);
        toast(err.message || 'Could not load that contract.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
    $('pairSelect').addEventListener('change', async () => {
      const pair = state.pairChoices[Number($('pairSelect').value)];
      if (!pair) return;
      try { await adoptPair(pair); } catch (err) {
        console.error(err);
        toast(err.message || 'Could not switch pools.', 'error');
      }
    });
    $('watchlist').addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-market]');
      if (remove) {
        const id = remove.dataset.removeMarket;
        if (hasExposure(id)) {
          toast('Close that market’s position or order first.', 'error');
          return;
        }
        state.dexMarkets = state.dexMarkets.filter((market) => market.id !== id);
        delete state.drawings[id];
        persist();
        if (state.active && state.active.id === id) setActive(MAJORS[0]);
        else {
          renderWatchlist();
          syncFeeds();
        }
        return;
      }
      const chip = event.target.closest('[data-market]');
      if (!chip) return;
      const market = findMarket(chip.dataset.market);
      if (market) setActive(market);
    });
    $('intervalRow').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-interval]');
      if (btn) setInterval(btn.dataset.interval);
    });
    $('drawTools').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-draw]');
      if (!btn) return;
      const mode = btn.dataset.draw;
      if (mode === 'cursor') setDrawMode(null);
      else if (mode === 'undo') {
        const list = drawings();
        list.pop();
        draftPoint = null;
        previewPoint = null;
        persist();
        renderDrawingChips();
        drawOverlay();
      } else if (mode === 'clear') {
        if (state.active) state.drawings[state.active.id] = [];
        draftPoint = null;
        previewPoint = null;
        persist();
        renderDrawingChips();
        drawOverlay();
      } else setDrawMode(mode);
    });
    $('drawingChips').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-drop-drawing]');
      if (!btn || !state.active) return;
      state.drawings[state.active.id] = drawings().filter((drawing) => drawing.id !== btn.dataset.dropDrawing);
      persist();
      renderDrawingChips();
      drawOverlay();
    });
    const overlay = $('overlay');
    overlay.addEventListener('pointerdown', onDrawPointerDown);
    overlay.addEventListener('pointermove', (event) => {
      if (!state.drawMode || !draftPoint) return;
      previewPoint = eventToPoint(event);
      drawOverlay();
    });
    $('sideToggle').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-side]');
      if (!btn) return;
      state.draftSide = btn.dataset.side;
      renderTicket();
      syncPriceLines();
      drawOverlay();
    });
    $('typeToggle').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-type]');
      if (!btn) return;
      state.draftType = btn.dataset.type;
      renderTicket();
      syncPriceLines();
      drawOverlay();
    });
    $('sizeMax').addEventListener('click', () => {
      $('sizeUsd').value = state.balance.toFixed(2);
    });
    $('sizePresets').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-size]');
      if (btn) $('sizeUsd').value = btn.dataset.size;
    });
    $('bracketPresets').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-bracket]');
      if (!btn) return;
      applyBracket(btn.dataset.bracket, Number(btn.dataset.pct));
    });
    ['limitPrice', 'tpPrice', 'slPrice', 'trailPct'].forEach((id) => {
      $(id).addEventListener('input', () => {
        syncPriceLines();
        drawOverlay();
      });
    });
    $('trailEnabled').addEventListener('change', () => {
      $('trailWrap').classList.toggle('is-hidden', !$('trailEnabled').checked);
      syncPriceLines();
      drawOverlay();
    });
    $('tagRow').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-tag]');
      if (!btn) return;
      const tag = btn.dataset.tag;
      if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
      else if (state.selectedTags.size >= 4) toast('Four tags per order is the limit.', 'error');
      else state.selectedTags.add(tag);
      renderTags();
    });
    $('tagForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const tag = canonicalTag($('tagInput').value);
      if (!tag) {
        toast('Use a tag like #Breakout.', 'error');
        return;
      }
      if (!state.customTags.includes(tag) && !PRESETS.includes(tag)) state.customTags.push(tag);
      if (state.selectedTags.size < 4) state.selectedTags.add(tag);
      $('tagInput').value = '';
      persist();
      renderTags();
    });
    $('submitOrder').addEventListener('click', placeOrder);
    $('tabRow').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-tab]');
      if (btn) setTab(btn.dataset.tab);
    });
    $('panel-positions').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-close]');
      if (btn) manualClose(btn.dataset.close);
    });
    $('panel-orders').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-cancel]');
      if (btn) cancelOrder(btn.dataset.cancel);
    });
    $('panel-journal').addEventListener('click', (event) => {
      const clear = event.target.closest('[data-clear-day]');
      if (clear) {
        state.journalDay = null;
        renderJournal();
        renderAnalytics();
        return;
      }
      const tag = event.target.closest('[data-filter-tag]');
      if (!tag) return;
      state.journalTag = tag.dataset.filterTag;
      renderJournal();
    });
    $('panel-analytics').addEventListener('click', (event) => {
      const holding = event.target.closest('[data-port-market]');
      if (holding) {
        const market = findMarket(holding.dataset.portMarket);
        if (market) {
          setActive(market);
          if (window.innerWidth < 1024) setMobileView('trade');
        }
        return;
      }
      const month = event.target.closest('[data-month]');
      if (month && !month.disabled) {
        const delta = Number(month.dataset.month);
        const next = new Date(state.calendar.y, state.calendar.m + delta, 1);
        const today = new Date();
        const future = next.getFullYear() > today.getFullYear()
          || (next.getFullYear() === today.getFullYear() && next.getMonth() > today.getMonth());
        if (!future) {
          state.calendar = { y: next.getFullYear(), m: next.getMonth() };
          renderAnalytics();
        }
        return;
      }
      const day = event.target.closest('[data-heat]');
      if (day) {
        state.journalDay = day.dataset.heat;
        setTab('journal');
        renderJournal();
        renderAnalytics();
        if (window.innerWidth < 1024) setMobileView('book');
        return;
      }
      const jump = event.target.closest('[data-jump-tag]');
      if (jump) {
        state.journalTag = jump.dataset.jumpTag;
        setTab('journal');
        renderJournal();
        if (window.innerWidth < 1024) setMobileView('book');
      }
    });
    $('mobileNav').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-nav]');
      if (btn) setMobileView(btn.dataset.nav);
    });
    document.addEventListener('focusin', (event) => {
      if (!window.matchMedia('(max-width: 1023px)').matches) return;
      if (!event.target.matches('input, select, textarea')) return;
      document.body.classList.add('keyboard');
      const field = event.target;
      setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280);
    });
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || !active.matches('input, select, textarea')) document.body.classList.remove('keyboard');
      }, 80);
    });
    window.matchMedia('(max-width: 1023px)').addEventListener('change', () => {
      syncPhoneLayout();
      paintConnection();
      requestAnimationFrame(resizeChart);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!$('modal').classList.contains('is-hidden')) {
        closeModal(false);
        return;
      }
      if (state.drawMode || draftPoint) setDrawMode(null);
    });
    window.addEventListener('error', () => {
      if (state._errorToasted) return;
      state._errorToasted = true;
      toast('Something broke in the desk. The saved account is still in this browser.', 'error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error(event.reason);
      const message = event.reason && event.reason.message ? event.reason.message : 'Unexpected error';
      toast(message, 'error');
    });
  }

  async function primeTickers() {
    try {
      const symbols = encodeURIComponent(JSON.stringify(MAJORS.map((market) => market.symbol)));
      const data = await binanceGet(`/api/v3/ticker/24hr?symbols=${symbols}`);
      if (!Array.isArray(data)) return;
      data.forEach((tick) => {
        const price = Number(tick.lastPrice);
        state.stats[tick.symbol] = { price, changePct: Number(tick.priceChangePercent) };
        if (!Number.isFinite(state.last[tick.symbol])) state.last[tick.symbol] = price;
      });
      queuePaint();
    } catch (err) {
      console.error(err);
    }
  }

  function setupInstall() {
    const hint = $('installHint');
    if (!hint) return;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const dismissed = localStorage.getItem('vela.pwa.dismiss') === '1';
    const hide = () => hint.classList.add('is-hidden');
    $('installDismiss').addEventListener('click', () => {
      localStorage.setItem('vela.pwa.dismiss', '1');
      hide();
    });
    $('installGo').addEventListener('click', async () => {
      const prompt = hint._prompt;
      if (!prompt) return;
      prompt.prompt();
      try { await prompt.userChoice; } catch (err) { console.error(err); }
      hide();
    });
    if (standalone || dismissed) return;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) {
      $('installText').textContent = 'Install VELA from Safari: tap Share, then Add to Home Screen.';
      hint.classList.remove('is-hidden');
    }
    window.addEventListener('beforeinstallprompt', (event) => {
      if (localStorage.getItem('vela.pwa.dismiss') === '1') return;
      event.preventDefault();
      hint._prompt = event;
      $('installText').textContent = 'Install VELA on this device. It opens like an app and keeps this paper account.';
      $('installGo').classList.remove('is-hidden');
      hint.classList.remove('is-hidden');
    });
  }

  function setupWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error(err));
  }

  async function boot() {
    loadState();
    bind();
    setupInstall();
    setupWorker();
    try {
      initChart();
    } catch (err) {
      console.error(err);
      showFatal('The chart could not start. Refresh and try again.');
    }
    renderAll();
    setTab('positions');
    setMobileView('chart');
    const market = findMarket(state.activeId) || MAJORS[0];
    primeTickers();
    try {
      await setActive(market, { force: true });
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not open the default market.', 'error');
    }
  }

  boot();
})();
