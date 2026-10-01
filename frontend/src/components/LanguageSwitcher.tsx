import { type Language, useI18n } from "../lib/i18n";

const LANGUAGES: Language[] = ["en", "zh"];

export default function LanguageSwitcher({ inline = false, disabled = false }: { inline?: boolean; disabled?: boolean }) {
  const { language, setLanguage, t, languageLabels } = useI18n();

  return (
    <div className={`languageSwitcher${inline ? " languageSwitcher--inline" : ""}`} aria-label={t("language.aria")}>
      <span className="languageSwitcherLabel">{t("language.label")}</span>
      <div className="languageSwitcherButtons">
        {LANGUAGES.map((item) => (
          <button
            disabled={disabled}
            key={item}
            type="button"
            className={item === language ? "active" : ""}
            onClick={() => setLanguage(item)}
            aria-pressed={item === language}
          >
            {languageLabels[item]}
          </button>
        ))}
      </div>
    </div>
  );
}
