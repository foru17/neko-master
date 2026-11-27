<p align="center">
  <img src="./assets/icon-neko-master.png" width="200" alt="Neko Master ロゴ" style="margin-bottom: 16px;">
  <br>
  <b style="font-size: 32px;">Neko Master</b>
</p>

<p align="center">
  <b>ネットワークトラフィックをひと目で把握。</b><br>
  <span>リアルタイム監視 · トラフィック監査 · マルチゲートウェイ対応</span>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <b>日本語</b>
</p>

<p align="center">
  <a href="https://github.com/foru17/neko-master/stargazers"><img src="https://img.shields.io/github/stars/foru17/neko-master?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/pulls/foru17/neko-master?style=flat-square&color=blue&logo=docker" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/v/foru17/neko-master?style=flat-square&label=Docker&color=2496ED" alt="Docker Version"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/image-size/foru17/neko-master/latest?style=flat-square&logo=docker" alt="Image Size"></a>
  <a href="https://github.com/foru17/neko-master/blob/main/LICENSE"><img src="https://img.shields.io/github/license/foru17/neko-master?style=flat-square&color=green" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js">
  <a href="https://github.com/foru17/neko-master/actions/workflows/docker-build.yml"><img src="https://img.shields.io/github/actions/workflow/status/foru17/neko-master/docker-build.yml?style=flat-square&label=Docker%20CI" alt="Docker CI"></a>
  <a href="./docs/architecture.en.md"><img src="https://img.shields.io/badge/docs-architecture-0ea5e9?style=flat-square" alt="Architecture Docs"></a>
</p>

> [!IMPORTANT]
> **免責事項**
>
> 本プロジェクトは、ローカルゲートウェイ環境向けの
> トラフィック分析・可視化ツールです。
>
> ネットワークアクセスサービス、プロキシのサブスクリプション、
> ネットワークをまたぐ接続機能などは一切提供しません。
> すべてのデータはユーザー自身のネットワーク環境から収集されます。
>
> 本プロジェクトは MIT License のもとでオープンソースとして公開されています。本ソフトウェアの使用によって生じたいかなる結果についても、私たちは一切の責任を負いません。適用される法令を遵守してご利用ください。

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./assets/neko-master-overview-light.png" alt="Neko Master プレビュー（ライト 1）" />
    </td>
    <td align="center" width="50%">
      <img src="./assets/neko-master-regions-light.png" alt="Neko Master プレビュー（ライト 2）" />
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./assets/neko-master-rules-dark.png" alt="Neko Master プレビュー（ダーク 1）" />
    </td>
    <td align="center" width="50%">
      <img src="./assets/neko-master-domains-dark.png" alt="Neko Master プレビュー（ダーク 2）" />
    </td>
  </tr>
</table>

## 名前の由来

**Neko**（ねこ）は日本語で _猫_ を意味します。
発音は **/ˈneɪkoʊ/**（ネコ）です。

猫のように、Neko Master はネットワークトラフィックを静かに、そして正確に観察します。
モダンなゲートウェイ環境向けに設計された、軽量な分析ダッシュボードです。

## 📋 目次

- [✨ 機能](#-機能)
- [🚀 クイックスタート](#-クイックスタート)
- [🤖 Agent のデプロイ](#-agent-のデプロイ)
- [📖 初回利用](#-初回利用)
- [🔧 ポート競合の解決](#-ポート競合の解決)
- [🐳 Docker の設定](#-docker-の設定)
- [🗄️ ClickHouse (オプション)](#-clickhouse-オプション)
- [🌐 リバースプロキシとトンネル](#-リバースプロキシとトンネル)
- [🔐 認証とセキュリティ](#-認証とセキュリティ)
- [❓ FAQ](#-faq)
- [🏗️ アーキテクチャガイド](#-アーキテクチャガイド)
- [🤝 フィードバックと Issue](#-フィードバックと-issue)
- [📁 プロジェクト構成](#-プロジェクト構成)
- [🛠️ 技術スタック](#-技術スタック)
- [📄 ライセンス](#-ライセンス)

## ✨ 機能

| 機能                           | 説明                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| 📊 **リアルタイム監視**        | WebSocket によるミリ秒単位の低遅延リアルタイム収集           |
| 📈 **トレンド分析**            | 30分 / 1時間 / 24時間の多次元トラフィックトレンド            |
| 🌐 **ドメイン分析**            | ドメインごとのトラフィック、関連 IP、接続数を表示            |
| 🗺️ **IP 分析**                 | ASN、地理的位置、関連ドメインを表示                          |
| 🚀 **プロキシ統計**            | プロキシノードごとのトラフィック分布と接続数                 |
| 📱 **PWA 対応**                | デスクトップアプリとしてインストールしネイティブな操作感を実現 |
| 🌙 **ダークモード**            | ライト / ダーク / システムテーマに対応                       |
| 🌍 **多言語対応**              | 英語 / 中国語をシームレスに切り替え                          |
| 🔄 **マルチバックエンド**      | 複数の OpenClash バックエンドインスタンスを同時に監視        |

## 🚀 クイックスタート

### 方法 1: Docker Compose（推奨）

> リポジトリに含まれる `docker-compose.yml` は、デフォルトで `3000/3001/3002` をマッピングします。
> 以下のシナリオ A/B は、よくあるデプロイ向けの最小構成テンプレートです。

#### シナリオ A: 最小構成のデプロイ（3000 のみ公開）

```yaml
services:
  neko-master:
    image: foru17/neko-master:latest
    container_name: neko-master
    restart: unless-stopped
    ports:
      - "3000:3000" # Web UI
    volumes:
      - ./data:/app/data
      # Local MMDB (optional, files should be downloaded into ./geoip)
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

> `.env`（`docker-compose.yml` と同じディレクトリ）に以下を設定することを推奨します:
> `COOKIE_SECRET=<at least 32-byte random string>`（`openssl rand -hex 32` で生成）

> このモードはアップグレードとの互換性が完全に保たれており、そのまま使用できます。
> WS がルーティングされていない場合、アプリは自動的に HTTP ポーリングにフォールバックします。

#### シナリオ B: リアルタイム WebSocket（リバースプロキシとの併用を推奨）

```yaml
services:
  neko-master:
    image: foru17/neko-master:latest
    container_name: neko-master
    restart: unless-stopped
    ports:
      - "3000:3000" # Web UI
      - "3002:3002" # WebSocket (for Nginx / Tunnel forwarding)
    volumes:
      - ./data:/app/data
      # Local MMDB (optional, files should be downloaded into ./geoip)
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

次に以下を実行します:

```bash
docker compose up -d
```

<http://localhost:3000> を開いて使い始めましょう。

リポジトリに含まれる Compose ファイル（デフォルトは `3000/3001/3002`）を使う場合も、同じコマンドを実行します。

### 方法 2: Docker Run

```bash
# Generate a fixed cookie secret first (for session persistence)
export COOKIE_SECRET="$(openssl rand -hex 32)"
```

```bash
# Minimal (only 3000)
docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  foru17/neko-master:latest

# Real-time WS (with reverse proxy)
docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -p 3002:3002 \
  -v $(pwd)/data:/app/data \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  foru17/neko-master:latest
```

<http://localhost:3000> を開いて使い始めましょう。

> フロントエンドはデフォルトで同一オリジンの `/api` を使用するため、通常はポート 3001 を外部に公開する必要はありません。
> リアルタイム WS を使うには、リバースプロキシ/トンネルからポート `3002` に到達できる必要があります。到達できない場合、アプリは約 5 秒間隔の HTTP ポーリングにフォールバックします。

> `docker run` では、`-p` のマッピングで外部ポートを直接変更します。
> 直接 WS アクセス（リバースプロキシなし）を使い、かつ外部 WS ポートが `3002` でない場合に限り、`-e WS_EXTERNAL_PORT=<external-ws-port>` も指定してください。
>
> ローカル MMDB 検索モード（オプション）: `-v $(pwd)/geoip:/app/data/geoip:ro` をマウントし、
> `Settings -> Preferences -> IP Lookup Source` でソースを Local に切り替えます。

### 方法 3: ワンクリックスクリプト

ポートの競合を自動検出し、すべてを設定します:

```bash
# Using curl
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash

# Or using wget
wget -qO- https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash
```

スクリプトは以下を自動的に行います:

- ✅ `docker-compose.yml` をダウンロード
- ✅ デフォルトポート（3000/3001/3002）が使用中かどうかを確認
- ✅ 利用可能な代替ポートを提案
- ✅ 設定ファイルを作成してサービスを起動

### 方法 4: ソースコード

```bash
# 1. Clone the repository
git clone https://github.com/foru17/neko-master.git
cd neko-master

# 2. Install dependencies
pnpm install

# 3. Prepare collector env (source mode reads apps/collector/.env)
cp apps/collector/.env.example apps/collector/.env

# 4. Start development services
pnpm dev
```

<http://localhost:3000> を開いて設定します。

> ソースモードでは、デフォルトで collector が `3001/3002`、web が `3000` で待ち受けます。
> `API_PORT` を（3001 以外に）変更した場合は、web の `/api` リライトが正しい API を向くように `API_URL` もそれに合わせて設定してください（例: `API_URL=http://localhost:4001`）。
> `apps/collector/.env.local` は `apps/collector/.env` より優先されます。

## 🤖 Agent のデプロイ

1 つの Neko Master サービスに集約しつつ、複数のリモートデバイス（OpenWrt、Linux、macOS）でローカルゲートウェイのデータを収集したい場合は、Agent モードを使用します。Agent はゲートウェイの近くで動作してデータを取得し、パネルに報告します。パネルがゲートウェイに直接接続することはありません。

対応するゲートウェイの種類: **Clash / Mihomo**（WebSocket リアルタイム）と **Surge v5+**（HTTP ポーリング）。

### クイックインストール（UI で生成されるコマンド）

1. ダッシュボードで `Settings → Backends` を開き、`Agent` バックエンドを追加してゲートウェイの種類を選択します
2. **「View Agent Script」** をクリックして 1 行のインストールコマンドをコピーし、対象ホストで実行します:

```bash
# Clash / Mihomo gateway example
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='1' \
        NEKO_BACKEND_TOKEN='ag_xxx' \
        NEKO_GATEWAY_TYPE='clash' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9090' \
        sh

# Surge gateway example
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='2' \
        NEKO_BACKEND_TOKEN='ag_yyy' \
        NEKO_GATEWAY_TYPE='surge' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9091' \
        sh
```

インストール後は、`nekoagent` でインスタンスを管理します:

```bash
nekoagent list               # list all instances
nekoagent status <instance>  # check running state
nekoagent logs <instance>    # tail live logs
nekoagent restart <instance> # restart
nekoagent upgrade            # global upgrade (CLI + binary)
```

> スクリプトは既存のインストールを自動検出します。`neko-agent` がすでに存在する場合は、再ダウンロードせずに新しいインスタンスのみを追加します。
> 同じホスト上で複数のインスタンス（異なる `NEKO_INSTANCE_NAME`）を実行でき、それぞれが別のゲートウェイを指すことができます。

### Agent ドキュメント

- [概要](./docs/agent/overview.en.md): アーキテクチャ、Direct と Agent の比較、セキュリティモデル
- [クイックスタート](./docs/agent/quick-start.en.md): UI から Agent の起動までのエンドツーエンドのセットアップ
- [インストールガイド](./docs/agent/install.en.md): インストール方法、systemd / launchd による自動起動
- [設定](./docs/agent/config.en.md): フラグと環境変数の完全なリファレンス
- [リリースフロー](./docs/agent/release.en.md): バージョニングと互換性ポリシー
- [トラブルシューティング](./docs/agent/troubleshooting.en.md): よくあるエラーと対処法

## 📖 初回利用

![初回利用](./assets/neko-master-setup.png)

### Clash / Mihomo に接続する

1. <http://localhost:3000> を開きます
2. 初回アクセス時に **Gateway Configuration** ダイアログが表示されます
3. ネットワークゲートウェイ（例: OpenClash）の接続情報を入力します:
   - **Name**: 任意の名前（例: 「Home Gateway」）
   - **Type**: `Clash / Mihomo` を選択
   - **Host**: ゲートウェイバックエンドのアドレス（例: `192.168.101.1`）
   - **Port**: ゲートウェイバックエンドのポート（例: `9090`）
   - **Token**: Secret を設定している場合は入力し、それ以外は空欄のままにします
4. 「Add Backend」をクリックして保存します
5. システムが自動的にトラフィックデータの収集と分析を開始します

> 💡 **ゲートウェイアドレスの取得**: ゲートウェイのコントロールパネル（例: OpenClash）を開く → 「External Control」を有効化 → API アドレスをコピー

### Surge に接続する

![Surge HTTP API の設定](./assets/neko-master-surge.png)

Neko Master は Surge ゲートウェイへの接続に対応しており、ルールチェーン全体の可視化とトラフィック分析が行えます。

#### 1. Surge HTTP API を有効化する

Surge の設定で HTTP リモート API を有効にします:

```ini
[General]
http-api = 127.0.0.1:9091
http-api-tls = false
http-api-web-dashboard = true
```

または、Surge のグラフィカルインターフェースから設定します:

- **HTTP Remote API**: `Settings` → `General` → `HTTP Remote API`
- **ポート**: デフォルトは `9091`
- **認証**: セキュリティ強化のため、パスワードの設定を推奨します

#### 2. Neko Master に Surge バックエンドを追加する

1. Neko Master の設定ダイアログを開きます
2. 「Add Backend」をクリックします
3. 接続情報を入力します:
   - **Name**: 任意の名前（例: 「Surge Home」）
   - **Type**: `Surge` を選択
   - **Host**: Surge が動作している IP アドレス（例: `192.168.1.1` または `127.0.0.1`）
   - **Port**: HTTP API のポート（デフォルトは `9091`）
   - **Token**: HTTP API のパスワード（設定している場合）
4. 「Test Connection」をクリックして設定を確認します
5. 設定を保存します

> 💡 **注意**: Surge は（Clash の WebSocket リアルタイムストリームとは異なり）HTTP ポーリングでデータを取得するため、データの更新に約 2 秒の遅延があります。

## 🔧 ポート競合の解決

「port already in use」エラーが表示された場合は、以下の解決策があります:

### 解決策 1: .env ファイルを使う

`docker-compose.yml` と同じディレクトリに `.env` ファイルを作成します:

```env
WEB_EXTERNAL_PORT=8080    # Change Web UI port
API_EXTERNAL_PORT=8081    # Change API port
WS_EXTERNAL_PORT=8082     # Change WebSocket external port (only for direct access)
COOKIE_SECRET=your-long-random-secret   # Strongly recommended to keep fixed
```

その後、再起動します:

```bash
docker compose down
docker compose up -d
```

これで <http://localhost:8080> にアクセスできます

### 解決策 2: docker-compose.yml を直接編集する

```yaml
ports:
  - "8080:3000" # External 8080 → Internal 3000
  - "8082:3002" # External 8082 → Internal 3002 (for proxy/tunnel WS forwarding)
```

> 注意: 直接 WS アクセス（リバースプロキシなし）を使い、かつ外部 WS ポートが `3002` でない場合は、`WS_EXTERNAL_PORT=<external-ws-port>` を設定してください。

### 解決策 3: ワンクリックスクリプトを使う

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash
```

スクリプトが利用可能なポートを自動的に検出して提案します。

## 🐳 Docker の設定

### ポート

| ポート |    用途    | 外部公開の要否 | 説明                                                                                                                  |
| :----: | :--------: | :------------: | :-------------------------------------------------------------------------------------------------------------------- |
|  3000  |   Web UI   |       ✅       | フロントエンドのエントリーポイント                                                                                    |
|  3001  |    API     |   オプション   | フロントエンドはデフォルトで同一オリジンの `/api` を使用するため、通常は公開不要（デフォルトの Compose ではマッピングされます） |
|  3002  | WebSocket  |   オプション   | リアルタイムプッシュのエンドポイント。リバースプロキシ/トンネル経由での転送のみを推奨（デフォルトの Compose ではマッピングされます） |

### 環境変数（デプロイ）

| 変数 | デフォルト | 用途 | 設定するタイミング |
| :-- | :-- | :-- | :-- |
| `WEB_PORT` | `3000` | Web の待ち受けポート（コンテナ内） | 通常は変更不要 |
| `API_PORT` | `3001` | API の待ち受けポート（コンテナ内） | 通常は変更不要 |
| `COLLECTOR_WS_PORT` | `3002` | WS の待ち受けポート（コンテナ内） | 通常は変更不要 |
| `DB_PATH` | `/app/data/stats.db` | SQLite データのパス | データパスをカスタマイズする場合 |
| `WEB_EXTERNAL_PORT` | `3000` | `docker-compose.yml` における Web の外部ポートマッピング | Web の外部ポートを変更した場合 |
| `API_EXTERNAL_PORT` | `3001` | `docker-compose.yml` における API の外部ポートマッピング | API への直接の外部アクセスが必要な場合 |
| `WS_EXTERNAL_PORT` | `3002` | `docker-compose.yml` における WS の外部ポートマッピング。直接 WS 接続のポート推定にも使用 | プロキシなしで直接 WS アクセスし、かつ外部 WS ポートを変更した場合 |
| `NEXT_PUBLIC_API_URL` | 空 | フロントエンドの API ベース URL を上書き（例: `https://api.example.com`） | API が同一オリジンの `/api` ではない場合 |
| `NEXT_PUBLIC_WS_URL` | 空 | フロントエンドの WS URL を上書き（絶対 URL または `/custom_ws`） | WS のパス/ドメインをカスタマイズする場合 |
| `NEXT_PUBLIC_WS_PORT` | `3002` | WS 直接接続のフォールバックポート（**ビルド時のみ有効 — Docker の実行時に設定しても効果はありません**。代わりに `WS_EXTERNAL_PORT` を使用してください） | ソースからカスタムビルドする場合のみ |
| `API_URL` | `http://localhost:3001` | Next.js の `/api` リライト先（主にソース/カスタムビルド向け） | API の待ち受けアドレスを変更した場合 |
| `COOKIE_SECRET` | 自動生成 | Cookie の署名用シークレット。固定しない場合、データディレクトリが永続化されていないと再起動後にセッションが無効になることがあります | 本番環境では強く推奨 |
| `AGENT_HEARTBEAT_TIMEOUT_MS` | `90000` | Agent がハートビート/レポートを送らずにいられる時間（ミリ秒、最小 `15000`）。これを超えるとオフラインとして表示されます（バックエンド一覧、ヘルスチェック、手動テスト）。デフォルトは Agent のハートビート間隔 30 秒の 3 倍 | 低速な回線で Agent のオンライン/オフラインが頻繁に切り替わる場合 |
| `LOG_LEVEL` | `info` | collector のログレベル: `error`、`warn`、`info`、`debug`（大文字・小文字を区別しません）。`console.error` は常に出力されます | collector のログ量を減らす、またはデバッグ出力を有効にする場合 |
| `BACKEND_TLS_INSECURE` | 空 | `1` に設定すると、ゲートウェイ API に限り TLS 証明書の検証をスキップします（自己署名証明書を使う Surge の `http-api-tls`、mihomo の `external-controller-tls`）。起動時に警告をログに出力します | ゲートウェイが自己署名 / IP 不一致の証明書で HTTPS を使用している場合 |
| `GEOIP_LOOKUP_PROVIDER` | `online` | IP 位置情報のソース（`online` / `local`） | デフォルトでローカル MMDB 検索を使う場合 |
| `GEOIP_ONLINE_API_URL` | `https://api.ipinfo.es/ipinfo` | オンライン IP 位置情報 API のエンドポイント（`ipinfo.my` のレスポンススキーマと互換性が必要） | 互換エンドポイントを自前でデプロイした場合のみ |
| `FORCE_ACCESS_CONTROL_OFF` | `false` | アクセス制御を強制的に無効化（緊急時の復旧用） | トークンを紛失した場合の一時的な使用のみ |
| `SHOWCASE_SITE_MODE` | `false` | 読み取り専用のショーケースモード（機密性の高い書き込み操作をブロック） | 公開デモサイトのみ |

### 高度なチューニング用変数（オプション）

| 変数 | デフォルト | 説明 |
| :-- | :-- | :-- |
| `FLUSH_INTERVAL_MS` | `30000` | collector の書き込みバッファのフラッシュ間隔 |
| `FLUSH_MAX_BUFFER_SIZE` | `5000` | 早期フラッシュが行われるまでのバッファの最大エントリ数 |
| `REALTIME_MAX_MINUTES` | `180` | リアルタイムのインメモリウィンドウサイズ（分） |
| `REALTIME_RANGE_END_TOLERANCE_MS` | `120000` | 範囲クエリの終了時刻の許容誤差 |
| `SURGE_POLICY_SYNC_INTERVAL_MS` | `600000` | Surge ポリシーの同期間隔 |
| `DB_RANGE_QUERY_CACHE_TTL_MS` | `8000` | 範囲クエリキャッシュの TTL |
| `DB_HISTORICAL_QUERY_CACHE_TTL_MS` | `300000` | 履歴クエリキャッシュの TTL |
| `DB_RANGE_QUERY_CACHE_MAX_ENTRIES` | `1024` | 範囲クエリキャッシュの最大エントリ数 |
| `DB_RANGE_QUERY_CACHE_DISABLED` | 空 | `1` に設定すると範囲クエリキャッシュを無効化 |
| `DEBUG_SURGE` | `false` | Surge collector のデバッグログを有効化（`true`） |

### API / WS の解決順序

1. API クライアントのベース: `runtime-config.API_URL` → `NEXT_PUBLIC_API_URL` → 同一オリジンの `/api`
2. `/api` のサーバーサイドリライト先: `API_URL`（デフォルトは `http://localhost:3001`、Next.js の rewrites で適用）
3. WS URL: `runtime-config.WS_URL` → `NEXT_PUBLIC_WS_URL` → 自動候補（`runtime-config.WS_PORT` が設定されている場合は直接ポートが優先され、それ以外は `/_cm_ws` が最初に試されます）
4. WS ポート: `runtime-config.WS_PORT`（`WS_EXTERNAL_PORT` から）→ `NEXT_PUBLIC_WS_PORT` → `3002`
5. 通常のデプロイでは、WS のパス/ドメインをカスタマイズしない限り `NEXT_PUBLIC_WS_URL` は通常不要です

### 本番環境のベースライン（推奨）

```env
NODE_ENV=production
DB_PATH=/app/data/stats.db
COOKIE_SECRET=<at least 32-byte random string>
# Optional: default to local MMDB lookup
# GEOIP_LOOKUP_PROVIDER=local
# Keep false in normal operation
# FORCE_ACCESS_CONTROL_OFF=false
```

`COOKIE_SECRET` の生成には `openssl rand -hex 32` を使用してください。

その他の推奨事項:

1. データとシークレットの消失を防ぐため、永続ストレージ（例: `./data:/app/data`）をマウントしてください。
2. 直接 WS アクセスを使い、かつ外部 WS ポートが `3002` でない場合は、それに合わせて `WS_EXTERNAL_PORT` を設定してください。
3. ソースデプロイで API のポート/アドレスを変更した場合は、`API_URL` も更新してください。
4. ローカル MMDB 検索を使う場合は、`./geoip:/app/data/geoip:ro` をマウントし、`Settings -> Preferences -> IP Lookup Source` でソースを切り替えてください。
5. MMDB ファイルはサイズが大きいため、イメージには同梱されていません。ダウンロードして、固定の名前で `./geoip` に配置してください:
   `GeoLite2-City.mmdb`、`GeoLite2-ASN.mmdb`（必須）、`GeoLite2-Country.mmdb`（オプション）。
   推奨の入手元: <https://github.com/P3TERX/GeoLite.mmdb>。

> Agent の詳細（インストール、設定、リリース、互換性）は `docs/agent/*` で管理されています。

## 🗄️ ClickHouse (オプション)

SQLite は Neko Master のデフォルトのストレージエンジンであり、ほとんどのユーザーにとって十分に機能します。
以下が必要な場合は、ClickHouse の有効化を検討してください:

- 非常に大規模なデータセット（数十万件のドメイン/IP エントリ）
- 長期間（7 日以上）にわたる高速な集計クエリ
- 履歴統計と設定/メタデータのストレージの分離

> ClickHouse は完全にオプションです。ClickHouse を有効にするかどうかに関わらず、SQLite は設定とメタデータのストアとして引き続き使用されます。

### アーキテクチャの概要

ClickHouse を有効にすると、システムは **デュアルライトモード** になります:

```
BatchBuffer.flush()
    │
    ├──→ SQLite (config / metadata, always written)
    └──→ ClickHouse (stats traffic data, dual-write)
           └── Buffer tables → SummingMergeTree async merge
```

読み取り元は `STATS_QUERY_SOURCE`（デフォルト: `sqlite`）で制御します。

### ClickHouse の有効化（Docker）

#### ステップ 1: ClickHouse コンテナを起動する

リポジトリに含まれる `docker-compose.yml` にはすでに ClickHouse サービスが含まれていますが、
`profiles: [clickhouse]` によって制御されているため、デフォルトでは起動しません。リポジトリのルートで以下を実行します:

```bash
docker compose --profile clickhouse up -d
```

> ClickHouse のデータは、メインアプリのデータディレクトリとは別に `./data/clickhouse` に永続化されます。

**カスタムの `docker-compose.yml`**（上記のシナリオ A/B など）を使用している場合は、ClickHouse の
サービスブロックを手動で追加してください:

```yaml
services:
  neko-master:
    # ... your existing config ...
    environment:
      # append to existing environment section:
      - CH_ENABLED=${CH_ENABLED:-0}
      - CH_HOST=${CH_HOST:-clickhouse}
      - CH_PORT=${CH_PORT:-8123}
      - CH_DATABASE=${CH_DATABASE:-neko_master}
      - CH_USER=${CH_USER:-neko}
      - CH_PASSWORD=${CH_PASSWORD:-neko_master}
      - CH_WRITE_ENABLED=${CH_WRITE_ENABLED:-0}
      - STATS_QUERY_SOURCE=${STATS_QUERY_SOURCE:-sqlite}
    networks:
      - neko-master-network

  clickhouse:
    image: clickhouse/clickhouse-server:24.8
    container_name: neko-master-clickhouse
    restart: unless-stopped
    profiles: ["clickhouse"]
    ports:
      - "${CH_EXTERNAL_HTTP_PORT:-8123}:8123"
      - "${CH_EXTERNAL_NATIVE_PORT:-9000}:9000"
    volumes:
      - ./data/clickhouse:/var/lib/clickhouse
    environment:
      - CLICKHOUSE_DB=${CH_DATABASE:-neko_master}
      - CLICKHOUSE_USER=${CH_USER:-neko}
      - CLICKHOUSE_PASSWORD=${CH_PASSWORD:-neko_master}
      - CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1
    networks:
      - neko-master-network
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:8123/ping || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  neko-master-network:
    driver: bridge
```

#### ステップ 2: 環境変数を設定する

`.env`（`docker-compose.yml` と同じディレクトリ）に以下を追加します:

```env
# Enable ClickHouse connection
CH_ENABLED=1

# Enable dual-write
CH_WRITE_ENABLED=1

# Read source: sqlite (default) / auto (smart routing) / clickhouse (force)
STATS_QUERY_SOURCE=auto

# ClickHouse connection (defaults match docker-compose.yml, no change needed)
CH_HOST=clickhouse
CH_PORT=8123
CH_DATABASE=neko_master
CH_USER=neko
CH_PASSWORD=neko_master
```

再起動します:

```bash
docker compose --profile clickhouse up -d
```

### ClickHouse の環境変数

| 変数 | デフォルト | 説明 |
| :-- | :-- | :-- |
| `CH_ENABLED` | `0` | ClickHouse への接続を有効化（`1` で有効） |
| `CH_WRITE_ENABLED` | `0` | デュアルライトを有効化（`CH_ENABLED=1` が必要） |
| `CH_ONLY_MODE` | `0` | CH が正常な場合、SQLite への統計書き込みをスキップ（CH のみモード） |
| `CH_HOST` | `clickhouse` | ClickHouse のホストアドレス |
| `CH_PORT` | `8123` | ClickHouse の HTTP ポート |
| `CH_DATABASE` | `neko_master` | データベース名 |
| `CH_USER` | `neko` | ユーザー名 |
| `CH_PASSWORD` | `neko_master` | パスワード |
| `CH_SECURE` | `0` | HTTPS 接続を使用 |
| `CH_REQUIRED` | `0` | CH が利用できない場合は起動を拒否 |
| `CH_AUTO_CREATE_TABLES` | `1` | 初回起動時にテーブルを自動作成 |
| `CH_WRITE_MAX_PENDING_BATCHES` | `200` | 保留中の書き込みバッチの最大数 |
| `CH_UNHEALTHY_THRESHOLD` | `5` | 異常とみなすまでの連続失敗回数（SQLite へ自動フォールバック） |
| `STATS_QUERY_SOURCE` | `sqlite` | 読み取り元: `sqlite` / `auto` / `clickhouse` |
| `CH_COMPARE_ENABLED` | `0` | SQLite ↔ ClickHouse の整合性チェックを有効化 |
| `CH_EXTERNAL_HTTP_PORT` | `8123` | ClickHouse の HTTP 外部ポート（Compose のマッピング） |
| `CH_EXTERNAL_NATIVE_PORT` | `9000` | ClickHouse の Native 外部ポート（Compose のマッピング） |

> **ヘルスチェックとフォールバック**: 書き込みが `CH_UNHEALTHY_THRESHOLD` 回連続で失敗すると、システムは自動的に ClickHouse を異常とマークし、SQLite への書き込みを再開します。これは `CH_ONLY_MODE=1` の場合でも同様です。ClickHouse が復旧すると、再び正常とマークされ、ログに記録されます。

### 既存ユーザー向け移行ガイド

> SQLite のみのバージョンからアップグレードしますか？ **データは安全です。**
> SQLite ファイル（`./data/stats.db`）は完全に保持されます。推奨される段階的な移行手順は以下のとおりです:

#### フェーズ 1: デュアルライト（観察期間、推奨の開始点）

```env
CH_ENABLED=1
CH_WRITE_ENABLED=1
STATS_QUERY_SOURCE=sqlite   # Keep reading from SQLite while CH accumulates data
```

起動後、`[ClickHouse Writer]` のログを確認して、書き込みが成功していることを確かめます。

#### フェーズ 2: 読み取り元を切り替える

```env
STATS_QUERY_SOURCE=auto        # Smart routing: recent data from CH, historical from SQLite
# or
STATS_QUERY_SOURCE=clickhouse  # Force all reads to ClickHouse
```

#### フェーズ 3（オプション）: 履歴データを移行する

SQLite の履歴統計を ClickHouse に移すには:

```bash
# Standard migration (truncate CH then re-import, with consistency check)
./scripts/ch-migrate-docker.sh

# Append mode (keep existing CH data, incremental import)
./scripts/ch-migrate-docker.sh --append

# Specific time window
./scripts/ch-migrate-docker.sh --from 2026-02-01T00:00:00Z --to 2026-02-20T00:00:00Z
```

#### フェーズ 4（オプション）: CH のみモード

ClickHouse が安定して稼働するようになったら、SQLite への統計書き込みを停止します:

```env
CH_ONLY_MODE=1
```

> `CH_ONLY_MODE=1` の場合でも、ClickHouse が異常になるとシステムは自動的に SQLite への書き込みにフォールバックするため、データが失われることはありません。

### SQLite のみの構成に戻す

いつでも完全にロールバックできます:

```env
CH_ENABLED=0
CH_WRITE_ENABLED=0
CH_ONLY_MODE=0
STATS_QUERY_SOURCE=sqlite
```

再起動すると、すべてが純粋な SQLite モードに戻ります。履歴データはそのまま残ります。

---

## 🌐 リバースプロキシとトンネル

推奨の構成: Web と WS を同じドメインに置き、パスでルーティングします:
`/` → `3000`、`/_cm_ws` → `3002`。

### Nginx の標準例

```nginx
server {
  listen 443 ssl http2;
  server_name neko.example.com;

  location / {
    proxy_pass http://<neko-master-host>:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location ^~ /_cm_ws {
    proxy_pass http://<neko-master-host>:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering off;
  }
}
```

オプションの環境変数による上書き:

```env
# Not required by default (already /_cm_ws)
# NEXT_PUBLIC_WS_URL=/custom_ws
```

### Cloudflare Tunnel の標準例

`~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-name-or-id>
credentials-file: /path/to/<credentials>.json

ingress:
  - hostname: neko.example.com
    path: /_cm_ws*
    service: http://localhost:3002
  - hostname: neko.example.com
    path: /*
    service: http://localhost:3000
  - service: http_status:404
```

実行します:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run <your-tunnel-name-or-id>
```

Zero Trust ダッシュボードで管理するルート（トークンモード）の場合も、同じ 2 つのルートを設定し、`/_cm_ws*` を `/*` より上に置いてください。

### 重要な注意点

1. WS のパスに `ws`（先頭のスラッシュなし）を使わないでください。過剰にマッチして `/_next/static/...` → `426 Upgrade Required` を引き起こすことがあります
2. WS のルートは、すべてにマッチする `/*` より上に置く必要があります
3. `NEXT_PUBLIC_WS_URL` はデフォルトではオプションです。カスタマイズした場合は、変更後にフロントエンド/コンテナを再起動してください
4. `3000` のみをマッピングしても動作しますが、HTTP ポーリング（約 5 秒間隔）にフォールバックするため、リアルタイム性は低下します
5. `beacon.min.js`（Cloudflare の分析スクリプト）の失敗は、通常アプリの API/WS のデータフローとは無関係です
6. ほとんどの構成では、`/api` 用の追加のリバースプロキシルールは不要です。フロントエンドは同一オリジンの `/api` を使用し、アプリが `3001` への内部転送を処理します

> 注意: `/_next/static/... 426 Upgrade Required` は **設定に誤りのあるリバースプロキシ / トンネル** でよく見られます。プロキシを使わないローカルからの直接アクセスではまれです。

### マルチアーキテクチャ対応

Docker イメージは `linux/amd64` と `linux/arm64` の両方に対応しています。

### データの永続化

データはコンテナ内の `/app/data` に保存されます。データの消失を防ぐため、ホストにマウントしてください:

```yaml
volumes:
  - ./data:/app/data
```

### 最新版への更新

```bash
# Pull the latest image and restart
docker compose pull
docker compose up -d
```

## 🔐 認証とセキュリティ

Neko Master は、ダッシュボードのデータを保護するためのアクセス認証に対応しています。

### 本番環境のセキュリティベースライン

1. 固定の `COOKIE_SECRET` を設定してください（設定しないと、再起動後にセッションが無効になることがあります）。
2. 通常の運用時に `FORCE_ACCESS_CONTROL_OFF=true` を有効のままにしないでください。
3. `SHOWCASE_SITE_MODE=true` は公開デモ環境でのみ使用してください（書き込み操作が制限されます）。

例:

```env
COOKIE_SECRET=<at least 32-byte random string>
# FORCE_ACCESS_CONTROL_OFF=false
# SHOWCASE_SITE_MODE=false
```

### 認証の有効化 / 無効化

1. ダッシュボードを開き、サイドバー左下の「Settings」をクリックします。
2. 「Security」タブを開きます。
3. アクセス制御を有効化/無効化し、トークンを設定します。

### トークンを忘れた場合（緊急リセット）

トークンを忘れた場合は、一時的に `FORCE_ACCESS_CONTROL_OFF=true` を設定して緊急モードに入ります。

#### Docker Compose

1. `docker-compose.yml` に以下を追加します:

   ```yaml
   environment:
     - FORCE_ACCESS_CONTROL_OFF=true
   ```

2. 再起動します:

   ```bash
   docker compose up -d
   ```

3. ダッシュボードを開き、「Settings -> Security」でトークンをリセットします。
4. リセット後はただちにこの環境変数を削除し、再度再起動してください。

#### Docker CLI

1. コンテナを停止して削除します:

   ```bash
   docker stop neko-master
   docker rm neko-master
   ```

2. 緊急用フラグを付けて再実行します:

   ```bash
   docker run -d \
     --name neko-master \
     -p 3000:3000 \
     -v $(pwd)/data:/app/data \
     -e FORCE_ACCESS_CONTROL_OFF=true \
     foru17/neko-master:latest
   ```

3. トークンをリセットしたら、このフラグを外して通常どおり再起動します。


## ❓ FAQ

### Q: `3000:3000` のみを公開した状態で正常に動作しますか？

**A:** はい。コア機能は引き続き動作します。
WS がルーティングされていない場合、アプリは自動的に HTTP ポーリングにフォールバックします。
完全なリアルタイム体験を得るには、`/_cm_ws` を `3002` にルーティングしてください。

### Q: ポートが競合する、またはポート変更後にアクセスできなくなりましたか？

**A:** `.env`（`docker-compose.yml` と同じディレクトリ）を作成/更新します:

```env
WEB_EXTERNAL_PORT=8080
API_EXTERNAL_PORT=8081
WS_EXTERNAL_PORT=8082
```

その後、再起動します:

```bash
docker compose down
docker compose up -d
```

### Q: 再起動後にログイン/セッションが消えるのはなぜですか？

**A:** 通常は、`COOKIE_SECRET` が固定されていないか、データディレクトリが永続化されていないことが原因です。

1. 固定の `COOKIE_SECRET` を設定する
2. `./data:/app/data` をマウントする

### Q: ローカル MMDB 検索にはどのファイルが必要ですか？

**A:** プロジェクトディレクトリに `./geoip` を作成し（`docker-compose.yml` と同じ階層を推奨）、以下を配置します:

1. `GeoLite2-City.mmdb`（必須）
2. `GeoLite2-ASN.mmdb`（必須）
3. `GeoLite2-Country.mmdb`（オプション）

推奨の入手元: <https://github.com/P3TERX/GeoLite.mmdb>。
コンテナ内の検索パスは `/app/data/geoip` に固定されているため、
`./geoip:/app/data/geoip:ro` を維持してください。後で更新する場合は、ホストの `./geoip` 内のファイルを置き換えるだけです。

### Q: OpenClash / ゲートウェイに接続できませんか？

**A:** 以下を確認してください:

1. ゲートウェイ側で外部コントロールが有効になっている
2. ホスト/ポートが正しい
3. Token/Secret が正しい（設定している場合）
4. コンテナのネットワークからゲートウェイに到達できる

### Q: データのバックアップと復元はどうすればよいですか？

**A:** まずバックアップします:

```bash
cp -r ./data ./data-backup-$(date +%Y%m%d)
```

復元:

```bash
docker compose down
cp -r ./data-backup-YYYYMMDD/. ./data/
docker compose up -d
```

## 🏗️ アーキテクチャガイド

システム設計の詳細をすばやく理解したい場合は、以下の順序で読んでください:

1. **システムアーキテクチャ図**: エンドツーエンドのレイヤー構成と各モジュールの責務 → [docs/architecture.en.md](./docs/architecture.en.md)
2. **データフロー**: Clash / Surge の収集パイプラインと集計
3. **データモデルとストレージ**: SQLite のスキーマ、ClickHouse の Buffer テーブル、保持ポリシー
4. **リアルタイムチャネルの設計**: `RealtimeStore` のマージ戦略と WS プッシュ
5. **ClickHouse モジュール**: デュアルライトのアーキテクチャ、ヘルスチェックによるフォールバック、読み取りルーティング

ドキュメントの全体索引: [docs/README.md](./docs/README.md)

> このドキュメントでは、収集、集計、キャッシュ、リアルタイムプッシュ、マルチバックエンド管理のコア設計を扱っています。

## 🤝 フィードバックと Issue

本プロジェクトでは GitHub の Issue テンプレート（Bug / Feature / Support）を使用しています。

少なくとも以下の情報を含めてください:

1. デプロイ方法（Compose / Docker Run / Source）
2. バージョン情報（イメージのタグまたはコミット）
3. 主要な環境変数（マスク済み。例: `COOKIE_SECRET=***`）
4. 再現手順と、期待される動作と実際の動作
5. 主要なログ（`docker logs`、ブラウザのコンソール、ネットワークエラー）

## 📁 プロジェクト構成

```
neko-master/
├── docker-compose.yml      # Docker Compose config
├── Dockerfile              # Docker image build
├── setup.sh                # One-click setup script
├── docker-start.sh         # Docker container startup script
├── start.sh                # Source code dev startup script
├── docs/                   # Documentation (see docs/README.md)
│   ├── README.md           # Documentation index (English default)
│   ├── README.zh.md        # Documentation index (Chinese)
│   ├── README.en.md        # Documentation index (English mirror)
│   ├── architecture.md     # System architecture (Chinese)
│   ├── architecture.en.md  # System architecture (English)
│   ├── release-checklist.md
│   ├── agent/              # Agent docs (bilingual)
│   │   ├── overview.md / overview.en.md
│   │   ├── quick-start.md / quick-start.en.md
│   │   ├── install.md / install.en.md
│   │   ├── config.md / config.en.md
│   │   ├── release.md / release.en.md
│   │   └── troubleshooting.md / troubleshooting.en.md
│   ├── research/           # Research reports
│   └── dev/                # Internal development docs
├── assets/                 # Screenshots and icons
├── apps/
│   ├── collector/          # Data collection service (Node.js + WebSocket)
│   ├── agent/              # Agent daemon (Go)
│   └── web/                # Next.js frontend app
└── packages/
    └── shared/             # Shared types and utilities
```

## 🛠️ 技術スタック

- **フロントエンド**: [Next.js 16](https://nextjs.org/) + [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **スタイリング**: [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **チャート**: [Recharts](https://recharts.org/)
- **多言語対応**: [next-intl](https://next-intl-docs.vercel.app/)
- **バックエンド**: [Node.js](https://nodejs.org/) + [Fastify](https://www.fastify.io/) + WebSocket
- **データベース**: [SQLite](https://www.sqlite.org/)（[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)）+ [ClickHouse](https://clickhouse.com/)（オプション）
- **ビルド**: [pnpm](https://pnpm.io/) + [Turborepo](https://turbo.build/)

## 🤝 コントリビューション

コントリビューションを歓迎します！

- 🐛 [バグを報告](https://github.com/foru17/neko-master/issues/new)
- 💡 [機能をリクエスト](https://github.com/foru17/neko-master/issues/new)
- 🔧 [コードで貢献](https://github.com/foru17/neko-master/pulls)

PR を作成する前に、[CONTRIBUTING.md](./CONTRIBUTING.md)（ワークフロー、チェック、i18n/ダークモードの要件）をお読みください。

**AI コーディングツールで開発していますか？**（Claude Code、Copilot、Cursor、Codex など）[AGENTS.md](./AGENTS.md)（規約、主要な契約、プロジェクトマップ）と、[`.claude/skills/`](./.claude/skills/) にあるタスク別のワークフローガイドをツールに読み込ませてください。Claude Code はどちらも自動的に読み込みます。

## 📄 ライセンス

[MIT](LICENSE) © [foru17](https://github.com/foru17)

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=foru17/neko-master&type=date&legend=top-left)](https://www.star-history.com/#foru17/neko-master&type=date&legend=top-left)

---

<p align="center">
  <sub>Made with ❤️ by <a href="https://github.com/foru17">@foru17</a></sub><br>
  <sub>このプロジェクトが役に立ったら、ぜひ ⭐ をお願いします</sub>
</p>
