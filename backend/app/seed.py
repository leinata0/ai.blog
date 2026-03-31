from app.models import Post, Tag

PYTHON_ARTICLE = """\
# Python 自动化实战：Selenium 与 Pandas 结合

## 一、为什么选择 Selenium + Pandas？

在日常开发和数据分析中，我们经常面对这样的场景：数据藏在需要登录、翻页、点击才能看到的网页里，而最终我们需要的是一张干净的 Excel 表格。Selenium 负责"操作浏览器"，Pandas 负责"整理数据"，两者结合就是一条完整的自动化流水线。

| 工具 | 职责 | 核心能力 |
|------|------|---------|
| Selenium | 浏览器自动化 | 模拟点击、填表、翻页、截图 |
| Pandas | 数据处理 | 清洗、转换、聚合、导出 |
| ChromeDriver | 浏览器驱动 | 连接 Selenium 与 Chrome |

## 二、环境搭建

```bash
# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate

# 安装依赖
pip install selenium pandas openpyxl webdriver-manager
```

> **Tips:** 使用 `webdriver-manager` 可以自动下载匹配版本的 ChromeDriver，省去手动管理驱动的麻烦。

## 三、实战：抓取课程成绩并生成报表

### 3.1 初始化浏览器

```python
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

options = webdriver.ChromeOptions()
options.add_argument("--headless")  # 无头模式，不弹窗
options.add_argument("--disable-gpu")

driver = webdriver.Chrome(
    service=Service(ChromeDriverManager().install()),
    options=options
)
```

### 3.2 登录并导航

```python
driver.get("https://example-edu.com/login")

# 等待登录表单加载
WebDriverWait(driver, 10).until(
    EC.presence_of_element_located((By.ID, "username"))
)

driver.find_element(By.ID, "username").send_keys("student_id")
driver.find_element(By.ID, "password").send_keys("password")
driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()

# 等待跳转完成
WebDriverWait(driver, 10).until(EC.url_contains("/dashboard"))
```

### 3.3 抓取表格数据

```python
driver.get("https://example-edu.com/grades")

# 等待成绩表格渲染
table = WebDriverWait(driver, 10).until(
    EC.presence_of_element_located((By.CSS_SELECTOR, "table.grades"))
)

rows = table.find_elements(By.TAG_NAME, "tr")
data = []
for row in rows[1:]:  # 跳过表头
    cols = row.find_elements(By.TAG_NAME, "td")
    data.append({
        "课程": cols[0].text,
        "学分": float(cols[1].text),
        "成绩": float(cols[2].text),
        "绩点": float(cols[3].text),
    })

driver.quit()
```

### 3.4 Pandas 清洗与导出

```python
import pandas as pd

df = pd.DataFrame(data)

# 计算加权平均绩点
df["加权绩点"] = df["学分"] * df["绩点"]
gpa = df["加权绩点"].sum() / df["学分"].sum()
print(f"GPA: {gpa:.2f}")

# 按绩点降序排列
df = df.sort_values("绩点", ascending=False)

# 导出 Excel
df.to_excel("grades_report.xlsx", index=False, sheet_name="成绩单")
```

## 四、进阶技巧

### 4.1 处理动态加载（Infinite Scroll）

```python
import time

last_height = driver.execute_script("return document.body.scrollHeight")
while True:
    driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(2)
    new_height = driver.execute_script("return document.body.scrollHeight")
    if new_height == last_height:
        break
    last_height = new_height
```

### 4.2 异常重试装饰器

```python
from functools import wraps

def retry(max_attempts=3, delay=1):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts - 1:
                        raise
                    time.sleep(delay * (attempt + 1))
        return wrapper
    return decorator

@retry(max_attempts=3)
def fetch_page(driver, url):
    driver.get(url)
```

## 五、常见坑与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| `ElementNotInteractableException` | 元素被遮挡或未渲染完成 | 使用 `WebDriverWait` 显式等待 |
| `StaleElementReferenceException` | DOM 已更新，引用失效 | 重新定位元素 |
| ChromeDriver 版本不匹配 | Chrome 自动更新 | 使用 `webdriver-manager` |
| 数据编码乱码 | 网页编码与 Python 不一致 | 指定 `encoding='utf-8'` |

## 六、总结

Selenium + Pandas 的组合拳适合处理"需要交互才能获取的结构化数据"。核心思路是：**Selenium 负责到达数据所在的页面状态，Pandas 负责将原始数据转化为有价值的信息**。掌握这套工作流后，无论是抓取成绩、监控价格还是批量填表，都能快速搭建自动化脚本。

> 自动化不是偷懒，而是把时间花在更有价值的事情上。
"""

CPP_ARTICLE = """\
# C/C++ 核心概念学习与排坑记录

## 一、指针：最强大也最危险的武器

指针是 C/C++ 的灵魂，也是新手的噩梦。理解指针的关键在于：**指针是一个存储内存地址的变量，而不是数据本身。**

### 1.1 指针 vs 引用

```cpp
int x = 42;
int* ptr = &x;   // 指针：存储 x 的地址
int& ref = x;    // 引用：x 的别名

*ptr = 100;      // 通过指针修改 x
ref = 200;       // 通过引用修改 x
```

| 特性 | 指针 | 引用 |
|------|------|------|
| 可以为空 | 是（`nullptr`） | 否 |
| 可以重新绑定 | 是 | 否 |
| 需要解引用 | 是（`*ptr`） | 否 |
| 支持算术运算 | 是（`ptr++`） | 否 |

### 1.2 悬空指针（Dangling Pointer）

```cpp
int* create_dangling() {
    int local = 42;
    return &local;  // 危险！local 在函数返回后被销毁
}

int* ptr = create_dangling();
// ptr 现在指向已释放的栈内存 -> 未定义行为
```

**修复方案：** 使用堆分配或智能指针。

```cpp
#include <memory>

std::unique_ptr<int> create_safe() {
    return std::make_unique<int>(42);  // 堆上分配，自动管理生命周期
}
```

## 二、内存管理：手动挡的艺术

### 2.1 栈 vs 堆

```
┌─────────────────────┐  高地址
│       栈 (Stack)     │  ← 自动分配/释放，速度快
│  局部变量、函数参数    │
├─────────────────────┤
│         ↓           │
│       空闲区域       │
│         ↑           │
├─────────────────────┤
│       堆 (Heap)      │  ← 手动分配/释放，灵活
│  new/malloc 分配的    │
├─────────────────────┤
│    全局/静态变量      │
├─────────────────────┤
│       代码段         │
└─────────────────────┘  低地址
```

### 2.2 内存泄漏检测

```cpp
// 经典内存泄漏
void leak_example() {
    int* arr = new int[1000];
    if (some_condition) {
        return;  // 提前返回，arr 永远不会被 delete
    }
    delete[] arr;
}

// RAII 修复
void safe_example() {
    auto arr = std::make_unique<int[]>(1000);
    if (some_condition) {
        return;  // unique_ptr 析构时自动释放
    }
    // 不需要手动 delete
}
```

> **RAII 原则（Resource Acquisition Is Initialization）：** 将资源的生命周期绑定到对象的生命周期，利用析构函数自动释放资源。

## 三、对象生命周期与移动语义

### 3.1 Rule of Five

如果你的类管理资源（如堆内存），需要定义以下五个特殊成员函数：

```cpp
class Buffer {
    int* data_;
    size_t size_;
public:
    // 1. 构造函数
    Buffer(size_t size) : data_(new int[size]), size_(size) {}

    // 2. 析构函数
    ~Buffer() { delete[] data_; }

    // 3. 拷贝构造
    Buffer(const Buffer& other) : data_(new int[other.size_]), size_(other.size_) {
        std::copy(other.data_, other.data_ + size_, data_);
    }

    // 4. 拷贝赋值
    Buffer& operator=(const Buffer& other) {
        if (this != &other) {
            delete[] data_;
            size_ = other.size_;
            data_ = new int[size_];
            std::copy(other.data_, other.data_ + size_, data_);
        }
        return *this;
    }

    // 5. 移动构造
    Buffer(Buffer&& other) noexcept : data_(other.data_), size_(other.size_) {
        other.data_ = nullptr;
        other.size_ = 0;
    }
};
```

### 3.2 `std::move` 的本质

`std::move` 并不移动任何东西——它只是将左值转换为右值引用，**允许**移动构造/赋值被调用。

```cpp
std::string a = "Hello";
std::string b = std::move(a);  // a 的内容被"偷走"，a 变为空
// a 仍然是有效对象，但内容未定义（通常为空）
```

## 四、编译链接：从源码到可执行文件

### 4.1 编译四阶段

```
源码(.cpp) → 预处理(.i) → 编译(.s) → 汇编(.o) → 链接(可执行文件)
```

```bash
# 查看每个阶段的输出
g++ -E main.cpp -o main.i    # 预处理：展开宏和 #include
g++ -S main.cpp -o main.s    # 编译：生成汇编代码
g++ -c main.cpp -o main.o    # 汇编：生成目标文件
g++ main.o utils.o -o app    # 链接：合并目标文件
```

### 4.2 常见链接错误

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `undefined reference to 'func'` | 函数声明了但没定义 | 检查是否忘记编译某个 .cpp |
| `multiple definition of 'var'` | 全局变量在头文件中定义 | 使用 `inline` 或 `extern` |
| `undefined reference to vtable` | 虚函数声明了但没实现 | 补全虚函数的定义 |

## 五、实用调试技巧

```bash
# 使用 AddressSanitizer 检测内存错误
g++ -fsanitize=address -g main.cpp -o app
./app  # 内存越界、use-after-free 会被即时报告

# 使用 Valgrind 检测内存泄漏
valgrind --leak-check=full ./app
```

## 六、总结

C/C++ 的学习曲线陡峭，但每一个"坑"都是对计算机底层原理的深入理解。建议的学习路径：

1. **先理解内存模型** → 栈、堆、指针
2. **再掌握对象生命周期** → 构造、析构、RAII
3. **然后学习现代 C++ 特性** → 智能指针、移动语义、`auto`
4. **最后深入编译链接** → 理解从源码到二进制的完整过程

> 每一次 Segfault 都是成长的勋章。
"""

OPENCLAW_ARTICLE = """\
# OpenClaw 部署指南：从零搭建你的私有化平台

## 一、OpenClaw 是什么？

OpenClaw 是一个轻量级的开源平台，专为个人开发者和小团队设计，支持快速私有化部署。它提供了项目管理、文档协作和 API 网关等核心功能，可以理解为一个"自托管的轻量级工作台"。

### 为什么选择私有化部署？

| 对比维度 | SaaS 服务 | 私有化部署 |
|---------|----------|-----------|
| 数据控制 | 数据存储在第三方 | 完全自主掌控 |
| 定制能力 | 受限于平台功能 | 可自由修改源码 |
| 网络依赖 | 需要公网访问 | 可纯内网运行 |
| 长期成本 | 按月/年订阅 | 一次部署，持续使用 |

## 二、环境准备

### 2.1 硬件要求

```
最低配置：
├── CPU: 2 核
├── 内存: 4 GB
├── 磁盘: 20 GB SSD
└── 网络: 公网 IP（可选）

推荐配置：
├── CPU: 4 核
├── 内存: 8 GB
├── 磁盘: 50 GB SSD
└── 网络: 公网 IP + 域名
```

### 2.2 软件依赖

```bash
# 检查 Docker 版本（需要 20.10+）
docker --version

# 检查 Docker Compose 版本（需要 V2）
docker compose version

# 如果未安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

## 三、部署实战

### 3.1 克隆项目

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
```

### 3.2 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，修改关键配置：

```env
# 数据库配置
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=openclaw

# 应用密钥（务必修改！）
SECRET_KEY=generate-a-random-64-char-string

# 域名配置（如果有）
DOMAIN=claw.yourdomain.com
PROTOCOL=https

# 端口配置
HTTP_PORT=8080
```

> **安全提醒：** `SECRET_KEY` 必须使用随机字符串，可以用 `openssl rand -hex 32` 生成。

### 3.3 启动服务

```bash
# 拉取镜像并启动所有服务
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f --tail=100
```

启动后的服务架构：

```
┌─────────────────────────────────────────┐
│              Nginx (反向代理)             │
│              Port: 8080                  │
├──────────────┬──────────────────────────┤
│   Frontend   │      Backend API         │
│   (静态文件)  │      (Python/Go)         │
├──────────────┴──────────────────────────┤
│            PostgreSQL                    │
│            Port: 5432                    │
├─────────────────────────────────────────┤
│            Redis (缓存)                  │
│            Port: 6379                    │
└─────────────────────────────────────────┘
```

### 3.4 初始化与验证

```bash
# 执行数据库迁移
docker compose exec backend python manage.py migrate

# 创建管理员账号
docker compose exec backend python manage.py createsuperuser

# 验证服务健康状态
curl http://localhost:8080/api/health
# 期望输出: {"status": "ok"}
```

## 四、配置调优

### 4.1 性能优化

```yaml
# docker-compose.override.yml
services:
  backend:
    environment:
      - WORKERS=4           # 匹配 CPU 核数
      - MAX_CONNECTIONS=100 # 数据库连接池上限
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2.0'

  postgres:
    command: >
      postgres
        -c shared_buffers=256MB
        -c effective_cache_size=1GB
        -c work_mem=4MB
        -c max_connections=200
    volumes:
      - /mnt/ssd/pgdata:/var/lib/postgresql/data  # SSD 挂载
```

### 4.2 HTTPS 配置（Let's Encrypt）

```bash
# 安装 certbot
sudo apt install certbot

# 获取证书
sudo certbot certonly --standalone -d claw.yourdomain.com

# 配置 Nginx SSL（在 nginx.conf 中添加）
```

```nginx
server {
    listen 443 ssl http2;
    server_name claw.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/claw.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/claw.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://frontend:3000;
    }

    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 五、备份与恢复

### 5.1 自动备份脚本

```bash
#!/bin/bash
# backup.sh - 每日自动备份
BACKUP_DIR="/backups/openclaw"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份数据库
docker compose exec -T postgres pg_dump -U openclaw openclaw \\
    | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

# 备份上传文件
tar czf "$BACKUP_DIR/uploads_$DATE.tar.gz" ./data/uploads/

# 保留最近 30 天的备份
find $BACKUP_DIR -mtime +30 -delete

echo "Backup completed: $DATE"
```

```bash
# 添加到 crontab，每天凌晨 3 点执行
echo "0 3 * * * /opt/openclaw/backup.sh" | crontab -
```

### 5.2 恢复数据

```bash
# 恢复数据库
gunzip -c db_20260330_030000.sql.gz | \\
    docker compose exec -T postgres psql -U openclaw openclaw

# 恢复上传文件
tar xzf uploads_20260330_030000.tar.gz -C ./data/
```

## 六、常见问题排查

| 症状 | 可能原因 | 排查命令 | 解决方案 |
|------|---------|---------|---------|
| 容器启动失败 | 端口被占用 | `lsof -i :8080` | 修改 `HTTP_PORT` 或停止占用进程 |
| 数据库连接超时 | 网络隔离 | `docker network ls` | 确保服务在同一 network |
| 页面 502 | 后端未就绪 | `docker compose logs backend` | 等待启动完成或检查配置 |
| 上传文件丢失 | 未挂载 volume | `docker inspect <container>` | 检查 volumes 配置 |
| 内存不足 OOM | 资源限制过低 | `docker stats` | 增加 memory limit |

## 七、总结

私有化部署的核心流程：**准备环境 → 配置参数 → 启动服务 → 调优加固 → 定期备份**。OpenClaw 的 Docker Compose 架构让整个过程相对简单，但生产环境中仍需关注安全加固、性能监控和灾备恢复。

> 部署不是终点，而是运维的起点。保持对日志的敏感，对备份的执着。
"""

FULLSTACK_ARTICLE = """\
# 大一新生的全栈破局：AI 辅助构建极客博客的实战复盘

## 一、极客起航：为什么要自己造一个博客？

作为一名大一计算机专业的学生，我的课余时间几乎都泡在终端和编辑器里。用 Python 写 Selenium + Pandas 自动化脚本抓数据、啃 C/C++ 的指针与内存管理、研究 OpenClaw 开源项目的私有化部署——这些"硬核折腾"构成了我大学生活的主旋律。

零散的笔记越攒越多，我迫切需要一个属于自己的发布平台——不是在第三方博客上写，而是从前端到后端、从数据库到部署，全部自己掌控。正好学校的 AI 编程挑战赛给了我一个契机：用 AI 辅助，从零搭建一个全栈极客博客，并把它部署到公网。

## 二、架构大图：三层分离，各司其职

经过调研，我选定了一套轻量但完整的技术栈：

| 层级 | 技术选型 | 托管平台 |
|------|---------|---------|
| 前端 | React + Vite + Tailwind CSS | Vercel |
| 后端 | Python FastAPI + SQLAlchemy ORM | Render |
| 数据库 | SQLite（文件型，零运维） | Render 持久化磁盘 |

**前端**使用 React 搭配 Vite 构建，Tailwind CSS 负责极客风格的暗色主题 UI。通过 Vercel 的 Git 集成，每次 push 自动触发构建部署，体验丝滑。

**后端**选择 FastAPI，原因很简单：Python 是我最熟悉的语言，FastAPI 的异步性能和自动生成 API 文档的能力让开发效率拉满。SQLAlchemy 作为 ORM 层，让我不用手写 SQL 就能完成数据建模。

**数据库**用 SQLite 而非 PostgreSQL，是因为个人博客的并发量极低，SQLite 的零配置特性省去了大量运维成本。一个 `.db` 文件就是整个数据库，备份只需复制文件。

前后端通过 RESTful API 通信，Vercel 端配置了 `rewrites` 规则，将 `/api/*` 请求代理到 Render 上的后端服务，实现了跨域无感调用。

## 三、踩坑与反杀：Render 部署的三重关卡

本地开发一路顺畅，真正的挑战从部署 Render 开始。

### 关卡一：持久化磁盘的"付费墙"

SQLite 的数据存储在文件里，而 Render 免费实例每次重启都会重置文件系统。这意味着——每次服务休眠唤醒，我的博客文章就全没了。

解决方案是挂载 Render 的 Persistent Disk，把 `blog.db` 放到持久化路径 `/data` 下。但这个功能需要 Starter Plan 起步，于是我绑定了支付方式升级到付费计划。这一步还顺带解除了 Render 的"防滥用限制"，后续部署再也没被卡过。

### 关卡二：配置文件的连环修改

挂载磁盘后，需要同步修改多处配置：

- `render.yaml`：声明 disk 挂载点和容量
- `Dockerfile`：确保数据目录存在并设置正确权限
- `db.py`：通过环境变量 `DATABASE_URL` 指向 `/data/blog.db`
- Render Dashboard：手动配置环境变量和磁盘绑定

任何一处遗漏都会导致服务启动失败或数据写入临时目录。我前后调试了好几轮，Claude Code 在这个过程中帮我逐一排查配置项，省去了大量翻文档的时间。

### 关卡三：消失的 Dockerfile

最惊险的一幕发生在某次 git 操作后——Dockerfile 不见了。Render 构建直接报错，服务下线。当时我心态差点崩了，但冷静下来后，通过 `git log` 和 `git show` 找回了文件内容，重新提交后服务恢复。这次事故让我深刻体会到：**版本控制不是可选项，而是救命绳。**

## 四、人机协作感悟：终端里的 AI 搭档

整个项目从零到上线，Claude Code 作为终端 AI 助手全程参与。以下是我最深的几点体会：

**1. 脚手架搭建效率惊人。** 项目初始化阶段，从 FastAPI 项目结构、SQLAlchemy 模型定义、React 路由配置到 Tailwind 主题定制，Claude Code 能在几分钟内生成完整的可运行代码框架。对于大一学生来说，这相当于跳过了最枯燥的"从零配置"阶段，直接进入业务逻辑开发。

**2. 部署排错的"第二双眼睛"。** Render 部署过程中的配置问题往往涉及多个文件的联动修改，人工逐一排查容易遗漏。Claude Code 能快速定位配置不一致的地方，并给出修复方案，这在 Dockerfile、render.yaml、环境变量三者需要严格对齐的场景下尤为关键。

**3. 人类决策 + AI 执行 = 最佳组合。** AI 不会替你做架构决策——选 SQLite 还是 PostgreSQL、用 Vercel 还是 Netlify，这些判断需要结合实际场景由人来拍板。但一旦方向确定，AI 能极大加速执行层面的工作。这种"人类掌舵、AI 划桨"的协作模式，是我在这个项目中最大的收获。

## 五、写在最后

从一个只会写 Python 脚本的大一新生，到独立完成前后端分离的全栈博客并部署上线，这个过程既是技术能力的跃迁，也是工程思维的启蒙。AI 不会让学习变得不重要——恰恰相反，你需要足够的基础知识才能向 AI 提出正确的问题、判断它给出的方案是否靠谱。

这个博客会持续更新，记录我在 Python、C/C++ 和开源项目中的所有折腾。如果你也是一个喜欢动手的极客新生，欢迎一起交流。

> 工具会迭代，但解决问题的思维方式不会过时。
"""


def seed_data(db_session):
    tag_python = Tag(name="Python", slug="python")
    tag_automation = Tag(name="Automation", slug="automation")
    tag_cpp = Tag(name="C/C++", slug="cpp")
    tag_notes = Tag(name="Notes", slug="notes")
    tag_devops = Tag(name="DevOps", slug="devops")
    tag_openclaw = Tag(name="OpenClaw", slug="openclaw")

    post1 = Post(
        title="Python 自动化实战：Selenium 与 Pandas 结合",
        slug="python-automation-selenium-pandas",
        summary="从页面抓取到表格清洗，串起 Selenium 与 Pandas 的一套高频自动化工作流。",
        content_md=PYTHON_ARTICLE,
    )
    post1.tags.extend([tag_python, tag_automation])

    post2 = Post(
        title="C/C++ 核心概念学习与排坑记录",
        slug="cpp-core-concepts-notes",
        summary="围绕指针、内存管理、对象生命周期与编译链接问题的持续学习笔记。",
        content_md=CPP_ARTICLE,
    )
    post2.tags.extend([tag_cpp, tag_notes])

    post3 = Post(
        title="OpenClaw 部署指南：从零搭建你的私有化平台",
        slug="openclaw-deployment-guide",
        summary="手把手教你用 Docker Compose 部署 OpenClaw，涵盖环境准备、配置调优与常见问题排查。",
        content_md=OPENCLAW_ARTICLE,
    )
    post3.tags.extend([tag_devops, tag_openclaw])

    db_session.add_all([post1, post2, post3])
    db_session.commit()

    # Insert last to guarantee highest id -> appears first on homepage
    tag_ai = Tag(name="AI", slug="ai")
    tag_fullstack = Tag(name="全栈", slug="fullstack")

    # Re-fetch tags that were already committed
    from sqlalchemy import select
    from app.models import Tag as TagModel
    tag_python_ref = db_session.execute(select(TagModel).where(TagModel.slug == "python")).scalar_one()
    tag_devops_ref = db_session.execute(select(TagModel).where(TagModel.slug == "devops")).scalar_one()

    post4 = Post(
        title="大一新生的全栈破局：AI 辅助构建极客博客的实战复盘",
        slug="freshman-fullstack-ai-blog",
        summary="从零到公网上线，一个大一新生用 Claude Code 辅助搭建 React + FastAPI 全栈博客的完整复盘。",
        content_md=FULLSTACK_ARTICLE,
    )
    post4.tags.extend([tag_ai, tag_fullstack, tag_python_ref, tag_devops_ref])

    db_session.add(post4)
    db_session.commit()
