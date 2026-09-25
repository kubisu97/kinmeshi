# 筋メシ

自分専用の筋トレ・食事管理PWA。GitHub Pagesで公開。

公開URL: https://kubisu97.github.io/kinmeshi/

## テスト

ローカルにPlaywrightが入っている状態で:

```bash
node test-instant.cjs      # 写真の即記録と裏での解析・チャットのストリーミング
node test-resilience.cjs   # Gemini通信の粘り強さ（リトライ・モデル切替・thinking非対応の回避）
node test-smoke.cjs        # 主要機能の非退行チェック
```

共通の道具は `test-helpers.cjs`。

どちらも内蔵の静的サーバを立ち上げ、Gemini APIはモックするのでAPIキーは不要。

## 更新のしかた

1. ファイルを編集
2. `sw.js` の `CACHE` と `js/scr-settings.js` のバージョン表記を上げる（これを忘れるとiPhoneに反映されない）
3. 上のテストを流す
4. GitHubに同じファイル名でアップロード

## AI（Gemini）について

- 無料枠は混雑時に503を返すため、`js/gemini.js` で**リトライ＋モデル自動フォールバック**を行う
- 使えるモデルは `GEMINI_FALLBACK_MODELS` に優先順で定義。通ったモデルは設定に自動保存される
- モデルが古くなったら設定画面の「接続テスト」で自動修復できる
- Gemini 3 は `temperature` を下げるとループすることがあるため指定しない
- 速さは `thinkingLevel` で調整（写真・チャット＝速く、メニュー・献立＝少し考える）。非対応モデルでは自動で下げる
- 食事写真は撮った瞬間に記録し、AIは裏で解析して数値を埋める。手で直した項目は上書きしない
- 相談チャットは `streamGenerateContent`（SSE）で、できた端から表示する
