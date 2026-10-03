# さくらVPS (Ubuntu + nginx) へのデプロイ

公開URL: **https://elefolo2.com/games/pickle_stars/**

```
ブラウザ ──HTTPS──▶ nginx (elefolo2.com) ─┬─ /games/pickle_stars/     → 静的ファイル (/opt/pickle-stars/dist)
                                          └─ /games/pickle_stars/ws   → Node.js ゲームサーバー (127.0.0.1:3000)
```

`main` ブランチに push すると GitHub Actions (`.github/workflows/deploy.yml`) が
テスト → ビルド → rsync で VPS へ転送 → `npm ci --omit=dev` → ゲームサーバー再起動 → ヘルスチェック
まで自動で行います。Actions の画面から「Run workflow」で手動実行もできます。

VPS 側に GitHub の認証情報は置きません（Actions から SSH で送り込む方式）。

## 初回セットアップ（VPS で 1 回だけ）

Ubuntu 22.04 / 24.04、elefolo2.com の nginx と HTTPS (certbot など) は設定済みの前提です。

### 1. Node.js 22 と rsync

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs rsync
node -v   # v22.x
```

### 2. デプロイ用ユーザーと実行用ユーザー

- `deploy` … GitHub Actions が SSH で入るユーザー。ファイルを置き、サービスを再起動するだけ
- `pickle` … ゲームサーバーを動かすユーザー（ログイン不可）

```bash
sudo useradd --create-home --shell /bin/bash deploy
sudo useradd --system --create-home --shell /usr/sbin/nologin pickle
sudo mkdir -p /opt/pickle-stars
sudo chown deploy:deploy /opt/pickle-stars
# 起動失敗時のログを Actions から読めるように
sudo usermod -aG systemd-journal deploy
```

`deploy` にはサービスの再起動だけをパスワードなしで許可します:

```bash
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart pickle-stars' | sudo tee /etc/sudoers.d/pickle-stars-deploy
sudo chmod 440 /etc/sudoers.d/pickle-stars-deploy
sudo visudo -c
```

### 3. デプロイ用の SSH 鍵

手元の PC で専用の鍵を作ります（パスフレーズなし。Windows の PowerShell でも同じコマンドで作れます）:

```bash
ssh-keygen -t ed25519 -C "github-actions-pickle-stars" -f pickle_deploy -N ""
```

公開鍵 `pickle_deploy.pub` の 1 行を VPS の `deploy` ユーザーに登録します:

```bash
sudo mkdir -p /home/deploy/.ssh
sudo nano /home/deploy/.ssh/authorized_keys   # pickle_deploy.pub の中身を貼り付け
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

手元から `ssh -i pickle_deploy deploy@<VPSのIP>` で入れれば OK です。

### 4. systemd ユニット

このリポジトリの `deploy/pickle-stars.service` の内容を `/etc/systemd/system/pickle-stars.service` に保存して:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pickle-stars
```

起動は最初のデプロイで行われます。ポート 3000 をほかのアプリが使っている場合は、
ユニットの `PORT`、nginx 設定の `127.0.0.1:3000`、ワークフローのヘルスチェックの `3000` をそろえて変更してください。

### 5. nginx

`deploy/nginx-pickle-stars.conf` の内容を `/etc/nginx/snippets/pickle-stars.conf` に保存し、
elefolo2.com の **HTTPS 側の** `server { ... }` ブロックの中に 1 行追加します:

```nginx
server {
    server_name elefolo2.com;
    listen 443 ssl;
    # ...既存の設定...
    include /etc/nginx/snippets/pickle-stars.conf;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

このスニペットは `/games/pickle_stars`（末尾スラッシュなし）を `/games/pickle_stars/` へ転送します。
クライアントはアセットと WebSocket を相対パスで参照しているため、末尾スラッシュが無いと正しく読み込めません。
HTTPS で開けば WebSocket は自動的に `wss://elefolo2.com/games/pickle_stars/ws` に接続します。

### 6. GitHub の Secrets を登録

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で登録します。

| 名前 | 内容 |
|---|---|
| `SSH_HOST` | VPS の IP アドレス（またはホスト名） |
| `SSH_USER` | `deploy` |
| `SSH_PORT` | SSH のポート（22 なら登録不要） |
| `SSH_PRIVATE_KEY` | 秘密鍵ファイル `pickle_deploy` の中身全体（`-----BEGIN` から `END ... KEY-----` まで） |
| `SSH_KNOWN_HOSTS` | 手元で `ssh-keyscan -p <SSHのポート> <VPSのIP>` を実行した出力全体 |

`SSH_KNOWN_HOSTS` は接続先が本物の VPS かを確かめるためのものです（なりすまし対策）。

登録したら Actions タブの Deploy ワークフローを「Run workflow」で実行するか、main に push します。
成功すると https://elefolo2.com/games/pickle_stars/ で遊べます。

## 運用

- ログ: `journalctl -u pickle-stars -f`
- 状態確認: `curl https://elefolo2.com/games/pickle_stars/healthz`
- デプロイ（再起動）の瞬間に対戦中だった試合は切断されます。
- さくらのパケットフィルターや ufw で SSH の接続元を絞っている場合は、GitHub Actions から届くようにしておいてください。

## 環境変数（systemd ユニットで設定）

| 変数 | 既定値 | 内容 |
|---|---|---|
| `PORT` | 3000 | 待ち受けポート |
| `HOST` | 0.0.0.0 | 待ち受けアドレス (nginx の後ろでは 127.0.0.1) |
| `MAX_ROOMS` | 500 | 同時に作れるルーム数の上限 |

## サーバー負荷の目安

1 試合あたり 60Hz で物理を計算し、30Hz で状態を送ります（1 人あたり約 6〜8KB/秒）。
さくらVPS の 1GB プランでも数百試合程度は同時にさばける見込みです。
