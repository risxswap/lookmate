import { Button, Card, Space, Tag, Typography } from 'antd';
import { useAuthConfig } from '../features/auth/queries';
export function HomePage() {
  const config = useAuthConfig();
  return <main>
    <section className="intro" aria-labelledby="page-title"><p className="eyebrow">个人形象设计</p><Typography.Title id="page-title">找到适合自己的风格</Typography.Title><Typography.Paragraph>从你的照片和衣橱出发，探索发型与穿搭的更多可能。</Typography.Paragraph><Space><Button type="primary" size="large" href="/login">登录</Button>{config.data?.registrationEnabled ? <Button size="large" href="/register">创建账号</Button> : null}</Space></section>
    <div className="tool-grid"><Card title="发型设计"><Typography.Paragraph>结合本人照片和你的想法，尝试新的发型。</Typography.Paragraph><Tag>即将开放</Tag></Card><Card title="穿搭设计"><Typography.Paragraph>从你已有的衣物中挑选搭配，发现日常穿着的新组合。</Typography.Paragraph><Tag>即将开放</Tag></Card></div>
  </main>;
}
