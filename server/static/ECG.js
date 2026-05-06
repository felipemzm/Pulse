(() => {
 
  const canvas    = document.getElementById('ecg');
  const editor    = document.getElementById('editor');
  const runBtn    = document.getElementById('run-btn');
  const pauseBtn  = document.getElementById('pause-btn');
  const sampleSel = document.getElementById('sample-select');
  const outputEl  = document.getElementById('output');
  const evtCount  = document.getElementById('vital-events');
  const hrInput   = document.getElementById('vital-hr');
  const statusEl  = document.getElementById('vital-status');
  const overlayEv = document.getElementById('overlay-event');
  const tooltipEl = document.getElementById('ecg-tooltip');
  const ctx       = canvas.getContext('2d');

  //speed 

  const PX_PER_SEC_AT_80_BPM = 220;
  function pxPerSecondFor(bpm) {
    return PX_PER_SEC_AT_80_BPM * (bpm / 80);
  }
  let pxPerSecond = pxPerSecondFor(parseInt(hrInput.value) || 80);

  hrInput.addEventListener('input', () => {
    let bpm = parseInt(hrInput.value);
    if (isNaN(bpm)) bpm = 80;
    bpm = Math.max(40, Math.min(220, bpm));
    pxPerSecond = pxPerSecondFor(bpm);
  });
  // drag
  let dragStartX = null, dragStartBpm = null;
  hrInput.parentElement.addEventListener('mousedown', e => {
    if (e.target === hrInput) return;   
    e.preventDefault();
    dragStartX = e.clientX;
    dragStartBpm = parseInt(hrInput.value) || 80;
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', e => {
    if (dragStartX === null) return;
    const delta = e.clientX - dragStartX;
    let bpm = Math.round(dragStartBpm + delta);
    bpm = Math.max(40, Math.min(220, bpm));
    hrInput.value = bpm;
    pxPerSecond = pxPerSecondFor(bpm);
  });
  window.addEventListener('mouseup', () => {
    dragStartX = null;
    document.body.style.userSelect = '';
  });

  // size
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r   = canvas.getBoundingClientRect();
    canvas.width  = r.width  * dpr;
    canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  //colors
  const COLORS = {
    green:  '#44ff9a',
    amber:  '#ffb84d',
    red:    '#ff5566',
    cyan:   '#66ddff',
    violet: '#c79dff',
    yellow: '#f5e572',
    dim:    '#3a504c',
  };

  //waves
  const SHAPES = {
    // tiny initial vump
    bump: t => Math.sin(t * Math.PI) * 0.15,

    qrs: t => {

      if (t < 0.18) return -0.18 * Math.sin((t / 0.18) * Math.PI);
      if (t < 0.42) return  Math.sin(((t - 0.18) / 0.24) * Math.PI) * 1.0;
      if (t < 0.55) return -0.35 * Math.sin(((t - 0.42) / 0.13) * Math.PI);
    
      if (t < 0.85) return  0.22 * Math.sin(((t - 0.55) / 0.30) * Math.PI);
      return 0;
    },

    // Two quick beats 
    doubleTick: t => {
      if (t < 0.45) return Math.sin((t / 0.45) * Math.PI) * 0.55;
      if (t < 0.55) return 0;
      return Math.sin(((t - 0.55) / 0.45) * Math.PI) * 0.55;
    },

    // Downward dip 
    dip: t => -Math.sin(t * Math.PI) * 0.45,

    // Quiet flat with a single tick 
    quietTick: t => {
      if (t < 0.4 || t > 0.55) return 0;
      return Math.sin(((t - 0.4) / 0.15) * Math.PI) * 0.3;
    },

    // Regular rhythm
    rhythm: t => {
      if (t < 0.5) return Math.sin((t / 0.5) * Math.PI) * 0.7;
      return -0.15 * Math.sin(((t - 0.5) / 0.5) * Math.PI);
    },

    // Upward fork
    forkUp: t => {
      if (t < 0.4) return 0;
      if (t < 0.7) return ((t - 0.4) / 0.3) * 0.6;
      return 0.6 - ((t - 0.7) / 0.3) * 0.6;
    },

    // Downward fork 
    forkDown: t => {
      if (t < 0.4) return 0;
      if (t < 0.7) return -((t - 0.4) / 0.3) * 0.5;
      return -0.5 + ((t - 0.7) / 0.3) * 0.5;
    },

    // Arrhythmia
    arrhythmia: t => {
      const phase = t * Math.PI * 6;
      const env   = Math.sin(t * Math.PI);
      return Math.sin(phase) * env * 0.8;
    },

    // Pure flat
    flat: t => 0,

    // Open / close
    enter: t => {
      if (t < 0.3) return ((t / 0.3) * 0.4);
      return 0.4 * Math.exp(-(t - 0.3) * 4);
    },
    exit: t => {
      if (t < 0.3) return 0;
      return -((t - 0.3) / 0.7) * 0.3;
    },
  };

  const EVENT_MAP = {
    admit:         { shape: SHAPES.bump,        color: COLORS.cyan,   dur: 0.35 },
    update:        { shape: SHAPES.bump,        color: COLORS.cyan,   dur: 0.30 },
    record:        { shape: SHAPES.qrs,         color: COLORS.green,  dur: 0.55 },
    protocol_def:  { shape: SHAPES.quietTick,   color: COLORS.dim,    dur: 0.40 },
    page:          { shape: SHAPES.doubleTick,  color: COLORS.violet, dur: 0.50 },
    discharge:     { shape: SHAPES.dip,         color: COLORS.violet, dur: 0.45 },
    monitor_enter: { shape: SHAPES.enter,       color: COLORS.yellow, dur: 0.30 },
    monitor_tick:  { shape: SHAPES.rhythm,      color: COLORS.yellow, dur: 0.45 },
    monitor_exit:  { shape: SHAPES.exit,        color: COLORS.yellow, dur: 0.30 },
    cycle_enter:   { shape: SHAPES.enter,       color: COLORS.yellow, dur: 0.30 },
    cycle_tick:    { shape: SHAPES.rhythm,      color: COLORS.yellow, dur: 0.45 },
    cycle_exit:    { shape: SHAPES.exit,        color: COLORS.yellow, dur: 0.30 },
    diagnose_true: { shape: SHAPES.forkUp,      color: COLORS.amber,  dur: 0.40 },
    diagnose_false:{ shape: SHAPES.forkDown,    color: COLORS.amber,  dur: 0.40 },
    code_enter:    { shape: SHAPES.rhythm,      color: COLORS.green,  dur: 0.40 },
    respond:       { shape: SHAPES.arrhythmia,  color: COLORS.red,    dur: 0.80 },
    flatline:      { shape: SHAPES.flat,        color: COLORS.red,    dur: 999  },
  };

  //trace 
  let trace = [];          
  let eventQueue = [];
  let activeEvent = null;
  let activeStart = 0;
  let lastFrame = 0;
  let running = false;
  let paused = false;
  let flatlineMode = false;
  let scrollOffset = 0;    

  function setStatus(state, label) {
    statusEl.classList.remove('run', 'err', 'done');
    if (state) statusEl.classList.add(state);
    statusEl.querySelector('.vital-value').textContent = label;
  }

  function clearTrace() {
    trace = [];
    eventQueue = [];
    activeEvent = null;
    flatlineMode = false;
    paused = false;
    scrollOffset = 0;
    setPauseUI(false);
    overlayEv.textContent = 'awaiting trace';
    evtCount.textContent = '000';
  }

  function loadEvents(events) {
    clearTrace();
    eventQueue = events.slice();
    running = true;
    paused = false;
    setStatus('run', 'TRACING');
    pauseBtn.disabled = false;
    setPauseUI(false);
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  // Frames
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);   
    lastFrame = now;

    if (running || flatlineMode) {
      if (!paused) advance(dt);
      draw();
      requestAnimationFrame(frame);
    }
  }

  // Pause / Resume
  function setPauseUI(isPaused) {
    pauseBtn.classList.toggle('is-paused', isPaused);
    document.body.classList.toggle('is-paused-canvas', isPaused);
    pauseBtn.textContent = isPaused ? '▶ RESUME' : '❚❚ FREEZE';
    if (isPaused) {
      statusEl.classList.add('paused');
      statusEl.querySelector('.vital-value').textContent = 'PAUSED';
    } else {
      statusEl.classList.remove('paused');
      if (running) setStatus('run', 'TRACING');
      else if (flatlineMode) setStatus('done', 'FLATLINE');
      scrollOffset = 0;
      tooltipEl.hidden = true;
    }
  }

  function togglePause() {
    if (!running && !flatlineMode) return;
    paused = !paused;
    setPauseUI(paused);
    if (!paused) lastFrame = performance.now();
  }
  pauseBtn.addEventListener('click', togglePause);

  // Panning
  let panStartX = null, panStartOffset = 0;
  canvas.addEventListener('mousedown', e => {
    if (!paused) return;
    panStartX = e.clientX;
    panStartOffset = scrollOffset;
    canvas.style.cursor = 'grabbing';
    tooltipEl.hidden = true;
  });
 window.addEventListener('mousemove', e => {
    if (panStartX === null) return;
    const dx = e.clientX - panStartX;
    scrollOffset = panStartOffset + dx;
    const w = canvas.clientWidth;
    const maxBack = Math.max(0, trace.length - w);
    scrollOffset = Math.max(0, Math.min(maxBack, scrollOffset));
    draw();
  });
  window.addEventListener('mouseup', () => {
    if (panStartX !== null) {
      panStartX = null;
      canvas.style.cursor = '';
    }
  });

  // Hover
  canvas.addEventListener('mousemove', e => {
    if (!paused || panStartX !== null || trace.length === 0) {
      tooltipEl.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const w    = canvas.clientWidth;
    const startX   = w - trace.length + scrollOffset;
    const traceIdx = Math.round(x - startX);
    if (traceIdx < 0 || traceIdx >= trace.length) {
      tooltipEl.hidden = true;
      return;
    }
    const sample = trace[traceIdx];
    if (!sample.kind) {
      tooltipEl.hidden = true;
      return;
    }
    tooltipEl.innerHTML =
      `<span class="tt-kind">${sample.kind}</span>` +
      (sample.detail ? `<span class="tt-detail">${escapeHtml(sample.detail)}</span>` : '');
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top  = (e.clientY - rect.top) + 'px';
    tooltipEl.hidden = false;
  });
  canvas.addEventListener('mouseleave', () => { tooltipEl.hidden = true; });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function advance(dt) {
    const w = canvas.clientWidth;
    const samplesNeeded = Math.ceil(dt * pxPerSecond);

    for (let i = 0; i < samplesNeeded; i++) {
    
      if (!activeEvent && eventQueue.length > 0) {
        const next = eventQueue.shift();
        activeEvent = EVENT_MAP[next.kind] || EVENT_MAP.admit;
        activeEvent._kind = next.kind;
        activeEvent._detail = next.detail;
        activeStart = 0;

        overlayEv.textContent = `${next.kind}${next.detail ? ' · ' + next.detail : ''}`;
        evtCount.textContent = String(parseInt(evtCount.textContent) + 1).padStart(3, '0');

        if (next.kind === 'flatline') {
          flatlineMode = true;
          running = false;
          setStatus('done', 'FLATLINE');
        }
      }

      // sample current event
      let y = 0;
      let color = COLORS.dim;
      if (activeEvent) {
        const dur = activeEvent.dur;
        const t   = Math.min(1, activeStart / dur);
        y     = activeEvent.shape(t);
        color = activeEvent.color;
        activeStart += 1 / pxPerSecond;
        if (activeStart >= dur && activeEvent._kind !== 'flatline') {
          activeEvent = null;
        }
      } else if (flatlineMode) {
        y = 0;
        color = COLORS.red;
      } else {
        y = 0;
        color = COLORS.dim;
      }

      trace.push({
        y,
        color,
        kind:   activeEvent ? activeEvent._kind   : (flatlineMode ? 'flatline' : null),
        detail: activeEvent ? activeEvent._detail : '',
      });
    }

    const maxLen = Math.ceil(w * 4);
    if (trace.length > maxLen) {
      trace = trace.slice(trace.length - maxLen);
    }
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const midY = h / 2;
    const amp = h * 0.32;

    ctx.clearRect(0, 0, w, h);
    drawGrid(w, h);

    if (trace.length < 2) return;

    const startX = w - trace.length + scrollOffset;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.strokeStyle = COLORS.green;
    for (let i = 1; i < trace.length; i++) {
      const x0 = startX + i - 1;
      const x1 = startX + i;
      const y0 = midY - trace[i - 1].y * amp;
      const y1 = midY - trace[i].y * amp;
      if (i === 1) ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;


    ctx.lineWidth = 1.5;
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1];
      const b = trace[i];
      const x0 = startX + i - 1;
      const x1 = startX + i;
      const y0 = midY - a.y * amp;
      const y1 = midY - b.y * amp;
      ctx.strokeStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }


    if (scrollOffset === 0) {
      const last = trace[trace.length - 1];
      ctx.fillStyle = last.color;
      ctx.shadowColor = last.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(w - 1, midY - last.y * amp, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawGrid(w, h) {
    const small = 20;
    const big = 100;

    ctx.strokeStyle = '#0e1a18';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += small) {
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += small) {
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    ctx.strokeStyle = '#15302b';
    ctx.beginPath();
    for (let x = 0; x <= w; x += big) {
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += big) {
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    // baseline
    ctx.strokeStyle = '#1a3a35';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  async function runProgram() {
    runBtn.disabled = true;
    setStatus('run', 'PARSING');
    outputEl.classList.remove('error');
    outputEl.textContent = '';
    overlayEv.textContent = 'parsing…';
    clearTrace();

    try {
      const r = await fetch('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: editor.value }),
      });
      const data = await r.json();
      if (!data.ok) {
        setStatus('err', 'ERROR');
        outputEl.classList.add('error');
        outputEl.textContent = data.error;
        overlayEv.textContent = 'ERR · ' + data.error;
        pauseBtn.disabled = true;
        runBtn.disabled = false;
        return;
      }
      outputEl.textContent = data.output.join('\n') || '';
      loadEvents(data.pulses);
    } catch (err) {
      setStatus('err', 'OFFLINE');
      outputEl.classList.add('error');
      outputEl.textContent = 'connection error: ' + err;
    } finally {
      setTimeout(() => { runBtn.disabled = false; }, 300);
    }
  }

  runBtn.addEventListener('click', runProgram);

  // space to pause 
  document.addEventListener('keydown', e => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (document.activeElement === editor) return;
    if (document.activeElement === hrInput) return;
    e.preventDefault();
    togglePause();
  });

  // Samples 
  sampleSel.addEventListener('change', async e => {
    const name = e.target.value;
    if (!name) return;
    const r = await fetch('/sample/' + name);
    const data = await r.json();
    if (data.ok) {
      editor.value = data.source;
      e.target.value = '';
      editor.focus();
    }
  });

  resize();
  setStatus(null, 'IDLE');
  (function idle() {
    if (!running && !flatlineMode) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      drawGrid(w, h);
    }
    requestAnimationFrame(idle);
  })();
})();