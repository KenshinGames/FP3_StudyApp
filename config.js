/* FP3級 合格ドリルの設定
 * CHAT_URL … 「AIに質問」の送り先(worker/ の Cloudflare Worker を公開した URL + /chat)。
 *   Worker は Cloudflare Workers AI の無料枠で答える(料金なし)。手順は docs/ai-chat.md
 *   空のときは、ChatGPT か Claude が新しいタブで開き、問題と質問が入った状態になる。
 */
window.FP3_CONFIG = {
  CHAT_URL: ''
};
