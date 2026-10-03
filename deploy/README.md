# さくらVPS (Ubuntu) へのデプロイ手順

構成：

```
ブラウザ ──HTTPS──▶ nginx ─┬─ 静的ファイル (/opt/pickle-stars/dist)
                            └─ /ws ──▶ Node.js ゲームサーバー (127.0.0.1:3000)
```

Ubuntu 22.04 / 24.04 を想定しています。`example.com` は自分のドメインに置き換えてください。

## 0. 事前準備

- ドメインの A レコードを VPS の IP アドレスに向けておく（HTTPS 化に必要です）
- さくらのコントロールパネルで **パケットフィルター** を使っている場合は、
  **TCP 80 (HTTP) と 443 (HTTPS)** を許可する
- ufw を使っている場合:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 1. Node.js 22 と nginx を入れる

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git
node -v   # v22.x になっていれば OK
```

## 2. 実行ユーザーとソースの配置

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin pickle
sudo mkdir -p /opt/pickle-stars
sudo chown pickle:pickle /opt/pickle-stars
```

ソースの置き方はどちらか:

- **Git を使う場合（おすすめ）**: GitHub 等に push しておき
  `sudo -u pickle git clone <リポジトリURL> /opt/pickle-stars`
- **手元からコピーする場合**: Windows の PowerShell で
  `scp -r D:\gameProject\pickle_stars\* ユーザー名@サーバーIP:/tmp/pickle-stars/` を実行し、
  サーバーで `sudo cp -r /tmp/pickle-stars/. /opt/pickle-stars/ && sudo chown -R pickle:pickle /opt/pickle-stars`
  （`node_modules` と `dist` はコピー不要です）

## 3. ビルド

```bash
cd /opt/pickle-stars
sudo -u pickle npm ci
sudo -u pickle npm test        # ルールのテスト (数秒)
sudo -u pickle npm run build   # dist/ が作られる
```

## 4. ゲームサーバーを常駐させる (systemd)

```bash
sudo cp /opt/pickle-stars/deploy/pickle-stars.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pickle-stars
sudo systemctl status pickle-stars       # active (running) を確認
curl http://127.0.0.1:3000/healthz       # {"ok":true,...} が返れば OK
```

ログは `journalctl -u pickle-stars -f` で見られます。

## 5. nginx の設定

```bash
sudo cp /opt/pickle-stars/deploy/nginx-pickle-stars.conf /etc/nginx/sites-available/pickle-stars
sudo nano /etc/nginx/sites-available/pickle-stars   # server_name を自分のドメインに変更
sudo ln -s /etc/nginx/sites-available/pickle-stars /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

この時点で `http://example.com` で遊べます。

## 6. HTTPS 化 (Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com
```

certbot が nginx 設定に HTTPS を追記し、自動更新も設定します。
ページを HTTPS で開くと、クライアントは自動的に `wss://` で接続します。

## 更新するとき

```bash
sudo -u pickle bash /opt/pickle-stars/deploy/update.sh
sudo systemctl restart pickle-stars
```

ゲームサーバーを再起動すると、その時点で対戦中の試合は切断されます。

## 環境変数

| 変数 | 既定値 | 内容 |
|---|---|---|
| `PORT` | 3000 | 待ち受けポート |
| `HOST` | 0.0.0.0 | 待ち受けアドレス (nginx の後ろでは 127.0.0.1) |
| `MAX_ROOMS` | 500 | 同時に作れるルーム数の上限 |

## サーバー負荷の目安

1 試合あたり 60Hz で物理を計算し、30Hz で状態を送ります（1 人あたり約 6〜8KB/秒）。
さくらVPS の 1GB プランでも数百試合程度は同時にさばける見込みです。
