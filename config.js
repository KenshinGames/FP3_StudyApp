/* FP3級 合格ドリルの設定
 * CHAT_URL … 「AIに質問」の送り先(worker/ の Cloudflare Worker を公開した URL + /chat)。
 *   例:'https://fp3-chat.xxxx.workers.dev/chat'
 *   空のときは、送信すると Claude(claude.ai)が新しいタブで開き、問題と質問が入力された状態になる。
 *   手順は docs/ai-chat.md
 */
window.FP3_CONFIG = {
  CHAT_URL: ''
};
