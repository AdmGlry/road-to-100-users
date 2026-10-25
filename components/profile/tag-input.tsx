"use client";

import { XIcon } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { addTags, MAX_TAGS, removeTagAt } from "@/components/profile/profile-utils";
import { cn } from "@/lib/utils";

/**
 * Accessible tag editor: Enter or comma adds, Backspace in the empty field
 * removes the last tag, each tag has a labelled × button. Duplicates
 * (case-insensitive) are ignored; at most `max` tags.
 */
export function TagInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  describedBy,
  max = MAX_TAGS,
  disabled,
}: {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  onBlur?: () => void;
  placeholder?: string;
  describedBy?: string;
  max?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const usageId = useId();

  const commit = (text: string) => {
    if (!text.trim()) return;
    const { tags, overflow } = addTags(value, text, max);
    if (tags.length !== value.length) onChange(tags);
    setNotice(overflow > 0 ? `Maximum ${max} éléments.` : "");
    setDraft("");
  };

  const remove = (index: number) => {
    const removed = value[index];
    onChange(removeTagAt(value, index));
    setNotice(`« ${removed} » retiré.`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      event.preventDefault();
      remove(value.length - 1);
    }
  };

  const full = value.length >= max;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "border-input flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow]",
          "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {value.length > 0 && (
          <ul className="contents" aria-label="Éléments ajoutés">
            {value.map((tag, index) => (
              <li
                key={`${tag}-${index}`}
                className="bg-secondary text-secondary-foreground inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-md py-0.5 pr-0.5 pl-2 text-sm"
              >
                <span className="truncate" title={tag}>
                  {tag}
                </span>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={disabled}
                  aria-label={`Retirer ${tag}`}
                  className="hover:bg-background/70 focus-visible:ring-ring/50 active:bg-background/70 inline-flex size-7 shrink-0 items-center justify-center rounded-sm outline-none select-none focus-visible:ring-[3px] pointer-coarse:size-10"
                >
                  <XIcon aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id={id}
          type="text"
          value={draft}
          disabled={disabled || full}
          onChange={(e) => {
            const text = e.target.value;
            // A pasted or typed comma adds what precedes it.
            if (text.includes(",")) {
              const lastComma = text.lastIndexOf(",");
              commit(text.slice(0, lastComma));
              setDraft(text.slice(lastComma + 1));
            } else {
              setDraft(text);
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            commit(draft);
            onBlur?.();
          }}
          enterKeyHint="enter"
          autoComplete="off"
          placeholder={full ? `Maximum ${max} atteint` : placeholder}
          aria-describedby={[describedBy, usageId].filter(Boolean).join(" ")}
          className="placeholder:text-muted-foreground h-8 min-w-32 flex-1 bg-transparent px-1 text-base outline-none disabled:cursor-not-allowed md:text-sm pointer-coarse:h-10 pointer-coarse:md:text-base"
        />
      </div>
      <p id={usageId} className="text-muted-foreground text-xs">
        Valide avec Entrée ou une virgule. {value.length}/{max}.
      </p>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}
