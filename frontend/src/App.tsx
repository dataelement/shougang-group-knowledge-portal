import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect } from 'react';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import ListPage from './pages/ListPage';
import DetailPage from './pages/DetailPage';
import ShareDocumentPage from './pages/ShareDocumentPage';
import AppsPage from './pages/AppsPage';
import AdminPage from './pages/AdminPage';
import DomainsPage from './pages/DomainsPage';
import LoginPage from './pages/LoginPage';
import BootstrapBishengPage from './pages/BootstrapBishengPage';
import ExpertQAPage from './pages/ExpertQAPage';
import ExpertQAAskPage from './pages/ExpertQAAskPage';
import ExpertQADetailPage from './pages/ExpertQADetailPage';
import KnowledgeSpacesPage from './pages/KnowledgeSpacesPage';
import ApprovalDialogHost from './components/ApprovalDialogHost';
import FloatingQaButton from './components/FloatingQaButton';
import LoginBanner from './components/LoginBanner';
import WikiPage from './pages/WikiPage';
import WikiDetailPage from './pages/WikiDetailPage';
import CoursePage from './pages/CoursePage';
import { usePortalConfig } from './hooks/usePortalConfig';
import { useAuth } from './hooks/useAuth';
import Header from './components/Header';

import ExpertManagePage from './pages/ExpertManagePage';
import { buildAdminLoginRedirect, getAdminAccessState } from './utils/adminAccess';

function RouteScrollReset() {
  const location = useLocation();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const scrollingElement = document.scrollingElement;
    const previousRootScrollBehavior = root.style.scrollBehavior;
    const previousBodyScrollBehavior = body.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    body.style.scrollBehavior = 'auto';
    root.scrollTop = 0;
    body.scrollTop = 0;
    if (scrollingElement) scrollingElement.scrollTop = 0;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      root.style.scrollBehavior = previousRootScrollBehavior;
      body.style.scrollBehavior = previousBodyScrollBehavior;
    });
  }, [location.pathname]);

  return null;
}

function SiteHeadConfig() {
  const { config } = usePortalConfig();

  useEffect(() => {
    const title = config?.site?.browser_title?.trim() || '首钢股份知库';
    document.title = title;
  }, [config?.site?.browser_title]);

  useEffect(() => {
    const faviconUrl = config?.site?.favicon_url?.trim() || '/site-favicon-horizontal-v2.png';
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.href = faviconUrl;
  }, [config?.site?.favicon_url]);

  return null;
}

function AdminRoute() {
  const location = useLocation();
  const { user } = useAuth();
  const accessState = getAdminAccessState(user);

  if (accessState === 'login') {
    return <Navigate to={buildAdminLoginRedirect(location.pathname, location.search)} replace />;
  }

  if (accessState === 'forbidden') {
    return (
      <>
        <Header />
        <main style={{ padding: '96px 24px', textAlign: 'center' }}>
          <h1>无权限</h1>
          <p>仅管理员和系统管理员可以访问知识管理后台。</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <AdminPage />
    </>
  );
}

function RedirectToSmartQa() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('tab', 'qa');
  return <Navigate to={`/apps?${params.toString()}`} replace />;
}

function ConditionalFloatingQaButton() {
  const location = useLocation();
  if (location.pathname === '/search') return null;
  return <FloatingQaButton />;
}

export default function App() {
  return (
    <>
      <SiteHeadConfig />
      <RouteScrollReset />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/domains" element={<DomainsPage />} />
        <Route path="/domain/:domainName" element={<ListPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/space/:spaceId" element={<ListPage />} />
        <Route path="/list" element={<ListPage />} />
        <Route path="/space/:spaceId/file/:fileId" element={<DetailPage />} />
        <Route path="/share/document/:token" element={<ShareDocumentPage />} />
        <Route path="/knowledge-spaces" element={<KnowledgeSpacesPage />} />
        <Route path="/qa" element={<RedirectToSmartQa />} />
        <Route path="/portal/qa" element={<RedirectToSmartQa />} />
        <Route path="/expert-qa" element={<ExpertQAPage />} />
        <Route path="/expert-qa/ask" element={<ExpertQAAskPage />} />
        <Route path="/expert-qa/expertmanage" element={<ExpertManagePage />} />
        <Route path="/expert-qa/:questionId" element={<ExpertQADetailPage />} />
        <Route path="/wiki" element={<WikiPage />} />
        <Route path="/wiki/:wikiId" element={<WikiDetailPage />} />
        <Route path="/course" element={<CoursePage />} />
        <Route path="/course/:courseId" element={<CoursePage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/admin" element={<AdminRoute />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/bootstrap/bisheng" element={<BootstrapBishengPage />} />
      </Routes>
      <LoginBanner />
      <ConditionalFloatingQaButton />
      <ApprovalDialogHost />
    </>
  );
}
