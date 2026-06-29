import type { CSSProperties, ReactNode } from 'react';
import Header from './Header';
import Footer from './Footer';
import s from './PageShell.module.css';

interface Props {
  children: ReactNode;
  hideFooter?: boolean;
  mainClassName?: string;
  mainStyle?: CSSProperties;
}

export default function PageShell({ children, hideFooter = false, mainClassName = '', mainStyle }: Props) {
  return (
    <div className={`${s.shell} ${hideFooter ? s.shellFullscreen : ''}`}>
      <Header />
      <main className={`${s.main} ${hideFooter ? s.mainFullscreen : ''} ${mainClassName}`} style={mainStyle}>{children}</main>
      {hideFooter ? null : <Footer />}
    </div>
  );
}
