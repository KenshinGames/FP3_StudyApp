/**
 * FP3級 合格ドリルの「AIに質問」を Claude に中継する。
 *   POST /chat
 *   { problem: { field, question, choices[], correct, picked, explanation, caseText? },
 *     messages: [{ role: 'user' | 'assistant', content: string }, ...](最後は user) }
 * 返事は 1 行 1 件の JSON(NDJSON)で少しずつ返す:
 *   {"t":"text","v":"…"} … 本文の続き / {"t":"done","stop":"end_turn"} … 終わり / {"t":"error","code":"…"} … 失敗
 * API キーはブラウザに渡さない(この Worker の秘密の値 ANTHROPIC_API_KEY)。
 * いたずら対策:呼べるページを ALLOWED_ORIGINS に限り、同じ IP からの回数・文字数・往復の回数に上限をかける。
 * 使いすぎの最後の歯止めは、Anthropic Console の利用上限(docs/ai-chat.md)。
 */
import Anthropic from '@anthropic-ai/sdk';

interface Env {
  ANTHROPIC_API_KEY: string;
  MODEL?: string;
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
const MAX_TOKENS = 4000;       // 考える分 + 答えの分。公開の API なので上限を小さめに

const SYSTEM = `あなたは、FP3級(3級ファイナンシャル・プランニング技能検定)の受検者を手伝う、やさしい家庭教師です。学習者は練習問題を解いて解説を読んだあと、まだ分からないところを質問しています。

・専門用語はかみくだき、具体的な数字や身近な例を使って説明してください。答えは短めに(目安300〜500字)。必要なら最後に、覚え方のコツを一言添えてください。
・画面は Markdown を表示できません。見出し・太字(**)・表は使わず、プレーンテキストで書いてください。箇条書きは「・」を使ってください。
・試験は2026年6月〜2027年5月の実施分(法令基準日 2026年4月1日)を想定しています。改正があった数値・改正が予定されている数値に触れるときはそのことを一言添え、確信が持てない数値は断定せず、公式テキストや国税庁・日本年金機構などの公式情報で確かめるよう伝えてください。
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

function errorCode(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return 'busy';
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'config';
  if (err instanceof Anthropic.BadRequestError) return 'bad_request';
  if (err instanceof Anthropic.APIConnectionError) return 'network';
  if (err instanceof Anthropic.APIError) return (err.status ?? 500) >= 500 ? 'busy' : 'failed';
  return 'failed';
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req.headers.get('Origin'), env);
    const url = new URL(req.url);
    if (url.pathname !== '/chat') return json(404, { ok: false }, headers);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json(405, { ok: false }, headers);
    if (!headers['Access-Control-Allow-Origin']) return json(403, { ok: false, error: 'origin' }, headers);
    if (!env.ANTHROPIC_API_KEY) return json(500, { ok: false, error: 'config' }, headers);

    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return json(429, { ok: false, error: 'too_many' }, headers);

    const raw = await req.text();
    if (raw.length > 30_000) return json(413, { ok: false }, headers);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json(400, { ok: false }, headers); }
    const problem = readProblem(body.problem);
    const turns = readTurns(body.messages);
    if (!problem || !turns) return json(400, { ok: false, error: 'bad_request' }, headers);

    const model = env.MODEL || 'claude-opus-5-5';
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    // 安全のための判定で断られたとき、Anthropic が勧める別のモデルで答え直す(Haiku には無い)
    const fallback = /haiku/.test(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
    const stream = client.beta.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'low' },   // 学習の質問は軽めの考えで十分。速く・安く
      system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: problemText(problem) }],
      messages: turns,
      ...fallback,
    });

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = (o: unknown) => writer.write(enc.encode(JSON.stringify(o) + '\n'));

    (async () => {
      try {
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') await send({ t: 'text', v: ev.delta.text });
        }
        const msg = await stream.finalMessage();
        console.log(JSON.stringify({ model: msg.model, stop: msg.stop_reason, in: msg.usage.input_tokens, out: msg.usage.output_tokens }));
        await send({ t: 'done', stop: msg.stop_reason });
      } catch (err) {
        // 読み手(ブラウザ)が閉じたときもここに来る。続きを作らせない(料金がかからないように)
        stream.abort();
        console.log('chat error', err instanceof Error ? err.message : String(err));
        await send({ t: 'error', code: errorCode(err) }).catch(() => {});
      } finally {
        await writer.close().catch(() => {});
      }
    })();

    return new Response(readable, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    });
  },
};
