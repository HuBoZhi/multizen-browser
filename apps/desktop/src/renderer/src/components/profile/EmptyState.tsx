import type { JSX } from "react";
import { Boxes } from "lucide-react";
import { Kbd } from "../atoms";
import { useI18n } from "../../lib/i18n";

interface Props {
  onCreate: () => void;
}

export function ProfilesEmptyState({ onCreate }: Props): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center" style={{ padding: 48 }}>
      <div
        className="text-center"
        style={{
          maxWidth: 420,
          padding: 32,
          borderRadius: 18,
          background: "rgba(255,255,255,0.055)",
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.17), 0 24px 48px -16px rgba(0,0,0,0.5)",
        }}
      >
        <div
          className="mx-auto flex items-center justify-center"
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "rgba(255,255,255,0.10)",
            color: "#e5e5e5",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)",
          }}
        >
          <Boxes size={22} strokeWidth={1.5} />
        </div>
        <div className="text-[14px] font-semibold text-neutral-100 mt-3.5">{t("No profiles yet")}</div>
        <div className="text-[12px] text-neutral-400 mt-1.5 leading-relaxed">
          {t("Each profile is its own browser — cookies, login, fingerprint, proxy. Create one to get started.")}
        </div>
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            type="button"
            onClick={onCreate}
            className="btn-brand text-[12px] px-3.5 py-2 rounded-[10px]"
          >
            {t("New profile")}
          </button>
          <Kbd>⌘ N</Kbd>
        </div>
      </div>
    </div>
  );
}
