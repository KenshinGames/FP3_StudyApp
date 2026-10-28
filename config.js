/* FP3級 合格ドリルの設定
 * CHAT_URL … 「AIに質問」の答えをアプリの中で返すときの送り先(worker/ の Cloudflare Worker の URL + /chat)。
 *   空のとき(ふだん)は、ChatGPT か Claude が新しいタブで開き、問題と質問が入った状態になる(運営側の料金はかからない)。
 *   Worker を使うと Claude API の料金がかかる。手順は docs/ai-chat.md
 */
window.FP3_CONFIG = {
  CHAT_URL: ''
};
