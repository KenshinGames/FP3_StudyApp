# 「AIに質問」の公開手順

解説ページ(と模擬試験の結果画面)の「💬 AIに質問する」で、その問題について Claude に質問できます。

## しくみ

```
ブラウザ(GitHub Pages)── POST /chat ──▶ Cloudflare Worker(worker/)── API キー ──▶ Claude API
                       ◀── 少しずつ返す ──                         ◀── ストリーミング ──
```

- API キーはブラウザに置けない(誰でも見られる)ので、間に Worker を置いて、キーは Worker の「秘密の値」にします。
- Worker は、問題文・選択肢・正解・解説・会話を Claude に渡し、答えを少しずつ返します。
- `config.js` の `CHAT_URL` が空のあいだは、送信すると claude.ai が新しいタブで開き、問題と質問が入力された状態になります。この場合、質問する人に Claude のアカウントが必要です。

## 公開の手順(はじめの 1 回)

1. **API キーを作る**:Claude Console(https://platform.claude.com/)にログインし、クレジットを購入して API キーを作ります。
   **必ず、月の利用上限(Spend limit)を設定してください。** 誰でも使える公開ページなので、使いすぎの最後の歯止めになります。
2. **Worker を公開する**(Cloudflare のアカウントが必要。無料枠で動きます):
   ```bash
   cd worker
   npm install
   npx wrangler login                        # はじめてのときだけ
   npx wrangler secret put ANTHROPIC_API_KEY # 1. のキーを貼り付ける
   npm run deploy
   ```
   最後に `https://fp3-chat.<サブドメイン>.workers.dev` のような URL が表示されます。
3. **アプリに URL を入れる**:`config.js` の `CHAT_URL` に、上の URL の後ろに `/chat` を付けたものを入れて、push します。
   ```js
   window.FP3_CONFIG = { CHAT_URL: 'https://fp3-chat.xxxx.workers.dev/chat' };
   ```

## 設定(worker/wrangler.toml)

| 項目 | 内容 |
|---|---|
| `MODEL` | 使うモデル。はじめは `claude-opus-5-5`。安くしたいときは `claude-haiku-5-5` |
| `ALLOWED_ORIGINS` | 呼び出してよいページ。公開ページと、ローカル確認用の `http://localhost:8000` |
| `[[ratelimits]]` | 同じ IP から 1 分に 8 回まで |

ほかにも、Worker の中で次の上限をかけています:質問 1 回 500 字、会話は 6 往復まで、答えは 4,000 トークンまで。

## 料金の目安(1 回の質問)

入力 約 2,000 トークン(指示・問題・解説・会話)+ 出力 約 600 トークンとして計算しています。

| モデル | 料金(100 万トークンあたり、入力 / 出力) | 1 回の質問 |
|---|---|---|
| Claude Opus 5.5 | $4 / $20 | 約 $0.02(約 3 円) |
| Claude Haiku 5.5 | $0.10 / $0.50 | 約 $0.0005(約 0.1 円) |

Cloudflare Workers の無料枠は、1 日 10 万リクエストです。

## 確認

- 使われ方は `cd worker && npx wrangler tail` で見られます(1 回ごとにモデル・終わり方・トークン数が出ます)。
- ローカルで試すとき:`worker/.dev.vars` に `ANTHROPIC_API_KEY=...` を書いて `npm run dev`(http://127.0.0.1:8787)。
  リポジトリ直下で `python3 -m http.server 8000` を動かし、`config.js` の `CHAT_URL` を `http://127.0.0.1:8787/chat` にします。
