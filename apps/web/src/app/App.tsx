import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthPage } from '../pages/AuthPage';
import { WorkspacePage } from '../pages/WorkspacePage';

const queryClient = new QueryClient({ defaultOptions: {
  queries: { staleTime: 30_000, retry: false }, mutations: { retry: false },
} });
export function App() {
  const path = window.location.pathname;
  const privatePage = path === '/app' || path.startsWith('/app/');
  return <QueryClientProvider client={queryClient}><ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#315c50', borderRadius: 12, colorText: '#203c32', colorTextSecondary: '#64746c', colorBgLayout: '#f5f7f4', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}><AntApp message={{ maxCount: 3 }} notification={{ placement: 'topRight' }}>
    {privatePage ? <WorkspacePage /> : <ConfigProvider theme={{ token: { colorPrimary: '#315c50', colorText: '#252928', colorTextSecondary: '#737673', colorBgContainer: '#faf9f6', colorBorder: '#d5d7d2', borderRadius: 8, controlHeightLG: 48 }, components: { Button: { primaryShadow: 'none', fontWeight: 500 }, Input: { activeShadow: '0 0 0 3px rgba(49, 92, 80, 0.10)' } } }}>
      <AuthPage registration={path === '/register'} />
    </ConfigProvider>}
  </AntApp></ConfigProvider></QueryClientProvider>;
}
