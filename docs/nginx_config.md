# Configuracao Nginx para AppFut Meta API

## Objetivo
Expor a porta 3000 (Express/webhook) publicamente via HTTPS.
A Meta exige HTTPS para o webhook — o Nginx faz o SSL termination.

## Opcao A — Dominio proprio (recomendado)

### 1. Instalar Nginx e Certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Criar configuracao do site

```bash
sudo nano /etc/nginx/sites-available/appfut
```

Cole o conteudo abaixo (substitua `SEU_DOMINIO` pelo seu dominio):

```nginx
server {
    listen 80;
    server_name SEU_DOMINIO;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

### 3. Ativar o site

```bash
sudo ln -s /etc/nginx/sites-available/appfut /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Certificado SSL gratuito (Let's Encrypt)

```bash
sudo certbot --nginx -d SEU_DOMINIO
```

Certbot atualiza automaticamente o nginx.conf com HTTPS.

### 5. Verificar

```bash
curl https://SEU_DOMINIO/health
# Esperado: {"status":"ok","ts":"..."}
```

---

## Opcao B — IP direto via ngrok (para testes rapidos)

Sem dominio, use o ngrok para expor temporariamente:

```bash
# Instalar ngrok
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/ngrok.gpg
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok

# Configurar token (crie conta em ngrok.com)
ngrok config add-authtoken SEU_TOKEN_NGROK

# Expor porta 3000
ngrok http 3000
```

O ngrok gera uma URL como `https://abc123.ngrok.io` — use como webhook URL no Meta Dashboard.

**Atencao:** URL do ngrok muda a cada reinicio (plano gratuito). Use so para testes.

---

## DNS (se usando dominio proprio)

No painel do seu dominio, crie um registro A:
```
Tipo: A
Nome: bot (ou @)
Valor: 31.97.94.250
TTL: 3600
```

Resultado: `https://bot.seudominio.com/webhook`
