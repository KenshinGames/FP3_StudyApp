# 「AIに質問」のしくみと公開手順

解説ページ(と模擬試験の結果画面)の「💬 AIに質問する」で、その問題についてAIに質問し、**この画面の中で**答えを受け取れます。

## しくみ(料金なし)

```
ブラウザ(GitHub Pages)── POST /chat ──▶ Cloudflare Worker(worker/)──▶ Workers AI(無料枠)
                       ◀── 少しずつ返す ──                          ◀── ストリーミング ──
```

- 答えるのは Cloudflare の **Workers AI**(モデル:Qwen3 30B。日本語が得意)。API キーは不要です。
- 無料枠は **1 日 10,000 Neurons**(アカウント全体・全モデルで共通)。日本時間の朝 9 時(UTC 0 時)に戻ります。
  1 回の質問はおよそ 30 Neurons なので、**1 日 300 回くらい**が目安です(答えの長さで変わります)。
- **Workers Free プランなら、使い切ってもその日は止まるだけで、請求はありません。**
  止まったときは、アプリが「ChatGPT で聞く / Claude で聞く」ボタン(質問を入れた状態で新しいタブで開く)を出します。
  ※ Workers Paid プラン(月 5 ドル)に入っているアカウントでは、無料枠を超えた分が課金されます。
- `config.js` の `CHAT_URL` が空のあいだは、はじめから ChatGPT / Claude のボタンだけが出ます。

## 公開の手順(はじめの 1 回)

```bash
cd worker
npm install
npx wrangler login     # はじめてのときだけ(rugby-7v7 の Worker と同じ Cloudflare アカウント)
npm run deploy
```

最後に `https://fp3-chat.<サブドメイン>.workers.dev` のような URL が表示されます。
`config.js` の `CHAT_URL` に、その URL の後ろに `/chat` を付けたものを入れて push します。

```js
window.FP3_CONFIG = { CHAT_URL: 'https://fp3-chat.xxxx.workers.dev/chat' };
```

## 設定(worker/wrangler.toml)

| 項目 | 内容 |
|---|---|
| `PROVIDER` | `workers-ai`(無料枠。ふだん)か `anthropic`(Claude。有料) |
| `WORKERS_AI_MODEL` | Workers AI のモデル。はじめは `@cf/qwen/qwen3-30b-a3b-fp8` |
| `ALLOWED_ORIGINS` | 呼び出してよいページ。公開ページと、ローカル確認用の `http://localhost:8000` |
| `[[ratelimits]]` | 同じ IP から 1 分に 8 回まで |

ほかにも、Worker の中で次の上限をかけています:質問 1 回 500 字、会話は 6 往復まで、答えは 1,500 トークンまで。

## もっと賢い AI にしたくなったら(有料:Claude)

Workers AI の無料のモデルは、ChatGPT や Claude より正確さが落ちることがあります。
お金をかけてよくなったら、Claude に切り替えられます。

1. Claude Console(https://platform.claude.com/)でクレジットを買い、API キーを作る。**月の利用上限(Spend limit)を必ず設定する**
2. `cd worker && npx wrangler secret put ANTHROPIC_API_KEY`
3. `wrangler.toml` の `PROVIDER` を `"anthropic"` にして `npm run deploy`

| モデル | 料金(100 万トークンあたり、入力 / 出力) | 1 回の質問(入力 約 2,000 + 出力 約 600 トークン) |
|---|---|---|
| Claude Opus 5.5 | $4 / $20 | 約 $0.02(約 3 円) |
| Claude Haiku 5.5 | $0.10 / $0.50 | 約 $0.0005(約 0.1 円) |

## 確認

- 使われ方は `cd worker && npx wrangler tail` で見られます(エラーの理由も出ます)。
- 無料枠の残りは、Cloudflare のダッシュボードの「Workers AI」で見られます。
