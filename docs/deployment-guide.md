# 部署说明

## 一、当前部署方式

**模型推理部署于华为云 ModelArts Studio 云端，Web 应用支持本地与云端两种运行方式。**

| 部分 | 位置 | 说明 |
|------|------|------|
| 模型推理 | 华为云 ModelArts Studio | 通过兼容 OpenAI 协议的接口调用，密钥只放在本机 `.env` |
| Web 应用（本地方式） | 演示电脑 | `npm run dev` 或 `npm run build && npm start` |
| Web 应用（云端方式） | 华为云 ECS | 拿到实例后按下文第四节部署 |

当前没有 ECS 实例，比赛演示使用本地运行方式；拿到 ECS 后按第四节操作即可，代码不需要改动。

## 二、本地运行（演示用）

1. 安装 Node.js 22 或更高版本。
2. 在项目根目录执行 `npm install`。
3. 准备 `.env`（参照《使用说明》第二节）。
4. 开发模式：`npm run dev`，浏览器打开 http://localhost:3000 。
5. 正式模式：
   ```
   npm run build
   npm start
   ```
   默认也是 http://localhost:3000 。

## 三、生产构建自检

| 检查项 | 命令 | 期望结果 |
|--------|------|----------|
| 类型检查 | `npm run typecheck` | 无报错 |
| 单元测试 | `npx vitest run` | 全部通过 |
| 构建 | `npm run build` | 生成成功，无报错 |
| 健康检查 | 浏览器访问 `/api/health` | 返回 `ok: true`，表数量 9 以内 |

## 四、部署到华为云 ECS（拿到实例后执行）

### 第 1 步：准备服务器

1. 购买一台 ECS（2 核 4G 起步即可），操作系统选 Ubuntu 22.04。
2. 安全组放行 22（远程登录）、80（网站）、443（HTTPS，可选）。
3. 用 SSH 登录服务器。

### 第 2 步：安装运行环境

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
node -v
```

### 第 3 步：上传代码

在本地项目根目录执行（把 `<服务器IP>` 换成实际地址）：

```
scp -r ./* root@<服务器IP>:/opt/smart-learning-planner/
```

也可以在服务器上用 Git 拉取仓库。

### 第 4 步：配置环境变量

在服务器上创建 `/opt/smart-learning-planner/.env`，内容与本地一致（模型地址、密钥、两个模型名）。密钥只放在服务器本机。

### 第 5 步：安装依赖并构建

```
cd /opt/smart-learning-planner
npm install --production=false
npm run build
```

### 第 6 步：常驻运行

```
sudo npm install -g pm2
pm2 start npm --name smart-learning -- start
pm2 save
pm2 startup
```

### 第 7 步：配置 Nginx 反向代理

新建 `/etc/nginx/sites-available/smart-learning`：

```
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

启用并重启：

```
sudo ln -s /etc/nginx/sites-available/smart-learning /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 第 8 步：验证

1. 电脑浏览器打开 `http://<服务器IP>`，确认首页能打开。
2. 手机浏览器打开同一地址，确认没有横向滚动。
3. 访问 `/api/health`，确认返回 `ok: true`。
4. 走一遍"说目标 → 出计划"，确认云端模型能正常调用。

## 五、数据与备份

- 学习数据在 `data/learning-planner.db`。
- 备份：`cp data/learning-planner.db backups/learning-planner-$(date +%F).db`
- 恢复：停服务，把备份文件覆盖回 `data/learning-planner.db`，再启动。

## 六、回滚

保留上一版代码目录和数据库备份。出问题时：

```
pm2 stop smart-learning
cp backups/<上一版数据库>.db data/learning-planner.db
（切回上一版代码目录）
pm2 start smart-learning
```

## 七、注意事项

1. `.env` 不要提交到代码仓库，也不要写进文档或截图。
2. 模型密钥泄露时，第一时间在华为云控制台重置。
3. 演示电脑建议关闭自动睡眠，避免录屏中途断网断服务。