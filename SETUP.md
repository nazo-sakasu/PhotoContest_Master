# フォトコンテストシステム セットアップ手順 v2.0

労働組合・企業の内部イベント向けフォトコンテストシステムです。
Supabaseをバックエンドに、静的HTMLで動作する構成です。

---

## 📦 ファイル構成

```
production/
├── config.js              ← Supabase URL/anonKey（Git除外）
├── config.example.js      ← 設定テンプレート
├── db.js                  ← DBアクセス層（編集不要）
├── schema.sql             ← DB定義・RPC関数・RLS（v2.0）
├── events.html            ← イベント管理画面
├── admin.html             ← ホスト用画面
├── index.html             ← 参加者用画面
├── .gitignore
└── assets/
    └── bgm.mp3
```

---

## 🚀 初期セットアップ手順

### ⚠️ schema.sql 実行時の注意

`schema.sql` には複数のパッチセクション（v2.0 / v2.1 / v2.2）が含まれています。
**すべてを順番に実行してください**（先頭から末尾まで一括でOK）。

特に以下は v2.1/v2.2 で追加された重要関数です：
- `host_get_event`：管理画面が draft イベントを取得するために必須
- `verify_admin_key` / `create_event(6引数版)`：イベント作成の安全性
- `get_public_event` / `admin_list_events` の theme_preset 対応版

途中で止めた場合、機能の一部が動作しません。

### 1. Supabaseプロジェクト作成

1. [supabase.com](https://supabase.com) でプロジェクト新規作成
2. リージョン：**Tokyo (Northeast Asia)** 推奨

### 2. 拡張機能の有効化

Dashboard → **Database → Extensions** で以下を有効化：

- `pgcrypto` （ハッシュ生成・通常デフォルトで有効）
- `pg_cron` （自動削除を使う場合のみ・任意）

### 3. データベーススキーマ作成

1. Dashboard → **SQL Editor** → **New query**
2. `schema.sql` の中身を全部コピー＆貼り付け
3. **Run** を実行
4. 「Success」が出ればOK

このSQLは：
- 8つのテーブルを作成
- 5つの公開Viewを作成
- 20以上のRPC関数を作成
- RLSを有効化し、anon直接アクセスを最小化

### 4. Storageバケット作成

1. Dashboard → **Storage** → **New bucket**
2. Name: `photos`
3. **Public bucket: ON** （公開URLで写真表示するため）
4. Save

### 5. Storageポリシー設定（重要）

`photos` バケット → **Policies** タブ → **New Policy** → **For full customization** で以下：

#### ① 投稿用：INSERT

```
Policy name: anon_upload
Allowed operation: INSERT
Target roles: anon, authenticated
WITH CHECK:
  bucket_id = 'photos'
  AND (storage.foldername(name))[1] IS NOT NULL
```

#### ② 表示用：SELECT

```
Policy name: anon_select
Allowed operation: SELECT
Target roles: anon, authenticated
USING:
  bucket_id = 'photos'
```

#### ③ DELETE：**ポリシーを作らない**

⚠️ **DELETE ポリシーは絶対に作らないでください。**
DELETEポリシーが無い場合、anon/authenticatedからは削除不可になります。
ホストが画像を物理削除したい場合は、Supabase管理画面から手動で削除します。

### 6. config.js 設定

`config.example.js` を `config.js` にコピーして編集：

```javascript
window.SUPABASE_CONFIG = {
  url: 'https://xxxxx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1...',
  bucketName: 'photos',
};
```

`anon key`は**RLSで守られているため公開しても基本問題ない**ですが、
Git公開リポジトリでは必ず `.gitignore` で除外してください。

### 7. 管理キー（admin_key）設定 ⚠️ 重要

`schema.sql` の実行直後は、管理キーが初期値 `CHANGE_ME_ADMIN_KEY` になっています。
**必ず本番運用前に変更してください。** これを変更しないと、Supabase URLとanon keyを知っている第三者が勝手にイベントを作成できます。

Supabase **SQL Editor** で以下を実行：

```sql
UPDATE app_settings
SET value = encode(digest('your_actual_admin_key_here', 'sha256'), 'hex'),
    updated_at = now()
WHERE key = 'admin_key_hash';
```

- `your_actual_admin_key_here` を実際の管理キーに書き換えてください
- 8文字以上推奨（記号・数字混合がベター）
- **イベント業者の社内のみで共有**し、クライアントには渡さないこと
- このキーは `events.html` でイベント作成時に必要になります
- 紛失時は同じSQLで再設定可能（ハッシュしか保存されていないため平文復元は不可）

確認：

```sql
SELECT * FROM app_settings WHERE key = 'admin_key_hash';
-- value がデフォルト値（CHANGE_ME_ADMIN_KEYのハッシュ）から変わっていればOK
```

## 🎨 背景テーマ

イベントごとに参加者画面の配色テーマを選択できます。
デザイン崩れ防止のため、自由なカラーコード入力ではなくプリセット式です。

| 値 | 表示名 | 用途 |
|---|---|---|
| `aquarium` | 水族館ブルー | デフォルト・水族館・海関連イベント |
| `family` | ファミリー暖色 | 親子イベント・ファミリー祭り |
| `corporate` | 企業イベントシンプル | 社内イベント・労働組合向け |
| `spring` | 春フェス | 春イベント・屋外イベント |
| `night` | ナイトイベント | 夜イベント・大人向け |

初期値は `aquarium`（水族館ブルー）です。
ホスト画面（admin.html）の「機能設定」→「背景テーマ」から変更でき、保存すると参加者画面に即時反映されます。

## 🗑 「非表示」「削除」「物理削除」の意味

本システムでは3つの状態を明確に区別しています。混同しないよう注意してください。

| 操作 | 内容 | DB状態 | Storage画像 | 復元 |
|---|---|---|---|---|
| **非表示** | 参加者画面・ランキングから消す | `status='hidden'` | 残る | 可能 |
| **削除** | DB上で削除扱い、識別情報も即削除 | `status='deleted'` | 残る | 不可 |
| **物理削除** | Storageから画像ファイル自体を削除 | （上記いずれか） | 削除 | 不可 |

### 物理削除について

- **クライアントから画像を物理削除することはできません**（Storage DELETE ポリシーを作らない設計のため）
- 物理削除が必要な場合は **Supabase ダッシュボード → Storage → photos バケット**から手動削除
- 自動削除（auto10/auto30）は**DB上のデータのみ**対象。Storage画像は残ります
- イベント業者として「Storageから完全削除」と説明する場合は、追加の手動作業が必要なことを明確に

## 🕒 自動削除（retention_mode）の範囲

`retention_mode` を `auto10` または `auto30` に設定し、`pg_cron` または手動cleanupを実行した時、**実際に削除/匿名化される対象**：

| 対象 | 処理 |
|---|---|
| `photo_identifiers` の登録番号・電話・社員番号・メール | NULL化（匿名化） |
| `comments` | 物理削除 |
| `likes` | 物理削除 |
| `reports` | 物理削除 |
| `photos.status` | `'deleted'` に変更（参加者画面から非表示） |
| **Storage画像ファイル** | **対象外**（手動削除が必要） |

### Storage画像の処理方針

イベント終了後、Storage画像をどうするかを事前に決めておきます：

- **A. 残す**：受賞写真などを資料として保管。費用最小。
- **B. 手動で物理削除**：完全な情報削除が必要な場合は、Supabase Dashboard → Storage で削除。
- **C. 別の場所へ移動**：高解像度ダウンロード後、Supabase上から削除。

### 9. 自動削除を有効化（推奨）

#### A案：pg_cron でスケジュール実行

`pg_cron` を有効化したあと、SQL Editor で：

```sql
SELECT cron.schedule(
  'photo_contest_cleanup',
  '0 3 * * *',  -- 毎日午前3時実行
  $$ SELECT cleanup_expired_events(); $$
);
```

確認：

```sql
SELECT * FROM cron.job;
```

削除：

```sql
SELECT cron.unschedule('photo_contest_cleanup');
```

#### B案：手動 cleanup

`admin.html` の **「クリーンアップ実行」** ボタンから手動実行可能。
pg_cron が使えない環境でもOK。

---

## 🔐 セキュリティ設計

### 多層防御

| 層 | 内容 |
|---|---|
| **公開View** | 識別情報を物理的に隠す（registration_number等は出力しない） |
| **RPC関数** | `SECURITY DEFINER` で必要な検証を全て実装 |
| **host_key** | ハッシュ化保存・管理操作の都度検証 |
| **RLS** | ベーステーブルへの直接アクセスを禁止 |
| **Storageポリシー** | DELETEポリシーを作らずクライアントから削除不可 |

### 一般参加者ができること

- ✅ 公開Viewで写真一覧・ランキング・コメント取得
- ✅ `submit_photo` RPCで投稿（受付期間中のみ）
- ✅ `add_like` RPCでいいね（投票期間中・自分以外）
- ✅ `add_comment` RPCでコメント（コメント機能ON時のみ）
- ✅ `report_photo` RPCで通報

### 一般参加者ができないこと

- ❌ 他人の写真を削除・非表示
- ❌ 識別情報（登録番号・電話・社員番号・メール）の閲覧
- ❌ Storage上の画像ファイル削除
- ❌ イベント設定の変更
- ❌ 他人のいいね削除
- ❌ 操作ログ閲覧

### ホストができること（host_key必須）

- ✅ `host_hide_photo` 写真の非表示
- ✅ `host_delete_photo` 写真の論理削除
- ✅ `host_hide_comment` コメント非表示
- ✅ `host_resolve_report` 通報対応
- ✅ `host_list_photos_with_identifiers` 識別情報込みリスト
- ✅ `host_update_event` イベント設定変更
- ✅ `host_clear_personal_data` 個人情報一括削除
- ✅ `host_run_cleanup` 期限切れデータ削除
- ✅ `host_delete_event` イベント完全削除（イベント名一致必須）

---

## ⚠️ 重要な注意

### localStorageパスワードについて

`events.html` の管理画面ロックは **localStorageベース** です。
これは **画面の補助ロック** であり、**真のセキュリティではありません**。

- 画面ロックパスワードは8文字以上必須（未設定不可）
- 真のセキュリティは以下の3つで担保されています：
  - **admin_key**：イベント作成・全イベント取得時にDB側で必須検証
  - **host_key**：イベント別の管理操作時にDB側でハッシュ検証
  - **RLS / RPC / Storageポリシー**：直接アクセスを物理的に遮断
- localStorageパスワードは「他人が画面に物理的にアクセスした時の補助」
- admin_key を知っている人は events.html を経由しなくてもイベント操作可能
- admin_key / host_key は絶対に外部に共有しないこと

### admin_key と host_key の使い分け

| キー | 用途 | 保管者 |
|---|---|---|
| **admin_key** | イベント新規作成・全イベント一覧取得 | イベント業者（運営）のみ |
| **host_key** | 個別イベントの設定・モデレーション | イベント業者 + クライアント幹事 |

クライアントには `admin_key` を渡さず、`host_key` だけを共有してください。

### Storage DELETE を絶対に開けないこと

公式ドキュメントなどで「DELETE全員許可」のサンプルを見ても、
このシステムでは **DELETE ポリシーを作らない** こと。

DELETEを開放すると、anon keyを取得した第三者が画像を全削除できます。

### config.js の取扱い

- `config.js` は `.gitignore` で除外
- 公開リポジトリには `config.example.js` のダミー値のみコミット
- GitHub Pages で公開する場合、`anon key` は公開されますが、RLSが正しく閉じていれば問題ありません
- ただし、より高い安全性が必要な場合は **Netlify / Vercel** で環境変数経由を推奨

---

## 🧪 動作確認チェック

セットアップ後、以下をブラウザの開発者ツールで確認：

### A. 公開Viewが識別情報を含まないか

```javascript
const { data } = await DB.sb.from('public_photos_view').select('*');
console.log(Object.keys(data[0]));
// 期待: photo_id, event_id, nickname, image_url, created_at, like_count, comment_count
// NG: registration_number, phone, employee_id, email が出る
```

### B. 直接テーブルアクセスがブロックされるか

```javascript
const { data, error } = await DB.sb.from('photo_identifiers').select('*');
console.log(error);
// 期待: error が返る（RLS or 権限なし）
```

### C. 不正なhost_keyで管理RPCが拒否されるか

```javascript
const { error } = await DB.sb.rpc('host_hide_photo', {
  p_event_id: 'test', p_photo_id: 'p_xxx', p_host_key: 'wrong_key'
});
console.log(error);
// 期待: unauthorized エラー
```

### D. 投稿期間外の投稿が拒否されるか

イベントの `upload_end_at` を過去にしてから、参加者画面で投稿を試みる。
→ DB側で `upload_ended` エラーが返ること。

### E. 自動削除の動作確認

```sql
-- テスト用：retention_mode='auto10' のイベントの ends_at を過去にする
UPDATE events SET ends_at = now() - INTERVAL '11 days', retention_mode = 'auto10'
WHERE id = 'test_event';

-- cleanup実行
SELECT cleanup_expired_events();

-- 結果確認
SELECT * FROM admin_logs WHERE event_id = 'test_event' AND action = 'cleanup_event';
SELECT * FROM photo_identifiers WHERE event_id = 'test_event';
-- 期待：identifiersがNULLになり、ログが残る
```

---

## 📊 参加者規模ごとの推奨プラン

| 規模 | プラン | 理由 |
|---|---|---|
| 〜30組 | Free | 容量・接続とも余裕 |
| 30〜80組 | Pro 1ヶ月のみ | Egress 5GB/月超過リスク回避 |
| 100組〜 | Pro必須 | Realtime接続200を超える可能性 |
| 500組〜 | Pro+追加帯域 | Egress大量・要事前見積 |

イベント終了後にFreeへダウングレード可能（次月の請求から無料）。

---

## ✅ 本番前チェックリスト

### システム

- [ ] schema.sql を実行済み
- [ ] Storageバケット `photos` 作成済み（Public ON）
- [ ] Storage INSERT・SELECT ポリシー作成済み
- [ ] **Storage DELETE ポリシーは作らない**
- [ ] config.js に正しい URL / anon key 入力済み
- [ ] config.js が .gitignore で除外されている
- [ ] サンプルイベントで投稿・いいね・コメントの動作確認済み
- [ ] 不正host_keyで管理RPC拒否されることを確認

### 自動削除

- [ ] pg_cron 設定済み or 手動cleanupで運用すると決めた
- [ ] `retention_mode` を意図的に設定した（manual/auto10/auto30）
- [ ] テスト用イベントでcleanup動作を確認済み

### イベント設定

- [ ] `enable_registration_number` を意図的に設定（賞品郵送あれば必要）
- [ ] `enable_comments` を意図的に設定（初期OFF推奨）
- [ ] `auto_hide_report_threshold` の閾値を決めた
- [ ] `upload_start_at` `upload_end_at` `vote_start_at` `vote_end_at` 設定
- [ ] host_keyを安全な場所に保管した

### 参加者向け

- [ ] 参加URLでテスト投稿可能
- [ ] 写真一覧で識別情報が表示されないことを確認
- [ ] 結果発表画面で識別情報が表示されないことを確認
- [ ] 登録番号ON時、未入力で投稿エラーになることを確認

---

## 🆘 困ったとき

| 症状 | 対処 |
|---|---|
| 画面が真っ白 | F12でコンソール確認、config.js設定確認 |
| 投稿できない | upload_start_at〜upload_end_atの範囲確認 |
| いいねできない | vote_start_at〜vote_end_atの範囲確認 |
| RPC `unauthorized` エラー | host_key誤りのため要確認 |
| 自動削除動作しない | pg_cron状態確認、手動cleanupで代替 |
| Realtime同期が遅い | 接続数200近づいてないか確認、Pro検討 |

---

## 📞 サポート

株式会社ウィーケン
法人事業部 事業部長 永坂 哲平
TEL: 090-3589-9333
MAIL: nagasaka@weeek-end.com
