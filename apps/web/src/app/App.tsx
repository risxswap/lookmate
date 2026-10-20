import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomePage } from '../pages/HomePage';
import { AuthPage } from '../pages/AuthPage';
import { WorkspacePage } from '../pages/WorkspacePage';

const queryClient = new QueryClient({ defaultOptions: {
  queries: { staleTime: 30_000, retry: false }, mutations: { retry: false },
} });
export function App() {
  const path = window.location.pathname;
  return <QueryClientProvider client={queryClient}><ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#315c50', borderRadius: 12 } }}><AntApp>
    <div className="page"><header className="site-header"><a className="brand" href="/" aria-label="Lookmate 首页">Lookmate</a><a href="/app">我的工作台</a></header>
      {path === '/login' || path === '/register' ? <AuthPage registration={path === '/register'} /> : path === '/app' || path.startsWith('/app/') ? <WorkspacePage /> : <HomePage />}
      <footer>Lookmate · 个人形象设计</footer>
    </div>
  </AntApp></ConfigProvider></QueryClientProvider>;
}
