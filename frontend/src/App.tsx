import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect } from 'react';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import ListPage from './pages/ListPage';
import DetailPage from './pages/DetailPage';
import ShareDocumentPage from './pages/ShareDocumentPage';
import QAPage from './pages/QAPage';
import AppsPage from './pages/AppsPage';
import AdminPage from './pages/AdminPage';
import DomainsPage from './pages/DomainsPage';
import LoginPage from './pages/LoginPage';
import ExpertQAPage from './pages/ExpertQAPage';
import ExpertQAAskPage from './pages/ExpertQAAskPage';
import ExpertQADetailPage from './pages/ExpertQADetailPage';
import KnowledgeSpacesPage from './pages/KnowledgeSpacesPage';
import WikiPage from './pages/WikiPage';
import WikiDetailPage from './pages/WikiDetailPage';
import CoursePage from './pages/CoursePage';
import { usePortalConfig } from './hooks/usePortalConfig';

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
        <Route path="/qa" element={<QAPage />} />
        <Route path="/portal/qa" element={<QAPage />} />
        <Route path="/expert-qa" element={<ExpertQAPage />} />
        <Route path="/expert-qa/ask" element={<ExpertQAAskPage />} />
        <Route path="/expert-qa/:questionId" element={<ExpertQADetailPage />} />
        <Route path="/wiki" element={<WikiPage />} />
        <Route path="/wiki/:wikiId" element={<WikiDetailPage />} />
        <Route path="/course" element={<CoursePage />} />
        <Route path="/course/:courseId" element={<CoursePage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </>
  );
}
