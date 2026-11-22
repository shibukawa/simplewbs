# Simple WBS

タスクの **前後関係（依存）** と **どのワーカーが何をしているか** をひと目で見るための、シンプルな WBS ツールです。
日付ベースのガントチャートではなく、「これが終わったら次はこれ」というつながりを中心に表示します。

- **依存グラフ**: 左から右へ、依存の深さ順にタスクを並べて矢印で表示。ワーカーごとのレーンに分けて表示できます
- **ワーカー別ビュー**: ワーカーごとに「作業中 / 次にやれる（着手可）/ 待ち」を一覧表示
- 状態は 未着手・作業中・完了。先行タスクがすべて完了した未着手タスクは自動で **着手可** になります
- **終了目安** は自由記述のメモ（任意）。「12/5」「来週中」など何でも書けます
- GitHub ログイン、複数マシン・複数メンバーでデータを共有（5 秒ごとに自動同期）
- 利用できるのは `ALLOWED_LOGINS` に登録した GitHub ユーザーだけ（招待制）
- JSON エクスポート / インポート

## 操作

| 操作 | 動作 |
| --- | --- |
| タスクをクリック | 選択して右パネルで編集。前後につながるタスクを強調表示 |
| タスク右端の ● をドラッグして別のタスクへ | 依存を追加（ドラッグ元 → ドラッグ先） |
| 選択中に別のタスクを Shift+クリック | 依存を追加 / 解除 |
| 矢印をクリック | 依存を削除 |
| 状態バッジをクリック | 未着手 → 作業中 → 完了 と切り替え |
| パネルの「＋ 後続タスクを作成」 | 選択中タスクの次にやるタスクを作成 |

## 構成

すべて Cloudflare の無料枠で動きます。

- フロントエンド: React + Vite（Workers Static Assets で配信）
- API: Cloudflare Worker（`worker/index.ts`）
- DB: Cloudflare D1（SQLite、`migrations/`）
- 認証: GitHub OAuth App（Worker で実装、セッションは D1 に保存）

ストレージが増え続けないように、次の上限があります（`wrangler.jsonc` の `vars` で変更できます）。

| 変数 | 既定値 |
| --- | --- |
| `MAX_PROJECTS_PER_USER` | 20（1人が作成できるプロジェクト数） |
| `MAX_TASKS_PER_PROJECT` | 1000 |
| `MAX_WORKERS_PER_PROJECT` | 50 |

## デプロイ手順

### 1. Cloudflare に D1 データベースを作る

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create simplewbs
```

表示された `database_id` を `wrangler.jsonc` の `database_id` に書き込みます。

### 2. GitHub OAuth App を作る

GitHub の Settings → Developer settings → OAuth Apps → New OAuth App で作成します。

- Homepage URL: `https://simplewbs.<あなたのサブドメイン>.workers.dev`
- Authorization callback URL: `https://simplewbs.<あなたのサブドメイン>.workers.dev/auth/callback`

（URL は最初の `wrangler deploy` の出力で確認できます。先にデプロイしてから OAuth App を作っても構いません）

### 3. シークレットを設定する

```bash
npx wrangler secret put GITHUB_CLIENT_ID
```

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
```

```bash
npx wrangler secret put ALLOWED_LOGINS
```

`ALLOWED_LOGINS` には、利用を許可する GitHub ユーザー名をカンマ区切りで入力します（例: `shibukawa,alice,bob`）。

- 空、または未設定の場合は **だれもログインできません**
- リストから外したユーザーは、すでにログイン中でも次のリクエストから使えなくなります
- プロジェクトの共有メンバーに追加できるのも、このリストにいるユーザーだけです

メンバーを増やしたり減らしたりするときは、同じコマンドでもう一度設定します（再デプロイは不要です）。

### 4. デプロイ

```bash
npm run deploy
```

ビルドしたあと、D1 のマイグレーションを適用してから Worker をデプロイします。

### GitHub Actions で自動デプロイする（任意）

`main` に push するたびにデプロイしたい場合は、リポジトリに次を設定します。

- Secrets: `CLOUDFLARE_API_TOKEN`（「Edit Cloudflare Workers」テンプレートに D1 の編集権限を追加したもの）、`CLOUDFLARE_ACCOUNT_ID`
- Variables: `CLOUDFLARE_DEPLOY` = `true`

## ローカル開発

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run preview
```

http://localhost:8787 を開きます。`.dev.vars` で `DEV_LOGIN` を設定しておくと、localhost では GitHub を使わずにログインできます（`/auth/login?as=bob` で別のユーザーとしてログイン）。このユーザーも `.dev.vars` の `ALLOWED_LOGINS` に含めておく必要があります。

フロントエンドを HMR 付きで開発するときは、`npx wrangler dev` と `npm run dev` を別々のターミナルで起動し、http://localhost:5173 を開きます。
