/**
 * FP3級 合格ドリルの「AIに質問」を AI に中継する。
 *   PROVIDER = "workers-ai"(ふだん):Cloudflare Workers AI の無料枠(1 日 10,000 Neurons)で答える。キー不要・料金なし
 *     (Workers Free プランなら、使い切ってもその日は止まるだけで請求はない。日本時間の朝 9 時に戻る)
 *   PROVIDER = "anthropic":Claude API で答える(ANTHROPIC_API_KEY が必要・料金は運営側)
 *   POST /chat
 *   { problem: { field, question, choices[], correct, picked, explanation, caseText? },
 *     messages: [{ role: 'user' | 'assistant', content: string }, ...](最後は user) }
 * 返事は 1 行 1 件の JSON(NDJSON)で少しずつ返す:
 *   {"t":"text","v":"…"} … 本文の続き / {"t":"done","stop":"end_turn"} … 終わり / {"t":"error","code":"…"} … 失敗
 * いたずら対策:呼べるページを ALLOWED_ORIGINS に限り、同じ IP からの回数・文字数・往復の回数に上限をかける。
 * Claude を使うときの使いすぎの最後の歯止めは、Anthropic Console の利用上限(docs/ai-chat.md)。
 */
import Anthropic from '@anthropic-ai/sdk';

interface Env {
  AI?: Ai;
  PROVIDER?: string;
  WORKERS_AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

type Turn = { role: 'user' | 'assistant'; content: string };
type Problem = {
  field: string; question: string; choices: string[]; correct: string;
  picked: string | null; explanation: string; caseText?: string;
};

const MAX_TURNS = 12;          // 6 往復まで(それ以上は古いものから捨てる前提で、アプリ側でも切る)
const MAX_USER_CHARS = 500;    // 質問 1 回の長さ
const MAX_ASSISTANT_CHARS = 3000;
const MAX_PROBLEM_CHARS = 8000;
const MAX_TOKENS = 4000;       // Claude:考える分 + 答えの分。公開の API なので上限を小さめに
const MAX_TOKENS_FREE = 1500;  // Workers AI:答えの分だけ(考える過程は出させない)

const SYSTEM = `あなたは、FP3級(3級ファイナンシャル・プランニング技能検定)の受検者を手伝う、やさしい家庭教師です。学習者は練習問題を解いて解説を読んだあと、まだ分からないところを質問しています。

・専門用語はかみくだき、具体的な数字や身近な例を使って説明してください。答えは短めに(目安300〜500字)。必要なら最後に、覚え方のコツを一言添えてください。
・画面は Markdown を表示できません。見出し・太字(**)・表は使わず、プレーンテキストで書いてください。箇条書きは「・」を使ってください。
・試験は2026年6月〜2027年5月の実施分(法令基準日 2026年4月1日)を想定しています。改正があった数値・改正が予定されている数値に触れるときはそのことを一言添え、確信が持てない数値は断定せず、公式テキストや国税庁・日本年金機構などの公式情報で確かめるよう伝えてください。
・金額・率・年数などの数値は、問題文とアプリの解説にあるものを優先して使ってください。そこにない数値を使うときは、確かなものだけにしてください。
・アプリの解説が誤っていると思ったときは、どこがどう違うのかを率直に伝えてください。
・FPの学習と関係のない話題には短く断って、学習の話に戻してください。特定の銘柄や商品を勧めるなど個別の投資判断はせず、一般的な考え方の説明にとどめてください。`;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
}

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

function readProblem(v: unknown): Problem | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const choices = Array.isArray(p.choices) ? p.choices.slice(0, 4).map((c) => str(c, 300)) : [];
  const problem: Problem = {
    field: str(p.field, 50), question: str(p.question, 1000), choices,
    correct: str(p.correct, 300), picked: typeof p.picked === 'string' ? str(p.picked, 300) : null,
    explanation: str(p.explanation, 3000), caseText: str(p.caseText, 2000) || undefined,
  };
  if (!problem.question || !problem.correct) return null;
  if (JSON.stringify(problem).length > MAX_PROBLEM_CHARS) return null;
  return problem;
}

// 先頭は user、交互、最後は user。長すぎるものは受けない
function readTurns(v: unknown): Turn[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_TURNS) return null;
  const turns: Turn[] = [];
  for (let i = 0; i < v.length; i++) {
    const t = v[i] as Record<string, unknown>;
    const role = i % 2 === 0 ? 'user' : 'assistant';
    if (!t || t.role !== role || typeof t.content !== 'string') return null;
    const content = t.content.trim();
    if (!content || content.length > (role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS)) return null;
    turns.push({ role, content });
  }
  return turns[turns.length - 1].role === 'user' ? turns : null;
}

function problemText(p: Problem): string {
  const lines = ['【学習者が今見ている問題】', `分野:${p.field}`];
  if (p.caseText) lines.push(`事例:\n${p.caseText}`);
  lines.push(`問題:${p.question}`);
  if (p.choices.length) lines.push('選択肢:\n' + p.choices.map((c, i) => `${i + 1}. ${c}`).join('\n'));
  lines.push(`正解:${p.correct}`);
  lines.push(`学習者の答え:${p.picked == null ? '(答え合わせ前・未回答)' : p.picked}${p.picked === p.correct ? '(正解)' : p.picked == null ? '' : '(不正解)'}`);
  lines.push(`アプリの解説:\n${p.explanation}`);
  return lines.join('\n');
}

function claudeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return 'busy';
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'config';
  if (err instanceof Anthropic.BadRequestError) return 'bad_request';
  if (err instanceof Anthropic.APIConnectionError) return 'network';
  if (err instanceof Anthropic.APIError) return (err.status ?? 500) >= 500 ? 'busy' : 'failed';
  return 'failed';
}

// Workers AI のエラーは、メッセージの先頭の番号で見分ける(3036 = その日の無料枠を使い切った、5035 = 有料プラン専用のモデル)
function workersAiError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/3036|daily free allocation|neurons/i.test(m)) return 'daily_limit';
  if (/5035|Workers Paid/i.test(m)) return 'config';
  if (/3040|capacity|429|Too many/i.test(m)) return 'busy';
  return 'failed';
}

class ProviderError extends Error {
  /** sample … 答えが読み取れなかったときの、届いたデータの先頭(形の確認用。モデルの出力だけで秘密は含まない) */
  constructor(public code: string, cause: unknown, public sample?: string) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Claude(有料)の答えを少しずつ返す。終わり方(stop_reason)を最後に返す */
async function* fromClaude(env: Env, system: string[], turns: Turn[], signal: AbortSignal): AsyncGenerator<string, string | null> {
  const model = env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  // 安全のための判定で断られたとき、Anthropic が勧める別のモデルで答え直す(Haiku には無い)
  const fallback = /haiku/.test(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
  const stream = client.beta.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'low' },   // 学習の質問は軽めの考えで十分。速く・安く
    system: system.map((text) => ({ type: 'text' as const, text })),
    messages: turns,
    ...fallback,
  });
  signal.addEventListener('abort', () => stream.abort());
  try {
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text;
    }
    const msg = await stream.finalMessage();
    console.log(JSON.stringify({ model: msg.model, stop: msg.stop_reason, in: msg.usage.input_tokens, out: msg.usage.output_tokens }));
    return msg.stop_reason;
  } catch (err) {
    stream.abort();
    throw new ProviderError(claudeError(err), err);
  }
}

/**
 * Workers AI(無料枠)の答えを少しずつ返す。
 * 流れてくる形はモデルによって 2 通りあるので両方読む:{"response":"…"} と {"choices":[{"delta":{"content":"…"}}]}。
 * 考える過程(reasoning_content・<think>…</think>)は画面に出さない。
 */
async function* fromWorkersAi(env: Env, system: string[], turns: Turn[], signal: AbortSignal): AsyncGenerator<string, string | null> {
  if (!env.AI) throw new ProviderError('config', 'AI binding がない(wrangler.toml の [ai])');
  const model = (env.WORKERS_AI_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8') as '@cf/qwen/qwen3-30b-a3b-fp8';
  // Qwen3 は「/no_think」で考える過程を省く(速く・無料枠の消費も少ない)
  const messages = [
    { role: 'system', content: system.join('\n\n') },
    ...turns.map((t, i) => (i === turns.length - 1 ? { role: t.role, content: t.content + ' /no_think' } : t)),
  ];
  let stream: ReadableStream;
  try {
    stream = await env.AI.run(model, { messages, stream: true, max_tokens: MAX_TOKENS_FREE });
  } catch (err) {
    throw new ProviderError(workersAiError(err), err);
  }
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  signal.addEventListener('abort', () => reader.cancel().catch(() => {}));
  let buf = '';
  let stop: string | null = null;
  let sample = '';
  let got = false;
  const think = { inside: false, pending: '' };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      if (sample.length < 600) sample += value.slice(0, 600 - sample.length);
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        let ev: Record<string, any>;
        try { ev = JSON.parse(data); } catch { continue; }
        const choice = Array.isArray(ev.choices) ? ev.choices[0] : null;
        const piece: unknown = typeof ev.response === 'string' ? ev.response : choice?.delta?.content ?? choice?.text;
        if (choice?.finish_reason) stop = choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
        if (typeof piece === 'string' && piece) {
          const text = dropThinking(think, piece);
          if (text) { got = true; yield text; }
        }
      }
    }
  } catch (err) {
    throw new ProviderError(workersAiError(err), err);
  }
  const rest = think.inside ? '' : think.pending;
  if (rest) { got = true; yield rest; }
  if (!got) throw new ProviderError('empty', '答えが読み取れなかった', sample);
  return stop ?? 'end_turn';
}

/** <think>…</think> を取り除く(タグが分かれて届いても大丈夫なように、タグになりそうな末尾は次まで持ち越す) */
function dropThinking(st: { inside: boolean; pending: string }, piece: string): string {
  let s = st.pending + piece;
  let out = '';
  st.pending = '';
  for (;;) {
    if (st.inside) {
      const end = s.indexOf('</think>');
      if (end < 0) { st.pending = s.slice(-8); return out; }
      s = s.slice(end + 8).replace(/^\s+/, '');
      st.inside = false;
    } else {
      const start = s.indexOf('<think>');
      if (start >= 0) { out += s.slice(0, start); s = s.slice(start + 7); st.inside = true; continue; }
      const cut = s.lastIndexOf('<');
      if (cut >= 0 && s.length - cut < 7 && '<think>'.startsWith(s.slice(cut))) { st.pending = s.slice(cut); return out + s.slice(0, cut); }
      return out + s;
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req.headers.get('Origin'), env);
    const url = new URL(req.url);
    if (url.pathname !== '/chat') return json(404, { ok: false }, headers);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json(405, { ok: false }, headers);
    if (!headers['Access-Control-Allow-Origin']) return json(403, { ok: false, error: 'origin' }, headers);
    const useClaude = env.PROVIDER === 'anthropic';
    if (useClaude ? !env.ANTHROPIC_API_KEY : !env.AI) return json(500, { ok: false, error: 'config' }, headers);

    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return json(429, { ok: false, error: 'too_many' }, headers);

    const raw = await req.text();
    if (raw.length > 30_000) return json(413, { ok: false }, headers);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json(400, { ok: false }, headers); }
    const problem = readProblem(body.problem);
    const turns = readTurns(body.messages);
    if (!problem || !turns) return json(400, { ok: false, error: 'bad_request' }, headers);

    const system = [SYSTEM, problemText(problem)];
    const ctrl = new AbortController();
    const answer = useClaude ? fromClaude(env, system, turns, ctrl.signal) : fromWorkersAi(env, system, turns, ctrl.signal);

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = (o: unknown) => writer.write(enc.encode(JSON.stringify(o) + '\n'));

    (async () => {
      try {
        let r = await answer.next();
        while (!r.done) {
          await send({ t: 'text', v: r.value });
          r = await answer.next();
        }
        await send({ t: 'done', stop: r.value });
      } catch (err) {
        // 読み手(ブラウザ)が閉じたときもここに来る。続きを作らせない
        ctrl.abort();
        const code = err instanceof ProviderError ? err.code : 'failed';
        console.log('chat error', code, err instanceof Error ? err.message : String(err));
        const sample = err instanceof ProviderError ? err.sample : undefined;
        await send({ t: 'error', code, sample }).catch(() => {});
      } finally {
        await writer.close().catch(() => {});
      }
    })();

    return new Response(readable, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    });
  },
};
