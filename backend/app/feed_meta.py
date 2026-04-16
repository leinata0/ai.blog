RSS_SITE_TITLE = "AI 资讯观察"
RSS_SITE_DESCRIPTION = "聚焦值得持续追踪的消息、产品更新与产业线索，用更清晰的结构整理每一天和每一周的重要变化。"

RSS_ALL_TITLE = f"{RSS_SITE_TITLE} - 全站更新"
RSS_ALL_DESCRIPTION = "订阅全站最新发布，统一追踪日报、周报与主题内容。"

RSS_DAILY_TITLE = f"{RSS_SITE_TITLE} - AI 日报"
RSS_DAILY_DESCRIPTION = "订阅每日更新的 AI 日报，快速跟进当天最值得关注的变化。"

RSS_WEEKLY_TITLE = f"{RSS_SITE_TITLE} - AI 周报"
RSS_WEEKLY_DESCRIPTION = "订阅每周整理后的 AI 周报，集中回看关键变化与长期主线。"


def build_topic_feed_title(topic_key: str) -> str:
    return f"{RSS_SITE_TITLE} - 主题：{topic_key}"


def build_topic_feed_description(topic_key: str) -> str:
    return f"订阅主题 {topic_key} 的持续更新，追踪相关文章与后续进展。"
