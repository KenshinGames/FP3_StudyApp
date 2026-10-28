/* FP3級 合格ドリル — 画面とロジック(ビルド不要。index.html を開くだけで動く) */
(function () {
  'use strict';

  var QS = window.QUESTIONS;
  var FIELDS = window.FIELDS;
  var STORE_KEY = 'fp3study.v1';
  var MOCK_PER_FIELD = 5;   // 模擬試験:各分野から出す問題数(合計 30 問)
  var HONBAN_PER_FIELD = 10;  // 本番形式の模擬試験:各分野から出す問題数(合計 60 問)
  var HONBAN_MINUTES = 90;    // 本番形式の制限時間(分)。学科本試験と同じ
  var PASS_RATE = 0.6;      // 学科試験の合格基準は 60%(36 / 60 問)
  var TODAY_COUNT = 10;     // 今日の10問
  var REVIEW_STEPS = [1, 3, 7, 14, 30];   // 復習の間隔(日):正解するごとに伸びる。まちがえたら翌日
  var DAY_MS = 86400000;

  var root = document.getElementById('app');
  var fieldById = {};
  FIELDS.forEach(function (f) { fieldById[f.id] = f; });
  QS.forEach(function (q, i) { q.id = i; });
  var PLAIN = QS.filter(function (q) { return !q.jitsu; });   // 学科の問題(実技の事例は別枠)
  var CASES = window.CASES || [];
  function caseQs(cid) { return QS.filter(function (q) { return q.jitsu && q.cid === cid; }); }

  /* ---------- 保存(ブラウザの localStorage。使えないときもエラーにしない) ---------- */
  // { q: {問題id: {r, w, last, step, due}}, run: 途中の問題, star: {問題id: 1}, mute, font, ai, pwaHint, examDate }
  var mem = null;
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { mem = {}; }
    if (!mem.q) mem.q = {};
    return mem;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(mem)); } catch (e) { /* 保存できなくても続ける */ }
  }
  function record(q, correct) {
    var s = load();
    var r = s.q[q.id] || { r: 0, w: 0, last: null };
    if (correct) {
      r.r++;
      r.step = Math.min((typeof r.step === 'number' ? r.step : -1) + 1, REVIEW_STEPS.length - 1);
    } else {
      r.w++;
      r.step = -1;
    }
    r.last = correct;
    r.due = Date.now() + (correct ? REVIEW_STEPS[r.step] : 1) * DAY_MS;   // 次に復習する日
    s.q[q.id] = r;
    save();
  }
  function recOf(q) { return load().q[q.id] || null; }
  function wrongList() { return QS.filter(function (q) { var r = recOf(q); return r && r.last === false; }); }
  // 復習の期限が来ているか(旧データで due がない問題は、期限が来たものとして扱う)
  function isDue(q) {
    var r = recOf(q);
    return !!r && (typeof r.due !== 'number' || r.due <= Date.now());
  }
  function dueOf(q) { var r = recOf(q); return r && typeof r.due === 'number' ? r.due : 0; }
  // 解説に出す「次回の復習は〜」
  function dueText(q) {
    var r = recOf(q);
    if (!r || typeof r.due !== 'number') return null;
    var days = Math.max(1, Math.round((r.due - Date.now()) / DAY_MS));
    return days <= 1 ? '明日' : days + '日後';
  }

  // ★(あとで見直す)
  function isStar(q) { return !!(load().star || {})[q.id]; }
  function toggleStar(q) {
    var s = load();
    s.star = s.star || {};
    if (s.star[q.id]) delete s.star[q.id]; else s.star[q.id] = 1;
    save();
    return !!s.star[q.id];
  }
  function starList() { return QS.filter(isStar); }

  // 文字の大きさ(問題文・選択肢・解説・事例・AI の答え)
  var FONT_SIZES = [{ id: 's', name: '小' }, { id: 'm', name: '中' }, { id: 'l', name: '大' }];
  function fontId() { var f = load().font; return f === 's' || f === 'l' ? f : 'm'; }
  function fontName() { return FONT_SIZES.filter(function (f) { return f.id === fontId(); })[0].name; }
  function applyFont() { document.documentElement.setAttribute('data-fs', fontId()); }
  function setFont(id) { load().font = id; save(); applyFont(); }
  // 試験日の入力。選んでいる最中(change)は保存だけにして、描き直しは選び終わったあと(blur)にする
  // ※ change のたびに描き直すと、iPhone の日付ピッカーが途中で閉じて今日の日付が入ってしまうため
  function examDateInput() {
    var box = h('span', null);
    var inp = h('input', { type: 'date', value: load().examDate || '',
      onchange: function () {
        if (inp.value) load().examDate = inp.value; else delete load().examDate;
        save();
      },
      onblur: function (e) {
        if (e && e.relatedTarget && box.contains(e.relatedTarget)) return;   // クリアボタンへ移るときは描き直さない(ボタンが消えて押せなくなる)
        home(window.scrollY);
      }
    });
    box.appendChild(inp);
    if (load().examDate) box.appendChild(h('button', { class: 'sbtn', onclick: function () { delete load().examDate; save(); home(window.scrollY); } }, ['クリア']));
    return box;
  }

  // 試験日のカード(「あなたの進み具合」の上に出す)。設定したら、ここにカウントダウンも出す
  function examCard(rightLast) {
    var kids = [h('div', { class: 'srow' }, [h('span', null, ['📅 試験日']), examDateInput()])];
    if (load().examDate) {
      var today0 = new Date(); today0.setHours(0, 0, 0, 0);
      var days = Math.round((new Date(load().examDate + 'T00:00:00') - today0) / DAY_MS);
      var examLabel = load().examDate.replace(/-/g, '/');
      if (days > 0) {
        var remain = QS.length - rightLast;
        kids.push(h('div', null, [h('b', null, ['あと ' + days + ' 日']), '（' + examLabel + '）']));
        kids.push(h('div', { class: 'hint' }, [remain > 0
          ? '正解済みでない問題が ' + remain + ' 問。1日 ' + Math.ceil(remain / days) + ' 問ペースで全部まわります'
          : '全問正解済み!あとは復習を回してキープしよう']));
      } else if (days === 0) {
        kids.push(h('div', null, [h('b', null, ['今日が試験日!']), ' がんばって！']));
      } else {
        kids.push(h('div', null, ['この日付は過ぎました。次の試験を受けるなら、日付を変えてね']));
      }
    } else {
      kids.push(h('div', { class: 'hint' }, ['受験日を入れると、ここにカウントダウンが出ます']));
    }
    return h('div', { class: 'card settings' }, kids);
  }
  function cycleFont() {
    var ids = FONT_SIZES.map(function (f) { return f.id; });
    setFont(ids[(ids.indexOf(fontId()) + 1) % ids.length]);
  }

  /* ---------- 小道具 ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pct(n, d) { return d ? Math.round(n * 100 / d) : 0; }
  function mount(node, y) { root.replaceChildren(node); window.scrollTo(0, y || 0); }
  function bar(p) { return h('div', { class: 'bar' }, [h('i', { style: 'width:' + p + '%' })]); }
  function answeredIn(picks) { return (picks || []).filter(function (p) { return p != null; }).length; }

  /* ---------- 効果音 ---------- */
  // iPhone はほかのアプリへ移ると音の出口(AudioContext)が止まり(state が 'interrupted' など)、戻っても鳴らないことがある。
  // 画面が隠れたら閉じて、次に鳴らすとき(答えをタップしたとき)に作り直す
  var actx = null;
  function audio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx || actx.state === 'closed') actx = new AC();
    if (actx.state !== 'running') actx.resume();
    return actx;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden' || !actx) return;
    var old = actx; actx = null;
    try { old.close(); } catch (e) { /* 閉じられなくても次は作り直す */ }
  });
  // freq2 を渡すと、freq から freq2 へ音程がすべる
  function tone(freq, start, dur, type, vol, freq2) {
    var o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + start;
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.setValueAtTime(vol, t0 + dur - 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // ふんわり揺れる音(ビブラート付き)。かわいい「しょぼん」用
  function wobble(freq, start, dur, vol, freq2) {
    var o = actx.createOscillator(), g = actx.createGain(), lfo = actx.createOscillator(), lg = actx.createGain();
    var t0 = actx.currentTime + start;
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
    lfo.frequency.value = 9; lg.gain.value = freq * 0.025;
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.setValueAtTime(vol, t0 + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); lfo.start(t0); o.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
  }
  function playSfx(ok) {
    if (load().mute) return;
    try {
      if (!audio()) return;
      if (ok) { // 正解:ミ→ソ→ドと上がる明るいチャイム
        tone(659.25, 0, 0.18, 'sine', 0.22);          // ミ(E5)
        tone(783.99, 0.11, 0.18, 'sine', 0.22);       // ソ(G5)
        tone(1046.5, 0.22, 0.55, 'sine', 0.24);       // ド(C6、少し長く響かせる)
      } else {  // 不正解:低めの2音で、やわらかく「残念」
        tone(233.08, 0, 0.18, 'triangle', 0.22);      // シ♭(Bb3)
        tone(196, 0.13, 0.38, 'triangle', 0.22);      // ソ(G3)
      }
    } catch (e) { /* 音が出なくても続ける */ }
  }
  /* ---------- 本番形式のタイマー ---------- */
  var timerId = null;
  function fmtTime(sec) { var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function startTimer() {
    stopTimer();
    if (!run || !run.endsAt) return;
    var el = document.getElementById('fx-timer');
    if (!el) return;
    function tick() {
      if (!run || !run.endsAt) { stopTimer(); return; }
      var left = Math.max(0, Math.round((run.endsAt - Date.now()) / 1000));
      el.textContent = '⏱ ' + fmtTime(left);
      if (left <= 300) el.style.color = '#d33';
      if (left <= 0) { stopTimer(); run.timeUp = true; finish(); }
    }
    tick();
    timerId = setInterval(tick, 1000);
  }

  // 画面いっぱいに ⭕ / ❌ をぱっと出す
  function flashMark(ok) {
    var el = h('div', { class: 'flash ' + (ok ? 'ok' : 'ng'), 'aria-hidden': 'true' }, [h('span', null, [ok ? '⭕' : '❌'])]);
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 800);
  }

  /* ---------- 画面の行き来(iPhone のスワイプで戻る・ブラウザの戻るボタン) ---------- */
  // 画面を進めるたびに履歴を 1 つ積み、戻ると popstate で 1 つ前の画面を出す。
  // 履歴の中身:v = 画面(home / field / cases / run / result)、d = ホームから何画面目か(ホームへは d 個戻る)
  var histOK = true;
  var screen = 'home';
  var homeY = 0;          // ホームのスクロール位置(戻ってきたときに元の場所を出す)
  var closeSheet = null;  // AI に質問のパネルが開いている間だけ、閉じる関数が入る
  try { history.scrollRestoration = 'manual'; } catch (e) { /* なくてもよい */ }
  function depth() { return (history.state && history.state.d) || 0; }
  function nav(st, replace) {
    if (!histOK) return;
    try { history[replace ? 'replaceState' : 'pushState'](st, ''); } catch (e) { histOK = false; }
  }
  function forward(st) {   // 新しい画面へ進む
    if (screen === 'home') homeY = window.scrollY;
    st.d = depth() + 1;
    nav(st);
  }
  function goBack() {      // 1 つ前の画面へ(履歴が使えないときはホームへ)
    if (histOK && depth() > 0) history.back(); else home(homeY);
  }
  function goHome() {
    if (histOK && depth() > 0) history.go(-depth()); else home(homeY);
  }
  // 履歴の中身から画面を出す(戻る・進む・読み込み直し)
  function render(st) {
    st = st || {};
    if (st.v === 'run' && (run || resumeRun())) { showCurrent(); return; }
    if (st.v === 'field' && fieldById[st.id]) { fieldMenu(st.id); return; }
    if (st.v === 'cases') { caseMenu(); return; }
    if (st.v && st.v !== 'home') nav({ v: 'home', d: st.d || 0 }, true);
    home(homeY);
  }
  window.addEventListener('popstate', function (e) {
    if (closeSheet) { closeSheet(); return; }   // AI に質問のパネルを閉じるだけ
    document.querySelectorAll('.overlay').forEach(function (o) { o.remove(); });
    if (run && !(e.state && e.state.v === 'run')) suspend();
    render(e.state);
  });

  /* ---------- AI に質問(解説を読んでも分からないところを聞く) ---------- */
  // config.js の CHAT_URL に Worker(worker/ フォルダ。Cloudflare Workers AI の無料枠)を入れると、この画面の中で答えが返る。
  // CHAT_URL が空のとき・その日の無料枠を使い切ったときは、ChatGPT か Claude を新しいタブで開き、問題と質問を入れた状態にする
  var CHAT_URL = (window.FP3_CONFIG && window.FP3_CONFIG.CHAT_URL) || '';
  var AIS = [
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/?q=' },   // ログインなしでも使える
    { id: 'claude', name: 'Claude', url: 'https://claude.ai/new?q=' }      // アカウント(無料プランあり)が必要
  ];
  var CHAT_MAX_TURNS = 12;    // 送る会話は 6 往復まで(Worker 側の上限と同じ)
  var CHAT_MAX_CHARS = 500;   // 質問 1 回の長さ(Worker 側の上限と同じ)
  var PREFILL_MAX = 1500;     // ChatGPT / Claude に渡す文の長さ(URL が長くなりすぎないように)
  var SUGGEST = ['もっとかんたんに説明して', 'ほかの選択肢はなぜ違うの?', '覚え方のコツを教えて'];
  var chats = {};             // 問題ごとの会話。ページを開いている間だけ覚えておく

  function askButton(it, picked) {
    return h('button', { class: 'askbtn', onclick: function () { openChat(it, picked); } }, ['💬 AIに質問する(分からないところを聞く)']);
  }

  function problemOf(it, picked) {
    var q = it.q;
    return {
      field: fieldById[q.f].name, question: q.q, choices: it.labels, correct: it.labels[it.correct],
      picked: picked == null ? null : it.labels[picked], explanation: q.e, caseText: q.jitsu ? q.ctx : undefined
    };
  }

  // ChatGPT / Claude の入力欄に入れる文(問題・答え・解説・質問)。長い解説は後ろを切る
  function prefillPrompt(p, question) {
    var head = 'FP3級の勉強中です。次の練習問題の解説を読みましたが、分からないところがあります。やさしく教えてください。\n\n';
    var body = (p.caseText ? '【事例】\n' + p.caseText + '\n\n' : '') + '【問題】' + p.question + '\n【選択肢】' + p.choices.join(' / ') +
      '\n【正解】' + p.correct + (p.picked ? '\n【私の答え】' + p.picked : '');
    var tail = '\n\n【質問】' + question;
    var room = PREFILL_MAX - head.length - body.length - tail.length - 10;
    var exp = room > 80 ? '\n【解説】' + (p.explanation.length > room ? p.explanation.slice(0, room) + '…' : p.explanation) : '';
    return (head + body + exp + tail).slice(0, PREFILL_MAX + 200);
  }

  function openChat(it, picked) {
    var q = it.q;
    var problem = problemOf(it, picked);
    var log = chats[q.id] || (chats[q.id] = []);
    var busy = null;   // 返事を待っている間の AbortController

    var list = h('div', { class: 'chatlog', 'aria-live': 'polite' });
    var input = h('textarea', { rows: '2', maxlength: String(CHAT_MAX_CHARS), placeholder: '例:「なぜ 1/2 をかけるの?」' });
    var sendBtn = h('button', { class: 'btn main sendbtn', onclick: function () { send(input.value); } }, ['送信']);
    // 質問の例:アプリの中で答えるときはそのまま送る。ChatGPT / Claude で聞くときは入力欄に入れる
    var chips = h('div', { class: 'chips' }, SUGGEST.map(function (t) {
      return h('button', { class: 'chip', onclick: function () { if (CHAT_URL) send(t); else { input.value = t; input.focus(); } } }, [t]);
    }));
    var note = CHAT_URL
      ? 'AIの答えはまちがえることがあります。大事な数値は公式テキストで確かめてください。'
      : 'ChatGPT はログインなしでも無料で使えます。Claude は無料のアカウントが必要です。AIの答えはまちがえることがあるので、大事な数値は公式テキストで確かめてください。';
    // ChatGPT / Claude で聞くボタン。Worker があるときは、答えを受け取れなかったときだけ出す
    var aiBtns = h('div', { class: 'aibtns', style: CHAT_URL ? 'display:none' : null }, AIS.map(function (ai) {
      return h('button', { class: 'btn' + (ai.id === lastAi() ? ' main' : ''), onclick: function () { openAi(ai, input.value); } }, [ai.name + 'で聞く ↗']);
    }));

    function bubble(role, text) {
      var b = h('div', { class: 'msg ' + (role === 'user' ? 'me' : 'ai') }, [text]);
      list.appendChild(b);
      list.scrollTop = list.scrollHeight;
      return b;
    }
    log.forEach(function (m) { bubble(m.role, m.content); });
    if (!log.length) list.appendChild(h('div', { class: 'chatempty' }, [CHAT_URL
      ? 'この問題について、分からないところを気軽に聞いてください。下のボタンからも選べます。'
      : '分からないところを書いて、聞きたいAIを選んでください。新しいタブで開き、この問題・正解・解説と質問が入った状態になります。\n\n下のボタンで、よくある質問を入れることもできます。']));

    function lastAi() { return load().ai || 'chatgpt'; }
    function openAi(ai, text) {
      text = (text || '').trim().slice(0, CHAT_MAX_CHARS) || 'この問題の解説を、もっとかんたんに教えてください。';
      window.open(ai.url + encodeURIComponent(prefillPrompt(problem, text)), '_blank', 'noopener');
      load().ai = ai.id; save();
    }

    function setBusy(b) {
      busy = b;
      sendBtn.disabled = !!b;
      chips.querySelectorAll('button').forEach(function (c) { c.disabled = !!b; });
    }

    function send(text) {
      text = (text || '').trim().slice(0, CHAT_MAX_CHARS);
      if (!text || busy) return;
      if (!CHAT_URL) {   // Enter のときは、前回使った AI で聞く
        openAi(AIS.filter(function (ai) { return ai.id === lastAi(); })[0] || AIS[0], text);
        return;
      }
      var empty = list.querySelector('.chatempty');
      if (empty) empty.remove();
      log.push({ role: 'user', content: text });
      bubble('user', text);
      input.value = '';
      var out = bubble('assistant', '');
      out.classList.add('wait');
      out.textContent = '考え中…';
      var answer = '';
      var ctrl = new AbortController();
      setBusy(ctrl);

      function fail(msg) {
        log.pop();   // 返事がなかった質問は会話に残さない(送り直せるように入力欄へ戻す)
        if (!input.value) input.value = text;
        out.classList.remove('wait');
        out.classList.add('err');
        out.textContent = (answer ? answer + '\n\n' : '') + '⚠ ' + msg;
        aiBtns.style.display = '';
        list.scrollTop = list.scrollHeight;
      }

      fetch(CHAT_URL, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: problem, messages: log.slice(-(CHAT_MAX_TURNS - 1)) })
      }).then(function (res) {
        if (res.status === 429) throw new Error('too_many');
        if (!res.ok || !res.body) throw new Error('http_' + res.status);
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', stop = null, error = null;
        function onLine(line) {
          if (!line.trim()) return;
          var ev = JSON.parse(line);
          if (ev.t === 'text') {
            answer = (answer + ev.v).replace(/^\s+/, '');   // 先頭の空行(考える過程を消した残り)は出さない
            if (!answer) return;
            out.classList.remove('wait');
            out.textContent = answer.replace(/\*\*/g, '');
            list.scrollTop = list.scrollHeight;
          } else if (ev.t === 'done') stop = ev.stop;
          else if (ev.t === 'error') error = ev.code;
        }
        function pump() {
          return reader.read().then(function (r) {
            if (!r.done) {
              buf += dec.decode(r.value, { stream: true });
              var lines = buf.split('\n');
              buf = lines.pop();
              lines.forEach(onLine);
              return pump();
            }
            onLine(buf);
            if (error) throw new Error(error);
            if (stop === 'refusal' || !answer) throw new Error('refusal');
            if (stop === 'max_tokens') { answer += '\n\n(長くなったので途中で切れました。続きは「続けて」と聞いてください)'; out.textContent = answer.replace(/\*\*/g, ''); }
            log.push({ role: 'assistant', content: answer.slice(0, 3000) });
          });
        }
        return pump();
      }).catch(function (err) {
        var code = err && err.message;
        if (err && err.name === 'AbortError') { log.pop(); out.remove(); return; }
        fail(navigator.onLine === false ? 'インターネットにつながっていません。つながってから、もう一度送ってください。'
          : code === 'daily_limit' ? '今日の無料のAI回数を使い切りました(毎朝9時に戻ります)。下のボタンから ChatGPT か Claude で聞けます。'
          : code === 'too_many' ? '質問が続いたので、少し待ってからもう一度送ってください。'
          : code === 'busy' ? 'AIが混み合っています。少し待ってから送るか、下のボタンから ChatGPT か Claude で聞いてください。'
          : code === 'refusal' ? 'この質問にはお答えできませんでした。聞き方を変えてみてください。'
          : 'うまく答えを受け取れませんでした。もう一度送るか、下のボタンから ChatGPT か Claude で聞いてください。');
      }).then(function () { setBusy(null); });
    }

    // 閉じる:履歴に積んだ 1 つを戻す(iPhone のスワイプで戻るでも閉じる)。popstate から closeSheet が呼ばれる
    function shut() {
      if (closeSheet !== shut) return;
      closeSheet = null;
      if (busy) busy.abort();
      wrapEl.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    }
    function close() {
      if (pushed && history.state && history.state.sheet) history.back(); else shut();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    }
    input.addEventListener('keydown', function (e) {
      // Enter で送信、Shift + Enter で改行(日本語の変換を確定する Enter では送らない)
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(input.value); }
    });

    var sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'AIに質問' }, [
      h('div', { class: 'sheethead' }, [
        h('b', null, ['💬 AIに質問']),
        h('span', { class: 'grow' }),
        h('button', { class: 'back', onclick: close, 'aria-label': '閉じる' }, ['閉じる ✕'])
      ]),
      h('div', { class: 'sheetq' }, [q.jitsu ? '事例:' + q.ctitle + ' / ' : '', q.q]),
      list,
      chips,
      h('div', { class: 'chatform' }, CHAT_URL ? [input, sendBtn] : [input]),
      aiBtns,
      h('div', { class: 'hint' }, [note])
    ]);
    var wrapEl = h('div', { class: 'sheet-wrap', onclick: function (e) { if (e.target === wrapEl) close(); } }, [sheet]);
    document.body.appendChild(wrapEl);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    closeSheet = shut;
    var cur = history.state || {}, st = {};
    Object.keys(cur).forEach(function (k) { st[k] = cur[k]; });
    st.sheet = 1;
    st.d = depth() + 1;
    nav(st);
    var pushed = histOK;
    list.scrollTop = list.scrollHeight;
    setTimeout(function () { input.focus(); }, 50);
  }

  /* ---------- 出題セッション ---------- */
  // run = { title, mock, items: [{q, o(選択肢の並び), labels, correct}], i, picks, ctxOpen }
  // 答えるたびに保存(load().run)するので、途中でやめても・ページが読み込み直されても「続きから」で再開できる
  var run = null;
  var keyHandler = null;
  function setKeys(fn) {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    // AI に質問している間・確認ボックスが出ている間・文字を入力している間は、画面のキー操作(Enter で次へ など)を止める
    keyHandler = fn && function (e) {
      if (document.querySelector('.sheet-wrap, .overlay') || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      fn(e);
    };
    if (keyHandler) document.addEventListener('keydown', keyHandler);
  }

  // 選択肢を並べて、1 問分の表示データにする(○× は並び固定)。order を渡すと、その並び(続きから再開するとき)
  function prepare(q, order) {
    if (q.tf) return { q: q, labels: ['○(正しい)', '×(誤り)'], correct: q.a ? 0 : 1 };
    var idx = q.c.map(function (c, i) { return i; });
    if (!order || order.length !== idx.length || order.slice().sort().join() !== idx.join()) order = shuffle(idx);
    return { q: q, o: order, labels: order.map(function (i) { return q.c[i]; }), correct: order.indexOf(0) };
  }

  // 途中の問題の保存・再開
  function persist() {
    if (!run) return;
    load().run = {
      t: run.title, m: run.mock ? 1 : 0, i: run.i, p: run.picks,
      ids: run.items.map(function (it) { return it.q.id; }),
      o: run.items.map(function (it) { return it.o || null; }),
      e: run.endsAt || 0, l: run.limit || 0
    };
    save();
  }
  function clearSaved() { delete load().run; save(); }
  function savedRun() {
    var s = load().run;
    if (!s || !s.ids || !s.ids.length || s.ids.some(function (id) { return !QS[id]; })) return null;
    return s;
  }
  function resumeRun() {
    var s = savedRun();
    if (!s) return false;
    run = {
      title: s.t, mock: !!s.m, i: Math.min(s.i || 0, s.ids.length - 1), picks: (s.p || []).slice(), ctxOpen: {},
      limit: s.l || 0, endsAt: s.e || 0,
      items: s.ids.map(function (id, k) { return prepare(QS[id], s.o && s.o[k]); })
    };
    return true;
  }
  // 出題をいったん離れる(答えは保存したまま。1 問も答えていなければ消す)
  function suspend() {
    stopTimer();
    if (run && !answeredIn(run.picks)) clearSaved();
    run = null;
    setKeys(null);
  }
  function showCurrent() {
    if (!run.mock && run.picks[run.i] != null) showExplanation(); else showQuestion();
  }

  // 実技の事例文(タップで開く / たたむ)。remember を渡すと、開いたかどうかを覚えておく
  function ctxBox(q, open, remember) {
    var d = h('details', { class: 'ctx', open: !!open }, [
      h('summary', null, [h('span', { class: 'ctitle' }, ['📋 事例:' + q.ctitle]), h('span', { class: 'ctoggle' })]),
      h('div', { class: 'ctext' }, [q.ctx])
    ]);
    if (remember) d.addEventListener('toggle', function () { remember(d.open); });
    return d;
  }
  function firstOfCase() {
    var q = run.items[run.i].q, prev = run.i > 0 && run.items[run.i - 1].q;
    return !prev || !prev.jitsu || prev.cid !== q.cid;
  }
  function rememberCtx(cid) { var r = run; return function (open) { r.ctxOpen[cid] = open; }; }

  // ★ ボタン(あとで見直す)
  function starButton(q) {
    var b = h('button', { class: 'star', onclick: function () { paint(toggleStar(q)); } });
    function paint(on) {
      b.textContent = on ? '★ 見直す' : '☆ 見直す';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? '★を外す' : 'あとで見直す(★を付ける)');
    }
    paint(isStar(q));
    return b;
  }
  // 問題カードの上の段:分野・形式の札と ★
  function cardTop(q, extra) {
    return h('div', { class: 'ctop' }, [h('span', { class: 'tag' }, [fieldById[q.f].name])].concat(extra || [], [h('span', { class: 'grow' }), starButton(q)]));
  }

  function startRun(opts) {
    var qs = opts.questions;
    if (!qs.length) return;
    run = {
      title: opts.title,
      mock: !!opts.mock,
      limit: opts.timed || 0,
      endsAt: opts.timed ? Date.now() + opts.timed * 1000 : 0,
      items: qs.map(function (q) { return prepare(q); }),
      i: 0,
      picks: [],
      ctxOpen: {}
    };
    persist();
    // 結果の画面からの「もう一度」は履歴を増やさない(戻るで 1 つ前の画面へ)
    var st = history.state || {};
    if (st.v === 'run' || st.v === 'result') nav({ v: 'run', d: depth() }, true); else forward({ v: 'run' });
    showQuestion();
  }
  // ホームなどから始める。途中の模擬試験があれば、消えてよいか先に聞く
  function begin(opts) {
    var s = savedRun(), n = s && s.m ? answeredIn(s.p) : 0;
    if (!n) { startRun(opts); return; }
    ask('途中の模擬試験(' + n + ' / ' + s.ids.length + '問 回答済み)があります。新しく始めると、その答えは消えます。', '新しく始める', function () { startRun(opts); });
  }

  function header() {
    var fs = h('button', { class: 'fsbtn', 'aria-label': '文字の大きさを変える', onclick: function () { cycleFont(); fs.textContent = '文字:' + fontName(); } }, ['文字:' + fontName()]);
    var kids = [
      h('button', { class: 'back', onclick: quit }, ['← やめる']),
      h('div', { class: 'grow' })
    ];
    if (run && run.endsAt) kids.push(h('span', { class: 'qcount', id: 'fx-timer' }, ['⏱ ' + fmtTime(Math.max(0, Math.round((run.endsAt - Date.now()) / 1000)))]));
    kids.push(fs);
    kids.push(h('div', { class: 'qcount' }, [(run.i + 1) + ' / ' + run.items.length]));
    return h('div', { class: 'qhead' }, kids);
  }

  // 問題の画面:答えを選ぶと、そのたびに解説ページ(showExplanation)へ進む。模擬試験は前後に動ける
  function showQuestion(y) {
    screen = 'run';
    var it = run.items[run.i];
    var q = it.q;
    var last = run.i === run.items.length - 1;

    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(header());
    wrap.appendChild(bar(pct(run.mock ? answeredIn(run.picks) : run.i, run.items.length)));

    var card = h('div', { class: 'card' });
    card.appendChild(cardTop(q, [h('span', { class: 'tag tf' }, [q.jitsu ? '実技' : q.tf ? '○×' : '4択'])]));
    // 事例文:その事例の 1 問目は開いておく。2 問目からはたたむ(開いたら、その事例の間は開いたまま)
    if (q.jitsu) card.appendChild(firstOfCase() ? ctxBox(q, true) : ctxBox(q, run.ctxOpen[q.cid], rememberCtx(q.cid)));
    card.appendChild(h('div', { class: 'qtext' }, [q.q]));
    var list = h('div', { class: 'choices' + (q.tf ? ' tfgrid' : '') });
    it.labels.forEach(function (label, i) {
      var inner = q.tf
        ? [h('span', { class: 't' }, [label])]
        : [h('span', { class: 'n' }, [String(i + 1)]), h('span', { class: 't' }, [label])];
      var picked = run.mock && run.picks[run.i] === i;
      list.appendChild(h('button', { class: 'choice' + (picked ? ' picked' : ''), onclick: function () { choose(i); } }, inner));
    });
    card.appendChild(list);
    wrap.appendChild(card);
    var chosen = run.mock && run.picks[run.i] != null;
    var keys = q.tf ? '1(○)・2(×)キーでも答えられます' : '1〜4 キーでも答えられます';
    if (run.mock) {
      // 前の問題・次の問題は画面下に固定(指の届く場所)
      var btns = [];
      if (run.i > 0) btns.push(h('button', { class: 'btn', onclick: prev }, ['← 前の問題']));
      if (chosen) btns.push(h('button', { class: 'btn main', onclick: next }, [last ? '答え合わせへ' : '次の問題へ →']));
      var note = chosen ? '選び直せます。' : '答え合わせは最後にまとめて。';
      var keyNote = chosen ? 'Enter で次へ・← キーで前へ' : keys;
      if (btns.length) {
        wrap.classList.add('has-dock');
        wrap.appendChild(h('div', { class: 'dock' }, [
          h('div', { class: 'duo n' + btns.length }, btns),
          h('div', { class: 'hint' }, [note, h('span', { class: 'keyhint' }, [keyNote])])
        ]));
      } else {
        wrap.appendChild(h('div', { class: 'hint' }, [note, h('span', { class: 'keyhint' }, [keyNote])]));
      }
    } else {
      wrap.appendChild(h('div', { class: 'hint keyhint' }, [keys]));
    }
    mount(wrap, y);
    startTimer();

    setKeys(function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (chosen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); return; }
      if (run.mock && e.key === 'ArrowLeft' && run.i > 0) { e.preventDefault(); prev(); return; }
      if (/^[1-4]$/.test(e.key) && +e.key <= it.labels.length) choose(+e.key - 1);
    });
  }

  // 解説ページ:判定は小さく、正解とあなたの答えだけ出して、解説がすぐ読めるようにする
  function showExplanation() {
    screen = 'run';
    var it = run.items[run.i];
    var q = it.q;
    var picked = run.picks[run.i];
    var ok = picked === it.correct;
    var last = run.i === run.items.length - 1;

    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(header());
    wrap.appendChild(bar(pct(run.i + 1, run.items.length)));

    // 判定は問題カードの上の段に(別の箱にしない分、解説が上に来る)
    var card = h('div', { class: 'card judged ' + (ok ? 'ok' : 'ng') });
    card.appendChild(h('div', { class: 'ctop' }, [
      h('span', { class: 'verdict ' + (ok ? 'ok' : 'ng') }, [ok ? '⭕ 正解!' : '❌ 不正解']), h('span', { class: 'grow' }), starButton(q)
    ]));
    if (q.jitsu) card.appendChild(ctxBox(q, run.ctxOpen[q.cid], rememberCtx(q.cid)));
    card.appendChild(h('div', { class: 'qtext sm' }, [q.q]));
    card.appendChild(answerRows(it, picked));
    wrap.appendChild(card);

    wrap.appendChild(h('div', { class: 'card exp' }, [h('h3', null, ['解説']), h('p', null, [q.e]), askButton(it, picked)]));
    var nxt = dueText(q);
    if (nxt) wrap.appendChild(h('div', { class: 'hint' }, ['🔁 次回の復習は ' + nxt + '(今日の10問に出てきます)']));
    // 画面下に固定(解説が長くてスクロールしても動かない)
    wrap.classList.add('has-dock');
    wrap.appendChild(h('div', { class: 'dock' }, [
      h('button', { class: 'btn main', onclick: next }, [last ? '結果を見る' : '次の問題へ']),
      h('div', { class: 'hint keyhint' }, ['Enter / スペースキーでも進めます'])
    ]));
    mount(wrap);

    setKeys(function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
    });
  }

  // 正解(と、まちがえたときはあなたの答え)を上に。ほかの選択肢はたたむ
  function answerRows(it, picked) {
    var box = h('div', { class: 'choices answers' });
    function row(i, kind, badge) {
      return h('div', { class: 'choice ' + kind }, [
        it.q.tf ? null : h('span', { class: 'n' }, [String(i + 1)]),
        h('span', { class: 't' }, [badge ? h('span', { class: 'badge' }, [badge]) : null, it.labels[i]])
      ]);
    }
    box.appendChild(row(it.correct, 'ok', '正解'));
    if (picked != null && picked !== it.correct) box.appendChild(row(picked, 'ng', 'あなたの答え'));
    var rest = it.labels.map(function (l, i) { return i; }).filter(function (i) { return i !== it.correct && i !== picked; });
    if (rest.length && !it.q.tf) {
      box.appendChild(h('details', { class: 'others' }, [h('summary', null, ['ほかの選択肢(' + rest.length + ')'])]
        .concat(rest.map(function (i) { return row(i, 'dim'); }))));
    }
    return box;
  }

  function choose(i) {
    var it = run.items[run.i];
    run.picks[run.i] = i;
    persist();
    if (run.mock) { showQuestion(window.scrollY); return; }   // 模擬試験は最後にまとめて答え合わせ
    var ok = i === it.correct;
    record(it.q, ok);
    playSfx(ok);
    showExplanation();
    flashMark(ok);
  }

  function next() {
    if (run.i >= run.items.length - 1) { finish(); return; }
    run.i++;
    persist();
    showQuestion();
  }
  function prev() {
    if (run.i <= 0) return;
    run.i--;
    persist();
    showQuestion();
  }

  // confirm() は埋め込み表示で使えないため、画面内の確認ボックスを出す
  function ask(message, yesLabel, onYes) {
    var ov = h('div', { class: 'overlay' }, [h('div', { class: 'dialog', role: 'dialog' }, [
      h('p', null, [message]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn main', onclick: function () { ov.remove(); onYes(); } }, [yesLabel]),
        h('button', { class: 'btn', onclick: function () { ov.remove(); } }, ['キャンセル'])
      ])
    ])]);
    document.body.appendChild(ov);
  }

  // やめる:答えはそのまま残し、ホームの「続きから」で再開できる
  function quit() {
    suspend();
    goBack();
  }

  /* ---------- 結果 ---------- */
  function finish() {
    stopTimer();
    setKeys(null);
    screen = 'result';
    var items = run.items;
    if (run.mock) items.forEach(function (it, i) { record(it.q, run.picks[i] === it.correct); });
    clearSaved();
    nav({ v: 'result', d: depth() }, true);
    var right = items.filter(function (it, i) { return run.picks[i] === it.correct; }).length;
    var total = items.length;
    var rate = right / total;

    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(h('div', { class: 'card score' }, [
      h('div', { class: 'sec', style: 'margin:0 0 6px' }, [run.title]),
      h('div', { class: 'big' }, [String(right), h('small', null, [' / ' + total + '問'])]),
      h('div', null, ['正答率 ' + pct(right, total) + '%']),
      h('div', { class: 'judge ' + (rate >= PASS_RATE ? 'pass' : 'fail') },
        [rate >= PASS_RATE ? '合格ライン(60%)クリア!' : 'あと ' + (Math.ceil(total * PASS_RATE) - right) + '問で合格ライン(60%)']),
      run.timeUp ? h('div', null, ['⏱ 制限時間になりました']) : null
    ]));

    // 分野ごと
    var per = {};
    items.forEach(function (it, i) {
      var p = per[it.q.f] || (per[it.q.f] = { r: 0, n: 0 });
      p.n++; if (run.picks[i] === it.correct) p.r++;
    });
    var ids = Object.keys(per);
    if (ids.length > 1) {
      var bd = h('div', { class: 'breakdown' });
      ids.forEach(function (id) {
        bd.appendChild(h('div', { class: 'brow' }, [
          h('span', null, [fieldById[id].short]), bar(pct(per[id].r, per[id].n)),
          h('span', null, [per[id].r + '/' + per[id].n])
        ]));
      });
      wrap.appendChild(h('div', { class: 'card' }, [h('h3', { style: 'font-size:14px;margin-bottom:10px' }, ['分野ごとの結果']), bd]));
    }

    // 間違えた問題の復習(解説つき)
    var miss = items.map(function (it, i) { return { it: it, pick: run.picks[i] }; })
      .filter(function (x) { return x.pick !== x.it.correct; });
    var rv = h('div', { class: 'card' });
    if (!miss.length) {
      rv.appendChild(h('div', { class: 'empty' }, ['全問正解です!🎉']));
    } else {
      rv.appendChild(h('h3', { style: 'font-size:14px' }, ['間違えた問題(' + miss.length + '問)']));
      miss.forEach(function (x) {
        var q = x.it.q;
        var mine = x.pick == null ? '未回答' : x.it.labels[x.pick];
        rv.appendChild(h('div', { class: 'review' }, [
          h('div', { class: 'ctop' }, [h('span', { class: 'tag' }, [fieldById[q.f].short]), h('span', { class: 'grow' }), starButton(q)]),
          q.jitsu ? ctxBox(q, false) : null,
          h('div', { class: 'qtext' }, [q.q]),
          h('div', { class: 'ans' }, [h('span', { class: 'mine' }, ['あなたの答え:' + mine])]),
          h('div', { class: 'ans' }, [h('span', { class: 'right' }, ['正解:' + x.it.labels[x.it.correct]])]),
          h('details', { class: 'rv' }, [h('summary', null, ['解説を見る']),
            h('div', { class: 'exp' }, [h('p', null, [q.e]), askButton(x.it, x.pick)])])
        ]));
      });
    }
    wrap.appendChild(rv);

    if (run.mock) {
      var okList = items.map(function (it, i) { return { it: it, pick: run.picks[i] }; })
        .filter(function (x) { return x.pick === x.it.correct; });
      if (okList.length) {
        var ov = h('div', { class: 'card' }, [h('h3', { style: 'font-size:14px' }, ['正解した問題(' + okList.length + '問)'])]);
        okList.forEach(function (x) {
          ov.appendChild(h('div', { class: 'review' }, [
            h('div', { class: 'ctop' }, [h('span', { class: 'tag' }, [fieldById[x.it.q.f].short]), h('span', { class: 'grow' }), starButton(x.it.q)]),
            h('div', { class: 'qtext' }, [x.it.q.q]),
            h('div', { class: 'ans' }, [h('span', { class: 'right' }, ['⭕ ' + x.it.labels[x.it.correct]])]),
            h('details', { class: 'rv' }, [h('summary', null, ['解説を見る']), h('div', { class: 'exp' }, [h('p', null, [x.it.q.e]), askButton(x.it, x.pick)])])
          ]));
        });
        wrap.appendChild(ov);
      }
    }

    var again = run;
    wrap.appendChild(h('div', { class: 'actions' }, [
      miss.length ? h('button', { class: 'btn main', onclick: function () {
        startRun({ title: '間違えた問題をやり直す', questions: miss.map(function (x) { return x.it.q; }) });
      } }, ['間違えた問題だけ、もう一度']) : null,
      h('button', { class: 'btn' + (miss.length ? '' : ' main'), onclick: function () {
        startRun({ title: again.title, mock: again.mock, timed: again.limit || 0, questions: again.items.map(function (it) { return it.q; }) });
      } }, ['同じ問題をもう一度']),
      h('button', { class: 'btn', onclick: goHome }, ['ホームにもどる'])
    ]));
    mount(wrap);
    run = null;
  }

  /* ---------- ホーム ---------- */
  function fieldStat(id) {
    var qs = PLAIN.filter(function (q) { return q.f === id; });
    var tried = 0, right = 0, wrong = 0;
    qs.forEach(function (q) {
      var r = recOf(q);
      if (r) { tried++; if (r.last) right++; else wrong++; }
    });
    return { total: qs.length, tried: tried, right: right, wrong: wrong };
  }

  // 今日の10問:復習の期限が来た問題(期限を過ぎた順)を優先し、まだ解いていない問題を足す。足りなければ解いた問題から
  function todaySet() {
    var due = [], fresh = [], rest = [];
    shuffle(PLAIN).forEach(function (q) {
      var r = recOf(q);
      if (!r) fresh.push(q);
      else if (isDue(q)) due.push(q);
      else rest.push(q);
    });
    due.sort(function (a, b) { return dueOf(a) - dueOf(b); });
    var pick = due.slice(0, TODAY_COUNT);
    pick = pick.concat(fresh.slice(0, TODAY_COUNT - pick.length));
    pick = pick.concat(rest.slice(0, TODAY_COUNT - pick.length));
    return shuffle(pick);
  }

  function home(y) {
    if (run) suspend();
    setKeys(null);
    screen = 'home';
    var tried = 0, answers = 0, correctAnswers = 0, rightLast = 0;
    QS.forEach(function (q) {
      var r = recOf(q);
      if (r) { tried++; answers += r.r + r.w; correctAnswers += r.r; if (r.last) rightLast++; }
    });

    var wrongs = wrongList();
    var dueCount = QS.filter(isDue).length;
    var stars = starList();

    var wrap = h('div');
    wrap.appendChild(h('div', { class: 'hero' }, [
      h('h1', null, ['FP3級 合格ドリル']),
      h('p', null, ['3級FP技能検定の対策。問題を解いて、解説でしっかり理解しよう。'])
    ]));

    var rc = resumeCard();
    if (rc) wrap.appendChild(rc);
    var ic = installCard();
    if (ic) wrap.appendChild(ic);

    wrap.appendChild(examCard(rightLast));
    wrap.appendChild(h('div', { class: 'sec' }, ['あなたの進み具合']));
    wrap.appendChild(h('div', { class: 'card stack' }, [
      h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [h('b', null, [tried + '/' + QS.length]), h('span', null, ['解いた問題'])]),
        h('div', { class: 'stat' }, [h('b', null, [pct(correctAnswers, answers) + '%']), h('span', null, ['通算の正答率'])]),
        h('div', { class: 'stat' }, [h('b', null, [String(dueCount)]), h('span', null, ['復習が必要'])])
      ]),
      bar(pct(tried, QS.length))
    ]));

    wrap.appendChild(h('div', { class: 'sec' }, ['問題を解く']));
    var modes = h('div', { class: 'modes' });
    modes.appendChild(mode('☀️', '今日の10問', '復習の期限が来た問題・まだ解いていない問題を優先して10問。1問ごとに解説', true, function () {
      begin({ title: '今日の10問', questions: todaySet() });
    }));
    modes.appendChild(mode('📝', '模擬試験(30問)', '6分野から5問ずつ。判定と解説は最後にまとめて。60%で合格ライン', false, function () {
      var picked = [];
      FIELDS.forEach(function (f) {
        picked = picked.concat(shuffle(PLAIN.filter(function (q) { return q.f === f.id; })).slice(0, MOCK_PER_FIELD));
      });
      begin({ title: '模擬試験', mock: true, questions: shuffle(picked) });
    }));
    modes.appendChild(mode('⏱', '本番形式の模擬試験(60問)', '6分野から10問ずつ。本番と同じ制限時間' + HONBAN_MINUTES + '分。判定と解説は最後にまとめて', false, function () {
      var picked = [];
      FIELDS.forEach(function (f) {
        picked = picked.concat(shuffle(PLAIN.filter(function (q) { return q.f === f.id; })).slice(0, HONBAN_PER_FIELD));
      });
      begin({ title: '本番形式の模擬試験', mock: true, timed: HONBAN_MINUTES * 60, questions: shuffle(picked) });
    }));
    modes.appendChild(mode('🔁', '間違えた問題を復習(' + wrongs.length + '問)',
      wrongs.length ? '前回まちがえた問題だけ。正解すると復習リストから消えます' : 'まちがえた問題がたまるとここで復習できます', false, function () {
        begin({ title: '間違えた問題の復習', questions: shuffle(wrongs) });
      }, !wrongs.length));
    modes.appendChild(mode('⭐', '★を付けた問題(' + stars.length + '問)',
      stars.length ? 'あとで見直すために ★ を付けた問題' : '問題の右上の「☆ 見直す」をタップすると、ここに集まります', false, function () {
        begin({ title: '★を付けた問題', questions: shuffle(stars) });
      }, !stars.length));
    wrap.appendChild(modes);

    wrap.appendChild(h('div', { class: 'sec' }, ['実技(事例形式)']));
    var jq = QS.filter(function (q) { return q.jitsu; });
    var jRight = jq.filter(function (q) { var r = recOf(q); return r && r.last; }).length;
    var jm = h('div', { class: 'modes' });
    jm.appendChild(mode('📋', '実技 ランダム2事例', '事例文を読んで、続けて答える形式。1問ごとに ⭕❌ の判定と解説', false, function () {
      var ids = shuffle(CASES.map(function (c, i) { return i; })).slice(0, 2), qs = [];
      ids.forEach(function (cid) { qs = qs.concat(caseQs(cid)); });
      begin({ title: '実技 ランダム2事例', questions: qs });
    }));
    jm.appendChild(mode('🗂', '事例を選んで解く(' + CASES.length + '事例)', '分野ごとの一覧から選ぶ。正解済み ' + jRight + ' / ' + jq.length + '問', false, function () {
      forward({ v: 'cases' });
      caseMenu();
    }));
    wrap.appendChild(jm);

    wrap.appendChild(h('div', { class: 'sec' }, ['分野ごとに解く']));
    var fl = h('div', { class: 'modes' });
    FIELDS.forEach(function (f) {
      var s = fieldStat(f.id);
      fl.appendChild(h('button', { class: 'field', onclick: function () { forward({ v: 'field', id: f.id }); fieldMenu(f.id); } }, [
        h('div', { class: 'top' }, [h('span', { class: 'ic' }, [f.icon]), h('b', null, [f.name]), h('small', null, [s.total + '問'])]),
        h('div', { class: 'desc' }, [f.desc]),
        bar(pct(s.right, s.total)),
        h('div', { class: 'meta' }, [h('span', null, ['正解済み ' + s.right + ' / ' + s.total]), h('span', null, [s.wrong ? '復習 ' + s.wrong + '問' : ''])])
      ]));
    });
    wrap.appendChild(fl);

    wrap.appendChild(h('div', { class: 'sec' }, ['設定']));
    var muted = !!load().mute;
    wrap.appendChild(h('div', { class: 'card settings' }, [
      h('div', { class: 'srow' }, [h('span', null, ['効果音']), seg([{ id: 'on', name: 'ON' }, { id: 'off', name: 'OFF' }], muted ? 'off' : 'on', function (id) {
        load().mute = id === 'off'; save();
        if (id === 'on') playSfx(true);
      })]),
      h('div', { class: 'srow' }, [h('span', null, ['文字の大きさ']), seg(FONT_SIZES, fontId(), setFont)]),
      standalone() ? null : h('div', { class: 'srow' }, [h('span', null, ['ホーム画面に追加']), h('button', { class: 'sbtn', onclick: installDialog }, ['やり方を見る'])]),
      h('div', { class: 'srow' }, [h('span', null, ['記録の引き継ぎ']), h('button', { class: 'sbtn', onclick: transferDialog }, ['コピー / 読み込み'])]),
      h('div', { class: 'srow' }, [h('button', { class: 'linkbtn', onclick: function () {
        ask('学習の記録(解いた結果・途中の問題)をすべて消しますか?★と設定は残ります。', '消す', function () {
          var s = load(); s.q = {}; delete s.run; save(); home(window.scrollY);
        });
      } }, ['学習の記録を消す'])])
    ]));

    wrap.appendChild(h('div', { class: 'note' }, [
      '※ 問題・解説はこのアプリのオリジナルです。2026年6月〜2027年5月の試験(法令基準日:2026年4月1日)を想定して作っています。2026年の税制改正で数値が動いている項目(基礎控除・配偶者控除・給与所得控除など)は、確認が取れるまで出題していません。数値や制度は法改正で変わることがあるため、受検前に必ず試験実施団体(日本FP協会・金融財政事情研究会)の公式情報と最新テキストで確認してください。学科試験は 60 問中 36 問以上(60%)が合格基準です。'
    ]));
    mount(wrap, y);
  }

  // 切り替えボタン(効果音・文字の大きさ)。押すとその場でホームを描き直す
  function seg(opts, cur, onPick) {
    return h('div', { class: 'seg', role: 'group' }, opts.map(function (o) {
      return h('button', { class: o.id === cur ? 'on' : '', 'aria-pressed': String(o.id === cur), onclick: function () {
        onPick(o.id);
        home(window.scrollY);
      } }, [o.name]);
    }));
  }

  // 途中の問題(やめた・ページが読み込み直された)をホームの上に出す
  function resumeCard() {
    var s = savedRun();
    if (!s) return null;
    var n = answeredIn(s.p), total = s.ids.length, at = Math.min(s.i || 0, total - 1) + 1;
    function discard() {
      if (s.m && n) ask('この模擬試験の答え(' + n + '問)を消して、終わりにしますか?', '終わりにする', function () { clearSaved(); home(window.scrollY); });
      else { clearSaved(); home(window.scrollY); }
    }
    return h('div', { class: 'card resume' }, [
      h('div', { class: 'rtop' }, [h('b', null, ['▶ 続きから']), h('span', null, [s.t])]),
      h('div', { class: 'rmeta' }, [at + ' / ' + total + '問目' + (s.m ? '(' + n + '問 回答済み)' : '')]),
      bar(pct(s.m ? n : at - 1, total)),
      h('div', { class: 'duo n2' }, [
        h('button', { class: 'btn', onclick: discard }, ['終わりにする']),
        h('button', { class: 'btn main', onclick: function () {
          if (!resumeRun()) { home(); return; }
          forward({ v: 'run' });
          showCurrent();
        } }, ['続きから解く'])
      ])
    ]);
  }

  function mode(icon, title, sub, primary, fn, disabled) {
    return h('button', { class: 'mode' + (primary ? ' primary' : ''), disabled: !!disabled, onclick: fn }, [
      h('span', { class: 'ic' }, [icon]),
      h('span', { class: 'tx' }, [h('b', null, [title]), h('span', null, [sub])]),
      h('span', { class: 'go' }, ['›'])
    ]);
  }

  // 実技の事例のボタン(正解済み / 問題数)
  function caseList(cids) {
    var cl = h('div', { class: 'cases' });
    cids.forEach(function (cid) {
      var c = CASES[cid], qs = caseQs(cid), right = 0, wrong = 0;
      qs.forEach(function (q) { var r = recOf(q); if (r) { if (r.last) right++; else wrong++; } });
      cl.appendChild(h('button', { class: 'casebtn', onclick: function () { begin({ title: '実技:' + c.title, questions: qs }); } }, [
        h('span', { class: 'tag' }, [fieldById[c.f].short]),
        h('b', null, [c.title]),
        h('small', null, [right + '/' + c.n + (wrong ? ' ・復習' + wrong : '')])
      ]));
    });
    return cl;
  }
  function casesOf(fid) { return CASES.map(function (c, i) { return i; }).filter(function (i) { return CASES[i].f === fid; }); }

  // 実技の事例の一覧(分野ごと)
  function caseMenu() {
    setKeys(null);
    screen = 'cases';
    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(h('div', { class: 'qhead' }, [h('button', { class: 'back', onclick: goBack }, ['← ホーム'])]));
    wrap.appendChild(h('div', { class: 'hero', style: 'padding-top:0' }, [h('h1', { style: 'font-size:22px' }, ['📋 実技の事例']),
      h('p', null, ['事例文を読んで、続けて答える形式です。右の数字は「正解済み / 問題数」。'])]));
    FIELDS.forEach(function (f) {
      var ids = casesOf(f.id);
      if (!ids.length) return;
      wrap.appendChild(h('div', { class: 'sec' }, [f.icon + ' ' + f.name]));
      wrap.appendChild(caseList(ids));
    });
    mount(wrap);
  }

  // 分野を選んだあと:全問 / 未回答だけ / 苦手だけ / この分野の実技
  function fieldMenu(id) {
    setKeys(null);
    screen = 'field';
    var f = fieldById[id];
    var qs = PLAIN.filter(function (q) { return q.f === id; });
    var fresh = qs.filter(function (q) { return !recOf(q); });
    var wrongs = qs.filter(function (q) { var r = recOf(q); return r && r.last === false; });

    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(h('div', { class: 'qhead' }, [h('button', { class: 'back', onclick: goBack }, ['← ホーム'])]));
    wrap.appendChild(h('div', { class: 'hero', style: 'padding-top:0' }, [h('h1', { style: 'font-size:22px' }, [f.icon + ' ' + f.name]), h('p', null, [f.desc])]));
    var modes = h('div', { class: 'modes' });
    modes.appendChild(mode('▶', '全問(' + qs.length + '問)', 'シャッフルして出題', true, function () {
      begin({ title: f.name, questions: shuffle(qs) });
    }));
    modes.appendChild(mode('🆕', 'まだ解いていない問題(' + fresh.length + '問)', '', false, function () {
      begin({ title: f.name + '(未回答)', questions: shuffle(fresh) });
    }, !fresh.length));
    modes.appendChild(mode('🔁', 'まちがえた問題(' + wrongs.length + '問)', '', false, function () {
      begin({ title: f.name + '(復習)', questions: shuffle(wrongs) });
    }, !wrongs.length));
    wrap.appendChild(modes);
    var cids = casesOf(id);
    if (cids.length) {
      wrap.appendChild(h('div', { class: 'sec' }, ['この分野の実技(事例形式)']));
      wrap.appendChild(caseList(cids));
    }
    mount(wrap);
  }

  /* ---------- ホーム画面に追加(アプリのように全画面で開く・電波がなくても解ける) ---------- */
  // iPhone の Chrome は「共有 → 表示を増やす → ホーム画面に追加」。ほかのアプリ(LINE など)は Safari で開き直す手順を出す
  var installEvt = null;   // Android の Chrome・パソコンの Chrome / Edge で「インストール」を出すためのイベント
  function standalone() {
    return navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  // 'ios-safari' / 'ios-other'(iPhone の Chrome・Edge・Firefox・LINE など)/ 'android' / 'desktop'
  function platform() {
    var ua = navigator.userAgent;
    if (/iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Line\/|FBAN|FBAV|Instagram/.test(ua) ? 'ios-other' : 'ios-safari';
    }
    return /Android/.test(ua) ? 'android' : 'desktop';
  }
  function browserName() {
    var ua = navigator.userAgent;
    return /CriOS/.test(ua) ? 'Chrome' : /EdgiOS/.test(ua) ? 'Edge' : /FxiOS/.test(ua) ? 'Firefox' : /Line\//.test(ua) ? 'LINE' : 'このブラウザ';
  }
  function appUrl() { return location.origin + location.pathname; }

  // クリップボードにコピー(使えないときは選択してコピーを試す)。done(できたか)
  function copyText(text, done) {
    function fallback() {
      var t = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
      t.value = text;
      document.body.appendChild(t);
      t.select(); t.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* できなければ false */ }
      t.remove();
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }
  function copyButton(label, text) {
    var b = h('button', { class: 'btn', onclick: function () {
      copyText(text(), function (ok) { b.textContent = ok ? 'コピーしました ✓' : 'コピーできませんでした'; });
    } }, [label]);
    return b;
  }

  // 追加のしかた(端末・ブラウザごと)。ホームの案内と、設定の「やり方を見る」で使う
  function installHow() {
    var p = platform();
    var share = '「共有」ボタン(□に↑。見当たらなければ「…」の中)→「ホーム画面に追加」→「追加」';
    if (installEvt) {
      return [h('button', { class: 'btn main', onclick: function () {
        installEvt.prompt();
        installEvt.userChoice.then(function () { installEvt = null; if (screen === 'home') home(window.scrollY); });
      } }, [p === 'desktop' ? 'アプリとしてインストール' : 'ホーム画面に追加'])];
    }
    if (p === 'ios-safari') return [h('p', { class: 'how' }, [share])];
    if (p === 'ios-other' && browserName() === 'Chrome') return [h('p', { class: 'how' }, ['「共有」ボタン(□に↑)→「表示を増やす」→「ホーム画面に追加」'])];
    if (p === 'ios-other') {
      return [
        h('p', { class: 'how' }, [(browserName() === 'このブラウザ' ? 'このブラウザ' : 'iPhone の ' + browserName() + ' ') + 'では「ホーム画面に追加」が出ないことがあります。Safari で開くのが確実です。']),
        h('ol', { class: 'steps' }, [
          h('li', null, ['下のボタンでアドレスをコピー']),
          h('li', null, ['Safari を開いて、アドレス欄に貼り付けて開く']),
          h('li', null, [share])
        ]),
        copyButton('アドレスをコピー', appUrl)
      ];
    }
    if (p === 'android') return [h('p', { class: 'how' }, ['右上のメニュー(︙)→「ホーム画面に追加」または「アプリをインストール」'])];
    return [h('p', { class: 'how' }, ['スマホで開いて追加してください。パソコンの Chrome / Edge は、アドレスバー右のインストールのボタンからも入れられます。'])];
  }
  var RECORD_NOTE = 'ホーム画面のアプリは、ブラウザとは記録の保存場所が別です。今までの記録は、設定の「記録の引き継ぎ」で移せます。';
  function installCard() {
    if (standalone() || load().pwaHint || (platform() === 'desktop' && !installEvt)) return null;
    var card = h('div', { class: 'card install' }, [
      h('div', { class: 'rtop' }, [h('b', null, ['📲 ホーム画面に追加しよう']), h('span', { class: 'grow' }),
        h('button', { class: 'back', 'aria-label': 'この案内を閉じる', onclick: function () { load().pwaHint = 1; save(); card.remove(); } }, ['✕'])]),
      h('p', null, ['アプリのように全画面で開けて、電波がなくても問題を解けます(AIに質問はネットが必要)。'])
    ].concat(installHow(), [h('p', { class: 'how' }, [RECORD_NOTE])]));
    return card;
  }
  // 画面の上に重ねる箱(閉じるボタンつき)
  function panel(title, kids) {
    var ov = h('div', { class: 'overlay', onclick: function (e) { if (e.target === ov) ov.remove(); } }, [
      h('div', { class: 'dialog panel', role: 'dialog', 'aria-label': title }, [
        h('div', { class: 'rtop' }, [h('b', null, [title]), h('span', { class: 'grow' }),
          h('button', { class: 'back', 'aria-label': '閉じる', onclick: function () { ov.remove(); } }, ['✕'])])
      ].concat(kids))
    ]);
    document.body.appendChild(ov);
    return ov;
  }
  function installDialog() {
    panel('📲 ホーム画面に追加', [h('p', null, ['アプリのように全画面で開けて、電波がなくても問題を解けます。'])]
      .concat(installHow(), [h('p', { class: 'how' }, [RECORD_NOTE])]));
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvt = e;
    if (screen === 'home') home(window.scrollY);
  });

  /* ---------- 記録の引き継ぎ(ブラウザ ⇄ ホーム画面のアプリ・ほかの端末へ。コードをコピーして貼り付ける) ---------- */
  var CODE_HEAD = 'FP3REC1:';
  function exportCode() {
    var s = load();
    var json = JSON.stringify({ q: s.q, star: s.star || {} });
    return CODE_HEAD + btoa(unescape(encodeURIComponent(json)));
  }
  // 読み込んだ記録を今の記録に足す(同じ問題は、解いた回数の多いほう)。読み込めなければ -1、それ以外は更新した問題数
  function importCode(text) {
    var m = String(text || '').replace(/\s+/g, ''), at = m.indexOf(CODE_HEAD), d = null;
    if (at < 0) return -1;
    try { d = JSON.parse(decodeURIComponent(escape(atob(m.slice(at + CODE_HEAD.length))))); } catch (e) { return -1; }
    if (!d || typeof d.q !== 'object' || !d.q) return -1;
    var s = load(), n = 0;
    Object.keys(d.q).forEach(function (id) {
      var a = d.q[id], b = s.q[id];
      if (!QS[id] || !a || typeof a.r !== 'number' || typeof a.w !== 'number') return;
      if (!b || a.r + a.w > b.r + b.w) { s.q[id] = { r: a.r, w: a.w, last: typeof a.last === 'boolean' ? a.last : null }; n++; }
    });
    s.star = s.star || {};
    Object.keys(d.star || {}).forEach(function (id) { if (QS[id] && !s.star[id]) { s.star[id] = 1; n++; } });
    save();
    return n;
  }
  function transferDialog() {
    var input = h('textarea', { class: 'code', rows: '3', placeholder: 'ここにコードを貼り付け' });
    var msg = h('p', { class: 'how' });
    var solved = Object.keys(load().q).length;
    var ov = panel('🔁 記録の引き継ぎ', [
      h('p', { class: 'how' }, ['ブラウザとホーム画面のアプリ(Chrome と Safari も)は、記録の保存場所が別です。元のほうで「コピー」→ 移したいほうでこの画面を開いて貼り付け →「読み込む」。']),
      h('h3', null, ['① この記録をコピー(解いた問題 ' + solved + '問)']),
      copyButton('記録のコードをコピー', exportCode),
      h('h3', null, ['② コピーしたコードを読み込む']),
      input,
      h('button', { class: 'btn main', onclick: function () {
        var n = importCode(input.value);
        if (n < 0) { msg.textContent = '読み込めませんでした。コピーしたコードを、そのまま全部貼り付けてください。'; return; }
        ov.remove();
        home(window.scrollY);
        panel('🔁 記録の引き継ぎ', [h('p', null, [n ? '読み込みました(' + n + '件を更新)。' : 'この端末の記録のほうが新しいので、変わったところはありませんでした。'])]);
      } }, ['読み込む']),
      msg
    ]);
  }

  // 電波がなくても開けるように、アプリのファイルを端末に保存しておく(sw.js)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 保存できなくてもふつうに動く */ });
  }

  /* ---------- 起動 ---------- */
  applyFont();
  var st0 = null;
  try { st0 = history.state; } catch (e) { histOK = false; }
  if (st0 && st0.sheet) {   // AI に質問を開いたまま読み込み直された:パネルの分の履歴は、その下の画面として使う
    var s1 = {};
    Object.keys(st0).forEach(function (k) { if (k !== 'sheet') s1[k] = st0[k]; });
    nav(s1, true);
    st0 = s1;
  }
  if (!st0) nav({ v: 'home', d: 0 }, true);
  render(st0);
})();
