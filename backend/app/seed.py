from app.models import Post, Tag

PYTHON_ARTICLE = """\
# Python 自动化实战：Selenium 与 Pandas 结合

> 从页面交互到数据清洗导出，这是一套非常适合学生项目、日常办公和轻量数据采集的自动化工作流。

## 一、这套组合为什么这么高效？

很多网页数据并不是“打开即得”，而是要先登录、翻页、点击筛选、等待异步渲染后才能看到。这个时候，**Selenium 负责把浏览器操作自动化，Pandas 负责把结果整理成结构化数据**，两者组合起来就很顺手。

| 组件 | 主要职责 | 适合场景 |
|------|----------|----------|
| Selenium | 驱动浏览器完成点击、输入、跳转 | 登录后页面、动态表格、复杂交互 |
| Pandas | 清洗、计算、排序、导出数据 | 成绩分析、报表整理、批量统计 |
| ChromeDriver | 连接脚本与 Chrome | 浏览器自动化运行基础 |

> **适用判断：** 如果数据必须“先操作网页，后才能拿到”，这套方案就非常合适。

## 二、环境准备：先把工具链配齐

### 2.1 创建虚拟环境

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
```

### 2.2 安装依赖

```bash
pip install selenium pandas openpyxl webdriver-manager
```

### 2.3 为什么推荐 `webdriver-manager`

手动下载和匹配 ChromeDriver 往往很烦，而 `webdriver-manager` 能自动处理版本问题，少掉不少排坑时间。

> **Tips：** 初学阶段先让环境稳定，比过早“手动精细控制驱动版本”更重要。

## 三、实战流程：抓取课程成绩并生成 Excel

### 3.1 初始化浏览器

```python
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

options = webdriver.ChromeOptions()
options.add_argument("--headless")
options.add_argument("--disable-gpu")

driver = webdriver.Chrome(
    service=Service(ChromeDriverManager().install()),
    options=options
)
```

这里的重点不是“把代码记住”，而是理解三个动作：**创建驱动、配置运行模式、拿到浏览器控制权**。

### 3.2 登录并进入目标页面

```python
driver.get("https://example-edu.com/login")

WebDriverWait(driver, 10).until(
    EC.presence_of_element_located((By.ID, "username"))
)

driver.find_element(By.ID, "username").send_keys("student_id")
driver.find_element(By.ID, "password").send_keys("password")
driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()

WebDriverWait(driver, 10).until(EC.url_contains("/dashboard"))
```

> **关键原则：** 不要迷信 `sleep`，优先使用显式等待，让脚本和页面状态同步。

### 3.3 抓取表格内容

```python
driver.get("https://example-edu.com/grades")

table = WebDriverWait(driver, 10).until(
    EC.presence_of_element_located((By.CSS_SELECTOR, "table.grades"))
)

rows = table.find_elements(By.TAG_NAME, "tr")
data = []
for row in rows[1:]:
    cols = row.find_elements(By.TAG_NAME, "td")
    data.append({
        "课程": cols[0].text,
        "学分": float(cols[1].text),
        "成绩": float(cols[2].text),
        "绩点": float(cols[3].text),
    })

driver.quit()
```

这一段的核心是把网页里的“可视数据”转换成 Python 里的“结构化列表”。只要拿到了 `data`，后续分析基本就进入了 Pandas 的舒适区。

### 3.4 用 Pandas 做清洗与导出

```python
import pandas as pd

df = pd.DataFrame(data)

df["加权绩点"] = df["学分"] * df["绩点"]
gpa = df["加权绩点"].sum() / df["学分"].sum()
print(f"GPA: {gpa:.2f}")

df = df.sort_values("绩点", ascending=False)
df.to_excel("grades_report.xlsx", index=False, sheet_name="成绩单")
```

你可以把这一步理解为：**Selenium 负责“搬数据”，Pandas 负责“做结果”。**

## 四、两个特别常见的进阶场景

### 4.1 页面是无限滚动怎么办？

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

这类页面通常不是“翻页”，而是“滚一下再加载一点”。判断页面高度是否继续变化，是一个比较实用的思路。

### 4.2 请求偶发失败怎么办？

```python
import time
from functools import wraps

def retry(max_attempts=3, delay=1):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    if attempt == max_attempts - 1:
                        raise
                    time.sleep(delay * (attempt + 1))
        return wrapper
    return decorator

@retry(max_attempts=3)
def fetch_page(driver, url):
    driver.get(url)
```

> **经验值：** 自动化脚本最怕“偶现问题”。适度重试，能显著提升稳定性。

## 五、最容易踩的坑

| 问题 | 常见原因 | 更稳妥的处理方式 |
|------|----------|------------------|
| `ElementNotInteractableException` | 元素还没真正可点击 | 用 `WebDriverWait` 等到可交互 |
| `StaleElementReferenceException` | DOM 更新导致旧引用失效 | 重新定位元素 |
| 驱动版本不匹配 | Chrome 自动升级了 | 使用 `webdriver-manager` |
| 导出数据乱码 | 编码处理不一致 | 明确指定 UTF-8 或目标格式 |

## 六、一个适合记住的思路

当你面对自动化任务时，可以直接按下面这个顺序拆解：

1. **先到达目标页面状态**：登录、跳转、筛选。
2. **再稳定拿到页面数据**：等待渲染、定位节点、抽取文本。
3. **最后统一做数据整理**：清洗、排序、计算、导出。

> 自动化不是为了“少做事”，而是为了把重复劳动交给脚本，把精力留给真正需要判断的部分。
"""

CPP_ARTICLE = """\
# C/C++ 核心概念学习与排坑记录

> 这不是一篇“背语法”的笔记，而是一份围绕指针、内存、生命周期与编译过程的实战理解清单。

## 一、为什么 C/C++ 总让人又爱又怕？

C/C++ 的魅力在于你能直接接触到底层：内存怎么分配、对象怎么构造、程序怎么链接，几乎都摆在你面前。但也正因为离底层太近，很多错误不会“温柔提醒”，而是直接用崩溃和未定义行为教育你。

> **一句话理解：** 学 C/C++，本质上是在学习程序到底是怎样活起来的。

## 二、指针：能力上限高，容错率也低

### 2.1 指针和引用到底差在哪？

```cpp
int x = 42;
int* ptr = &x;   // 指针：存储 x 的地址
int& ref = x;    // 引用：x 的别名

*ptr = 100;
ref = 200;
```

| 对比项 | 指针 | 引用 |
|--------|------|------|
| 本质 | 保存地址的变量 | 现有对象的别名 |
| 是否可为空 | 可以，典型值是 `nullptr` | 不可以 |
| 是否能改指向 | 可以 | 不可以 |
| 访问方式 | 需要解引用 `*ptr` | 直接像普通变量一样使用 |

如果你只是想“给对象起一个别名”，引用更自然；如果你需要“表达可空、可变目标、动态管理”，指针更灵活。

### 2.2 悬空指针为什么危险？

```cpp
int* create_dangling() {
    int local = 42;
    return &local;  // 错误：返回局部变量地址
}

int* ptr = create_dangling();
```

函数返回后，`local` 已经被销毁，但 `ptr` 还握着那块旧地址。此时程序表面上“还能跑”，但访问结果完全不可预测。

> **经验提醒：** 最可怕的 bug 往往不是“立刻崩”，而是“有时能跑，有时炸”。悬空指针就属于这一类。

### 2.3 更稳妥的做法

```cpp
#include <memory>

std::unique_ptr<int> create_safe() {
    return std::make_unique<int>(42);
}
```

当资源归对象管理时，生命周期会清晰很多，代码也更不容易忘记释放。

## 三、内存管理：真正的分水岭

### 3.1 栈和堆可以怎么理解？

```text
┌─────────────────────┐  高地址
│       栈 (Stack)     │  ← 自动分配 / 自动释放
│  局部变量、函数参数    │
├─────────────────────┤
│       空闲区域        │
├─────────────────────┤
│       堆 (Heap)      │  ← 手动管理，更灵活
│  new/malloc 分配资源   │
├─────────────────────┤
│    全局/静态变量      │
├─────────────────────┤
│       代码段         │
└─────────────────────┘  低地址
```

可以粗略记成一句话：**栈快但短，堆灵活但贵。**

- 栈适合生命周期明确的小对象
- 堆适合需要跨作用域存在的资源
- 一旦用了堆，就必须认真思考释放责任归谁

### 3.2 一个经典内存泄漏长什么样？

```cpp
void leak_example() {
    int* arr = new int[1000];
    if (some_condition) {
        return;  // 提前返回，arr 泄漏
    }
    delete[] arr;
}
```

问题不在 `new` 本身，而在于控制流一复杂，人就容易忘记 `delete`。

### 3.3 为什么 RAII 这么重要？

```cpp
void safe_example() {
    auto arr = std::make_unique<int[]>(1000);
    if (some_condition) {
        return;
    }
}
```

`unique_ptr` 的价值在于：**你不再依赖“记得释放”，而是把释放动作交给对象析构自动完成。**

> **RAII 原则：** 资源的申请和对象初始化绑定，资源的释放和对象析构绑定。

## 四、对象生命周期：现代 C++ 的关键意识

### 4.1 Rule of Five 是在解决什么问题？

当一个类自己管理资源时，默认的拷贝行为通常不够安全，于是你需要显式定义关键成员函数。

```cpp
class Buffer {
    int* data_;
    size_t size_;
public:
    Buffer(size_t size) : data_(new int[size]), size_(size) {}
    ~Buffer() { delete[] data_; }

    Buffer(const Buffer& other) : data_(new int[other.size_]), size_(other.size_) {
        std::copy(other.data_, other.data_ + size_, data_);
    }

    Buffer& operator=(const Buffer& other) {
        if (this != &other) {
            delete[] data_;
            size_ = other.size_;
            data_ = new int[size_];
            std::copy(other.data_, other.data_ + size_, data_);
        }
        return *this;
    }

    Buffer(Buffer&& other) noexcept : data_(other.data_), size_(other.size_) {
        other.data_ = nullptr;
        other.size_ = 0;
    }
};
```

如果这里偷懒，最常见的问题就是**浅拷贝导致重复释放**。

### 4.2 `std::move` 到底做了什么？

```cpp
std::string a = "Hello";
std::string b = std::move(a);
```

`std::move` 不会真的“搬运数据”，它只是把对象转换成“可以被移动的状态”，让移动构造或移动赋值有机会接管资源。

> **要点：** 被 `move` 之后的对象仍然有效，但不要再假设它保留原值。

## 五、编译与链接：程序如何从源码变成可执行文件

### 5.1 四个阶段速览

```text
源码(.cpp) → 预处理(.i) → 编译(.s) → 汇编(.o) → 链接(可执行文件)
```

理解这个流程后，很多“看起来玄学”的报错都会变得可解释。

### 5.2 常用命令怎么对应阶段

```bash
g++ -E main.cpp -o main.i
g++ -S main.cpp -o main.s
g++ -c main.cpp -o main.o
g++ main.o utils.o -o app
```

### 5.3 三类常见链接错误

| 错误信息 | 典型原因 | 处理思路 |
|---------|----------|----------|
| `undefined reference to 'func'` | 声明了但没定义，或目标文件没参与链接 | 检查实现文件是否被编译进去 |
| `multiple definition of 'var'` | 在多个翻译单元重复定义全局符号 | 用 `extern` 或调整定义位置 |
| `undefined reference to vtable` | 虚函数声明了却没提供实现 | 检查类的虚函数定义是否完整 |

## 六、调试时最有价值的两把工具

### 6.1 AddressSanitizer

```bash
g++ -fsanitize=address -g main.cpp -o app
./app
```

适合抓内存越界、use-after-free 这类高危错误，反馈快、定位直接。

### 6.2 Valgrind

```bash
valgrind --leak-check=full ./app
```

更适合查内存泄漏与资源未释放问题，尤其是项目稍微大一点之后会很有帮助。

## 七、最后给自己的学习顺序

如果你现在也在学 C/C++，我很建议按下面这个顺序推进：

1. **先吃透内存模型**：栈、堆、指针、引用。
2. **再理解生命周期**：构造、析构、拷贝、移动。
3. **然后补现代 C++**：智能指针、RAII、类型推导。
4. **最后回头看编译链接**：把源码到二进制的过程串起来。

> 每一次把 bug 定位清楚，都会让你对计算机底层多一分真实理解。
"""

OPENCLAW_ARTICLE = """\
# OpenClaw 部署指南：从零搭建你的私有化平台

> 如果你想要一个更可控、更适合个人开发者的小型工作台，私有化部署往往比单纯依赖 SaaS 更自由。

## 一、先搞清楚：OpenClaw 适合什么人？

OpenClaw 是一个适合个人开发者与小团队的轻量平台，可以把它理解成一个“自托管的工作中枢”：文档、项目协作、接口能力与基础平台组件，尽量放在你自己的环境里掌控。

很多人选择它，并不是因为“部署更酷”，而是因为它在下面几个点上更有吸引力：

| 维度 | SaaS 平台 | 私有化部署 |
|------|-----------|------------|
| 数据控制权 | 数据在第三方服务里 | 完全由自己掌握 |
| 自定义能力 | 通常受平台限制 | 可以按需求调整源码与配置 |
| 网络环境 | 强依赖公网 | 可部署在内网或混合环境 |
| 长期使用成本 | 持续订阅 | 一次搭建，长期可复用 |

> **适合场景：** 想练部署、重视数据掌控、需要定制能力，或者本身就喜欢折腾基础设施。

## 二、环境准备：部署前先把地基打稳

### 2.1 硬件建议

```text
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

如果只是自己练手，最低配置就能启动；如果你打算长期使用，还是建议尽量上推荐配置，后续体验会稳定很多。

### 2.2 软件依赖检查

```bash
# 检查 Docker 版本（建议 20.10+）
docker --version

# 检查 Docker Compose 版本（建议 V2）
docker compose version
```

如果环境还没装好：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

> **提醒：** 用户组变更后通常需要重新登录 shell，Docker 权限才会生效。

## 三、开始部署：从克隆到跑起来

### 3.1 拉取项目代码

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
```

### 3.2 初始化环境变量

```bash
cp .env.example .env
```

然后重点修改这几类配置：

```env
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=openclaw
SECRET_KEY=generate-a-random-64-char-string
DOMAIN=claw.yourdomain.com
PROTOCOL=https
HTTP_PORT=8080
```

其中最不能偷懒的是 `SECRET_KEY`。

> **安全提醒：** 生产环境不要使用示例值，`SECRET_KEY` 建议直接用 `openssl rand -hex 32` 生成随机串。

### 3.3 启动全部服务

```bash
docker compose up -d
```

然后继续检查状态：

```bash
docker compose ps
docker compose logs -f --tail=100
```

这一阶段最重要的不是“命令是否敲完”，而是确认每个容器都真的健康启动了。

## 四、启动后你会得到怎样的架构？

```text
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

这个结构的好处是分层清晰：入口流量走 Nginx，业务逻辑走后端，数据和缓存分别交给 PostgreSQL 与 Redis。

## 五、初始化与基础验证

### 5.1 执行迁移并创建管理员

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

### 5.2 做一次健康检查

```bash
curl http://localhost:8080/api/health
```

期望看到：

```json
{"status": "ok"}
```

> **小建议：** 第一次部署时，迁移、管理员创建、健康检查最好一次做完，不要等出问题了再回头补。

## 六、进阶优化：把“能跑”升级成“更稳”

### 6.1 性能参数优化

```yaml
# docker-compose.override.yml
services:
  backend:
    environment:
      - WORKERS=4
      - MAX_CONNECTIONS=100
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
      - /mnt/ssd/pgdata:/var/lib/postgresql/data
```

这里的思路很简单：**后端并发参数和数据库缓存参数，尽量跟机器配置对齐。**

### 6.2 HTTPS 配置

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d claw.yourdomain.com
```

接着在 Nginx 中配置证书：

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

有了 HTTPS，浏览器访问体验和基础安全性都会更完整。

## 七、备份与恢复：这是部署后最容易被忽视的部分

### 7.1 自动备份脚本

```bash
#!/bin/bash
# backup.sh - 每日自动备份
BACKUP_DIR="/backups/openclaw"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

docker compose exec -T postgres pg_dump -U openclaw openclaw \
    | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

tar czf "$BACKUP_DIR/uploads_$DATE.tar.gz" ./data/uploads/
find $BACKUP_DIR -mtime +30 -delete

echo "Backup completed: $DATE"
```

配合 crontab：

```bash
echo "0 3 * * * /opt/openclaw/backup.sh" | crontab -
```

### 7.2 恢复流程

```bash
gunzip -c db_20260330_030000.sql.gz | \
    docker compose exec -T postgres psql -U openclaw openclaw

tar xzf uploads_20260330_030000.tar.gz -C ./data/
```

> **经验提醒：** 没验证过恢复链路的备份，不算真正可用的备份。

## 八、常见故障排查表

| 症状 | 常见原因 | 排查命令 | 处理方向 |
|------|----------|----------|----------|
| 容器启动失败 | 端口已被占用 | `lsof -i :8080` | 改端口或释放占用 |
| 数据库连接超时 | 容器网络不通 | `docker network ls` | 检查服务网络归属 |
| 页面返回 502 | 后端尚未就绪 | `docker compose logs backend` | 等启动完成或修配置 |
| 上传文件丢失 | volume 未正确挂载 | `docker inspect <container>` | 检查挂载路径 |
| 服务 OOM | 资源限制偏低 | `docker stats` | 提升内存或优化参数 |

## 九、最后的理解

如果把整套部署过程压缩成一句话，那就是：**准备环境、配好参数、稳定启动、补齐安全、建立备份。**

你真正需要掌握的，不只是“命令怎么敲”，而是出问题时知道应该先看日志、先查网络、先验证数据是否可恢复。

> 部署上线不是结束，而是系统真正开始接受考验的时刻。
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
