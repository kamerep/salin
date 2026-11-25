import { BookMarked, History as HistoryIcon, Languages, MessageSquareReply, Settings as SettingsIcon } from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Logo } from './components/Logo';
import { Tag } from './components/ui';
import Glossary from './pages/Glossary';
import { LanguageForm, LanguageList } from './pages/Languages';
import History from './pages/History';
import { PageHead } from './pages/PageHead';
import Reply from './pages/Reply';
import Settings from './pages/Settings';
import Translate from './pages/Translate';
import { useSettings } from './state';

const NAV = [
  { to: '/', label: 'Translate', icon: Languages, end: true },
  { to: '/reply', label: 'Reply', icon: MessageSquareReply },
  { to: '/glossary', label: 'Glossary', icon: BookMarked },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function NotFound() {
  return (
    <>
      <PageHead title="Page not found" />
      <div className="page-body"><p>That page does not exist. <NavLink to="/">Go to Translate</NavLink></p></div>
    </>
  );
}

export default function App() {
  const { settings } = useSettings();
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <NavLink to="/" className="brand" aria-label="Salin home">
            <Logo size={34} />
            <span className="brand-text">
              <span className="brand-name">Salin</span>
              <span className="brand-sub">Workplace translator</span>
            </span>
          </NavLink>
          <div className="nav">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end}>
                <Icon size={20} aria-hidden="true" />
                <span className="nav-label">{label}</span>
              </NavLink>
            ))}
          </div>
          <div className="sidebar-foot">
            {settings && (
              settings.api_key.configured
                ? <span><Tag tone="ok">Claude connected</Tag></span>
                : <span><Tag tone="warn">No API key</Tag></span>
            )}
            {settings && <span>Saving: {settings.save_history ? 'on by default' : 'off by default'}</span>}
          </div>
        </nav>
        <main id="main" className="main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Translate />} />
            <Route path="/reply" element={<Reply />} />
            <Route path="/glossary" element={<Glossary />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/languages" element={<LanguageList />} />
            <Route path="/settings/languages/:code" element={<LanguageForm />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
