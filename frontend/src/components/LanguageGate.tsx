import { useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";

/** Mount the application only after a deliberate language choice on each visit. */
export default function LanguageGate({ children }: { children: ReactNode }) {
  const { language, setLanguage } = useI18n();
  const [ready, setReady] = useState(false);
  if (ready) return children;
  return (
    <main className="journal journal--centered languageWelcome">
      <section className="journalCard" aria-labelledby="language-welcome-title">
        <img src="/branding/mascot.png" alt="" width="96" />
        <h1 id="language-welcome-title">选择语言 / Choose your language</h1>
        <div className="journalButtonRow">
          <button className="journalButton" lang="zh-CN" autoFocus={language === "zh"}
            onClick={() => { setLanguage("zh"); setReady(true); }}>中国 · 中文</button>
          <button className="journalButton" lang="en" autoFocus={language === "en"}
            onClick={() => { setLanguage("en"); setReady(true); }}>Sri Lanka · English</button>
        </div>
      </section>
    </main>
  );
}
