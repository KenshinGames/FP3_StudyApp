/* FP3級 合格ドリル — 画面とロジック(ビルド不要。index.html を開くだけで動く) */
(function () {
  'use strict';

  var QS = window.QUESTIONS;
  var FIELDS = window.FIELDS;
  var STORE_KEY = 'fp3study.v1';
  var MOCK_PER_FIELD = 5;   // 模擬試験:各分野から出す問題数(合計 30 問)
  var PASS_RATE = 0.6;      // 学科試験の合格基準は 60%(36 / 60 問)

  var root = document.getElementById('app');
  var fieldById = {};
  FIELDS.forEach(function (f) { fieldById[f.id] = f; });
  QS.forEach(function (q, i) { q.id = i; });
  var PLAIN = QS.filter(function (q) { return !q.jitsu; });   // 学科の問題(実技の事例は別枠)
  var CASES = window.CASES || [];
  function caseQs(cid) { return QS.filter(function (q) { return q.jitsu && q.cid === cid; }); }

  /* ---------- 保存(ブラウザの localStorage。使えないときもエラーにしない) ---------- */
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
    if (correct) r.r++; else r.w++;
    r.last = correct;
    s.q[q.id] = r;
    save();
  }
  function recOf(q) { return load().q[q.id] || null; }
  function wrongList() { return QS.filter(function (q) { var r = recOf(q); return r && r.last === false; }); }

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
  function mount(node) { root.replaceChildren(node); window.scrollTo(0, 0); }
  function bar(p) { return h('div', { class: 'bar' }, [h('i', { style: 'width:' + p + '%' })]); }

  /* ---------- 効果音 ---------- */
  var actx = null;
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
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
      if (ok) { // ピンポン
        tone(880, 0, 0.35, 'sine', 0.22); tone(1320, 0.14, 0.5, 'sine', 0.22);
      } else {  // ぴょこん ↘ ふにゃ〜(やわらかい高めの音が、ぴょんと跳ねてしょぼんと下がる)
        tone(740, 0, 0.09, 'triangle', 0.2, 880);          // ぴょ
        wobble(587, 0.1, 0.18, 0.24, 523);                  // しょ
        wobble(466, 0.3, 0.55, 0.24, 311);                  // ぼ〜ん(ゆらゆら下がる)
        tone(1568, 0.1, 0.06, 'sine', 0.05, 1760);          // きらっと小さな高音(かわいさの味付け)
      }
    } catch (e) { /* 音が出なくても続ける */ }
  }
  // 画面いっぱいに ⭕ / ❌ をぱっと出す
  function flashMark(ok) {
    var el = h('div', { class: 'flash ' + (ok ? 'ok' : 'ng'), 'aria-hidden': 'true' }, [h('span', null, [ok ? '⭕' : '❌'])]);
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 800);
  }

  /* ---------- 出題セッション ---------- */
  var run = null;
  var keyHandler = null;
  function setKeys(fn) {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = fn;
    if (fn) document.addEventListener('keydown', fn);
  }

  // 選択肢を並べて、1 問分の表示データにする(○× は並び固定)
  function prepare(q) {
    if (q.tf) return { q: q, labels: ['○(正しい)', '×(誤り)'], correct: q.a ? 0 : 1 };
    var order = shuffle([0, 1, 2, 3]);
    return { q: q, labels: order.map(function (i) { return q.c[i]; }), correct: order.indexOf(0) };
  }

  // 実技の事例文(問題・解説の上に表示)
  function ctxBox(q) {
    if (!q.jitsu) return null;
    return h('div', { class: 'ctx' }, [h('div', { class: 'ctitle' }, ['📋 事例:' + q.ctitle]), h('div', { class: 'ctext' }, [q.ctx])]);
  }

  function startRun(opts) {
    var qs = opts.questions;
    if (!qs.length) return;
    run = {
      title: opts.title,
      mock: !!opts.mock,
      items: qs.map(prepare),
      i: 0,
      picks: []
    };
    showQuestion();
  }

  // 問題の画面:答えを選ぶと、そのたびに解説ページ(showExplanation)へ進む
  function showQuestion() {
    var it = run.items[run.i];
    var q = it.q;

    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(header());
    wrap.appendChild(bar(pct(run.i, run.items.length)));

    var card = h('div', { class: 'card' });
    card.appendChild(h('div', null, [
      h('span', { class: 'tag' }, [fieldById[q.f].name]),
      h('span', { class: 'tag tf' }, [q.jitsu ? '実技' : q.tf ? '○×' : '4択'])
    ]));
    if (q.jitsu) card.appendChild(ctxBox(q));
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
    if (chosen) {
      wrap.appendChild(h('div', { class: 'actions' }, [
        h('button', { class: 'btn main', onclick: next }, [run.i === run.items.length - 1 ? '答え合わせへ' : '次の問題へ'])
      ]));
      wrap.appendChild(h('div', { class: 'hint' }, ['選び直せます。Enter キーでも進めます']));
    } else {
      wrap.appendChild(h('div', { class: 'hint' }, [(run.mock ? '答え合わせは最後にまとめて。' : '') + (q.tf ? '1(○)・2(×)キーでも答えられます' : '1〜4 キーでも答えられます')]));
    }
    mount(wrap);

    setKeys(function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (chosen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); return; }
      if (/^[1-4]$/.test(e.key) && +e.key <= it.labels.length) choose(+e.key - 1);
    });
  }

  // 解説ページ:正解・不正解の判定と、やさしい解説
  function showExplanation() {
    var it = run.items[run.i];
    var q = it.q;
    var picked = run.picks[run.i];
    var ok = picked === it.correct;
    var last = run.i === run.items.length - 1;

    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(header());
    wrap.appendChild(bar(pct(run.i + 1, run.items.length)));

    var vd = h('div', { class: 'verdict big ' + (ok ? 'ok' : 'ng') }, [ok ? '⭕ 正解!' : '❌ 不正解']);
    if (!ok) vd.appendChild(h('small', null, ['正しい答えは「' + it.labels[it.correct] + '」です']));
    wrap.appendChild(vd);

    var card = h('div', { class: 'card' });
    card.appendChild(h('span', { class: 'tag' }, [fieldById[q.f].name]));
    if (q.jitsu) card.appendChild(ctxBox(q));
    card.appendChild(h('div', { class: 'qtext' }, [q.q]));
    var list = h('div', { class: 'choices' + (q.tf ? ' tfgrid' : '') });
    it.labels.forEach(function (label, i) {
      var cls = 'choice' + (i === it.correct ? ' ok' : i === picked ? ' ng' : '');
      var mark = i === it.correct ? '  ← 正解' : (i === picked ? '  ← あなたの答え' : '');
      var inner = q.tf
        ? [h('span', { class: 't' }, [label + mark])]
        : [h('span', { class: 'n' }, [String(i + 1)]), h('span', { class: 't' }, [label + mark])];
      list.appendChild(h('button', { class: cls, disabled: true }, inner));
    });
    card.appendChild(list);
    wrap.appendChild(card);

    wrap.appendChild(h('div', { class: 'card exp' }, [h('h3', null, ['解説']), h('p', null, [q.e])]));
    // 画面下に固定(解説が長くてスクロールしても動かない)
    wrap.classList.add('has-dock');
    wrap.appendChild(h('div', { class: 'dock' }, [
      h('button', { class: 'btn main', onclick: next }, [last ? '結果を見る' : '次の問題へ']),
      h('div', { class: 'hint' }, ['Enter / スペースキーでも進めます'])
    ]));
    mount(wrap);

    setKeys(function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
    });
  }

  function header() {
    return h('div', { class: 'qhead' }, [
      h('button', { class: 'back', onclick: quit }, ['← やめる']),
      h('div', { class: 'grow' }),
      h('div', { class: 'qcount' }, [(run.i + 1) + ' / ' + run.items.length])
    ]);
  }

  function choose(i) {
    var it = run.items[run.i];
    run.picks[run.i] = i;
    if (run.mock) { showQuestion(); return; }   // 模擬試験は最後にまとめて答え合わせ
    var ok = i === it.correct;
    record(it.q, ok);
    playSfx(ok);
    showExplanation();
    flashMark(ok);
  }

  function next() {
    if (run.i >= run.items.length - 1) { finish(); return; }
    run.i++;
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

  function quit() {
    if (!run.picks.length) { home(); return; }
    ask('途中でやめますか?(ここまでの答えは記録されています)', 'やめる', home);
  }

  /* ---------- 結果 ---------- */
  function finish() {
    setKeys(null);
    var items = run.items;
    if (run.mock) items.forEach(function (it, i) { record(it.q, run.picks[i] === it.correct); });
    var right = items.filter(function (it, i) { return run.picks[i] === it.correct; }).length;
    var total = items.length;
    var rate = right / total;

    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(h('div', { class: 'card score' }, [
      h('div', { class: 'sec', style: 'margin:0 0 6px' }, [run.title]),
      h('div', { class: 'big' }, [String(right), h('small', null, [' / ' + total + '問'])]),
      h('div', null, ['正答率 ' + pct(right, total) + '%']),
      h('div', { class: 'judge ' + (rate >= PASS_RATE ? 'pass' : 'fail') },
        [rate >= PASS_RATE ? '合格ライン(60%)クリア!' : 'あと ' + (Math.ceil(total * PASS_RATE) - right) + '問で合格ライン(60%)'])
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
          h('span', { class: 'tag' }, [fieldById[q.f].short]),
          q.jitsu ? h('details', { class: 'rv' }, [h('summary', null, ['事例を見る']), ctxBox(q)]) : null,
          h('div', { class: 'qtext' }, [q.q]),
          h('div', { class: 'ans' }, [h('span', { class: 'mine' }, ['あなたの答え:' + mine])]),
          h('div', { class: 'ans' }, [h('span', { class: 'right' }, ['正解:' + x.it.labels[x.it.correct]])]),
          h('details', { class: 'rv' }, [h('summary', null, ['解説を見る']),
            h('div', { class: 'exp' }, [h('p', null, [q.e])])])
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
            h('span', { class: 'tag' }, [fieldById[x.it.q.f].short]),
            h('div', { class: 'qtext' }, [x.it.q.q]),
            h('div', { class: 'ans' }, [h('span', { class: 'right' }, ['⭕ ' + x.it.labels[x.it.correct]])]),
            h('details', { class: 'rv' }, [h('summary', null, ['解説を見る']), h('div', { class: 'exp' }, [h('p', null, [x.it.q.e])])])
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
        startRun({ title: again.title, mock: again.mock, questions: again.items.map(function (it) { return it.q; }) });
      } }, ['同じ問題をもう一度']),
      h('button', { class: 'btn', onclick: home }, ['ホームにもどる'])
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

  function home() {
    setKeys(null);
    run = null;
    var tried = 0, right = 0, answers = 0, correctAnswers = 0;
    QS.forEach(function (q) {
      var r = recOf(q);
      if (r) { tried++; if (r.last) right++; answers += r.r + r.w; correctAnswers += r.r; }
    });
    var wrongs = wrongList();

    var wrap = h('div');
    wrap.appendChild(h('div', { class: 'hero' }, [
      h('h1', null, ['FP3級 合格ドリル']),
      h('p', null, ['3級FP技能検定(学科)対策。4択・○×の問題を解いて、解説でしっかり理解しよう。'])
    ]));

    wrap.appendChild(h('div', { class: 'sec' }, ['あなたの進み具合']));
    wrap.appendChild(h('div', { class: 'card stack' }, [
      h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [h('b', null, [tried + '/' + QS.length]), h('span', null, ['解いた問題'])]),
        h('div', { class: 'stat' }, [h('b', null, [pct(correctAnswers, answers) + '%']), h('span', null, ['通算の正答率'])]),
        h('div', { class: 'stat' }, [h('b', null, [String(wrongs.length)]), h('span', null, ['復習が必要'])])
      ]),
      bar(pct(tried, QS.length))
    ]));

    wrap.appendChild(h('div', { class: 'sec' }, ['問題を解く']));
    var modes = h('div', { class: 'modes' });
    modes.appendChild(mode('📝', '模擬試験(30問)', '6分野から5問ずつ。判定と解説は最後にまとめて。60%で合格ライン', true, function () {
      var picked = [];
      FIELDS.forEach(function (f) {
        picked = picked.concat(shuffle(PLAIN.filter(function (q) { return q.f === f.id; })).slice(0, MOCK_PER_FIELD));
      });
      startRun({ title: '模擬試験', mock: true, questions: shuffle(picked) });
    }));
    modes.appendChild(mode('🎲', 'ランダム10問', '全分野から。1問ごとに ⭕❌ の判定と解説', false, function () {
      startRun({ title: 'ランダム10問', questions: shuffle(PLAIN).slice(0, 10) });
    }));
    modes.appendChild(mode('🔁', '間違えた問題を復習(' + wrongs.length + '問)',
      wrongs.length ? '前回まちがえた問題だけ。正解すると復習リストから消えます' : 'まちがえた問題がたまるとここで復習できます', false, function () {
        startRun({ title: '間違えた問題の復習', questions: shuffle(wrongs) });
      }, !wrongs.length));
    wrap.appendChild(modes);

    wrap.appendChild(h('div', { class: 'sec' }, ['実技(事例形式)']));
    var jm = h('div', { class: 'modes' });
    jm.appendChild(mode('📋', '実技 ランダム2事例', '事例文を読んで、続けて答える形式。1問ごとに ⭕❌ の判定と解説', false, function () {
      var ids = shuffle(CASES.map(function (c, i) { return i; })).slice(0, 2), qs = [];
      ids.forEach(function (cid) { qs = qs.concat(caseQs(cid)); });
      startRun({ title: '実技 ランダム2事例', questions: qs });
    }));
    wrap.appendChild(jm);
    var cl = h('div', { class: 'cases' });
    CASES.forEach(function (c, cid) {
      var qs = caseQs(cid), right = 0, wrong = 0;
      qs.forEach(function (q) { var r = recOf(q); if (r) { if (r.last) right++; else wrong++; } });
      cl.appendChild(h('button', { class: 'casebtn', onclick: function () { startRun({ title: '実技:' + c.title, questions: qs }); } }, [
        h('span', { class: 'tag' }, [fieldById[c.f].short]),
        h('b', null, [c.title]),
        h('small', null, [right + '/' + c.n + (wrong ? ' ・復習' + wrong : '')])
      ]));
    });
    wrap.appendChild(cl);

    wrap.appendChild(h('div', { class: 'sec' }, ['分野ごとに解く']));
    var fl = h('div', { class: 'modes' });
    FIELDS.forEach(function (f) {
      var s = fieldStat(f.id);
      fl.appendChild(h('button', { class: 'field', onclick: function () { fieldMenu(f.id); } }, [
        h('div', { class: 'top' }, [h('span', { class: 'ic' }, [f.icon]), h('b', null, [f.name]), h('small', null, [s.total + '問'])]),
        h('div', { class: 'desc' }, [f.desc]),
        bar(pct(s.right, s.total)),
        h('div', { class: 'meta' }, [h('span', null, ['正解済み ' + s.right + ' / ' + s.total]), h('span', null, [s.wrong ? '復習 ' + s.wrong + '問' : ''])])
      ]));
    });
    wrap.appendChild(fl);

    wrap.appendChild(h('div', { class: 'note' }, [
      '※ 問題・解説はこのアプリのオリジナルです。2026年6月〜2027年5月の試験(法令基準日:2026年4月1日)を想定して作っています。2026年の税制改正で数値が動いている項目(基礎控除・配偶者控除・給与所得控除など)は、確認が取れるまで出題していません。数値や制度は法改正で変わることがあるため、受検前に必ず試験実施団体(日本FP協会・金融財政事情研究会)の公式情報と最新テキストで確認してください。学科試験は 60 問中 36 問以上(60%)が合格基準です。'
    ]));
    wrap.appendChild(h('div', { style: 'text-align:center' }, [
      h('button', { class: 'linkbtn', onclick: function () { load().mute = !load().mute; save(); if (!load().mute) playSfx(true); home(); } },
        ['効果音:' + (load().mute ? 'OFF(タップでONにする)' : 'ON(タップでOFFにする)')]),
      h('br'),
      h('button', { class: 'linkbtn', onclick: function () {
        ask('学習の記録をすべて消しますか?', '消す', function () { mem = { q: {} }; save(); home(); });
      } }, ['学習の記録を消す'])
    ]));
    mount(wrap);
  }

  function mode(icon, title, sub, primary, fn, disabled) {
    return h('button', { class: 'mode' + (primary ? ' primary' : ''), disabled: !!disabled, onclick: fn }, [
      h('span', { class: 'ic' }, [icon]),
      h('span', { class: 'tx' }, [h('b', null, [title]), h('span', null, [sub])]),
      h('span', { class: 'go' }, ['›'])
    ]);
  }

  // 分野を選んだあと:全問 / 未回答だけ / 苦手だけ
  function fieldMenu(id) {
    var f = fieldById[id];
    var qs = PLAIN.filter(function (q) { return q.f === id; });
    var fresh = qs.filter(function (q) { return !recOf(q); });
    var wrongs = qs.filter(function (q) { var r = recOf(q); return r && r.last === false; });

    var wrap = h('div', { class: 'stack' });
    wrap.appendChild(h('div', { class: 'qhead' }, [h('button', { class: 'back', onclick: home }, ['← ホーム'])]));
    wrap.appendChild(h('div', { class: 'hero', style: 'padding-top:0' }, [h('h1', { style: 'font-size:22px' }, [f.icon + ' ' + f.name]), h('p', null, [f.desc])]));
    var modes = h('div', { class: 'modes' });
    modes.appendChild(mode('▶', '全問(' + qs.length + '問)', 'シャッフルして出題', true, function () {
      startRun({ title: f.name, questions: shuffle(qs) });
    }));
    modes.appendChild(mode('🆕', 'まだ解いていない問題(' + fresh.length + '問)', '', false, function () {
      startRun({ title: f.name + '(未回答)', questions: shuffle(fresh) });
    }, !fresh.length));
    modes.appendChild(mode('🔁', 'まちがえた問題(' + wrongs.length + '問)', '', false, function () {
      startRun({ title: f.name + '(復習)', questions: shuffle(wrongs) });
    }, !wrongs.length));
    wrap.appendChild(modes);
    mount(wrap);
  }

  home();
})();
