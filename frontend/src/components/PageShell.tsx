import type { ReactNode } from 'react';
import Header from './Header';
import Footer from './Footer';
import s from './PageShell.module.css';

interface Props {
  children: ReactNode;
  hideFooter?: boolean;
}

export default function PageShell({ children, hideFooter = false }: Props) {
  return (
    <div className={`${s.shell} ${hideFooter ? s.shellFullscreen : ''}`}>
      <Header />
      <main className={`${s.main} ${hideFooter ? s.mainFullscreen : ''}`}>{children}</main>
      {hideFooter ? null : <Footer />}
    </div>
  );
}
