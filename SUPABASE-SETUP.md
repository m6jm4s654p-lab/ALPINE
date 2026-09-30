# Supabase端末数集計の設定

対象: https://zrvufwzhcbmqbxarvhee.supabase.co

## 構成

- `device-stats-config.js`: 公開可能なProject URLのみ。
- `device-stats.js`: ブラウザー単位のID作成、初回登録、管理者照会。
- `supabase/migrations/202609300001_device_stats.sql`: 端末IDテーブルと管理者試行回数制限。
- `supabase/functions/device-stats/`: 登録・集計用Edge Function。

端末ID以外の選手情報・訪問日時・IPアドレスはアプリの集計テーブルに保存しません。Supabase自体の運用ログは別です。累計には管理者自身のブラウザーも含まれます。別ブラウザー、シークレットモード、サイト保存データ削除は別カウントとなり、実人数・実機数とは一致しません。登録用APIは公開なので意図的な架空ID投稿を完全に防ぐ統計ではありません。

IDは選手データと別のlocalStorageに保存し、アプリの選手登録リセットでは保持します。引継ぎJSONには含めません。同一IDの再送はDBの主キーで重複排除します。保存が使えない環境では一時IDを送信せず、アプリをそのまま利用できます。

## 初回設定

1. SupabaseのSQL Editorで上記SQLファイルを一度実行します。一般利用者用のanon/authenticatedにはテーブルや集計関数を公開しません。
2. Edge Functionsで`device-stats`を作成します。`index.ts`と`handler.mjs`を同じフォルダーへ配置してデプロイします。CLIでは以下を使用できます。

   ```sh
   npx supabase login
   npx supabase functions deploy device-stats --project-ref zrvufwzhcbmqbxarvhee --no-verify-jwt
   ```

   JWT検証はこの公開登録用関数のみ無効にします。集計は関数内で管理者コードを照合します。SQLのアクセス制限は有効のままです。

3. Edge Functions > Secretsで以下を登録します。

   | Name | Value |
   |---|---|
   | `ALLOWED_ORIGINS` | `https://m6jm4s654p-lab.github.io` |
   | `ADMIN_STATS_CODE` | 会話で指定された管理者コードを直接入力 |

   管理者コードはGitHub、フロントエンド、スクリーンショット、共有ファイルへ保存しません。英数字8〜80文字、YN4/AC3以外で始まる値を使用します。大小文字は区別します。Supabaseの組み込みサーバー用キーをEdge Function内でのみ利用するため、ブラウザーへのAPIキー設定は不要です。

4. `device-stats-config.js`は上記URLを設定済みです。GitHub Pagesへ変更ファイルを公開します。`sw.js`も更新し、既存のPWAへ新しいスクリプトを配信します。
5. 通常の友達コード入力欄から指定コードを送信し、「管理者モード：累計アクセス端末数 約○台」を確認します。再読み込み後も同一ブラウザーの累計は増えず、別ブラウザーから開くと増えることを確認します。

## 運用

- 集計は導入後のみ。初回登録の成功後は再起動のたびの書き込みを省略します。
- 管理者照会は全体で1分30回まで。制限後は1分待ちます。個人別の履歴を残さないため全体共通の制限です。
- 通信障害、無料プランの一時停止、関数未作成時は「0台」ではなく取得エラーを表示します。
- DBを空にすると端末側の登録済み記録とずれます。継続運用ではテーブルを消去せず、移行時は既存IDも移します。
- 計測の案内が必要な場合は、設定の説明に「利用規模の把握のため、選手情報と結び付かないランダムIDでブラウザー数を集計します」と記載できます。
- 無料プランの休止・上限はSupabaseの最新条件を確認してください。

## 検証

```sh
node --test tests/device-stats.test.mjs
node --check app.js
node --check device-stats.js
```

自動テスト: 重複登録、正常/不正コード、0件、設定なし、保存不可、通信失敗、再送、入力制限、オリジン、サーバーキー、照会回数制限。
SQLはローカルPostgreSQL互換ランタイムでも実行し、anon/authenticatedの拒否、service_roleの読み書き、重複排除、回数制限と時間経過での解除を確認。
