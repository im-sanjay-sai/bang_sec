import { FormEvent, useRef, useState } from "react";
import { MicrophoneIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";

import type { ConversationMessage } from "../domain/types";
import { cn } from "../utils/tailwind";
import { Button } from "./primitives/Button";
import { Divider } from "./primitives/Divider";
import { Input } from "./primitives/Input";
import { ScrollArea } from "./primitives/ScrollArea";

interface ConversationBarProps {
  className?: string;
  busy: boolean;
  messages: ConversationMessage[];
  onSend(text: string): Promise<void>;
}

export function ConversationBar({ className, busy, messages, onSend }: ConversationBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      return;
    }
    setDraft("");
    await onSend(text);
    inputRef.current?.focus();
  }

  return (
    <section className={cn("relative flex h-full min-w-0 flex-col gap-ui-xs border border-border bg-background/90 p-ui-xs shadow-[0_-12px_24px_rgb(0_0_0_/_0.35)]", className)}>
      <ScrollArea className="min-h-0 flex-1 mask-[linear-gradient(to_bottom,transparent_0px,black_34px)]">
        <div className="flex min-h-full flex-col justify-end gap-ui-xxs pr-ui-xs pt-8">
          {messages.slice(-4).map((message) => (
            <article className="flex items-start gap-1 text-xs" key={message.id}>
              <div
                className={[
                  "mt-2 h-px w-4 shrink-0",
                  message.role === "operator" ? "bg-fuel" : message.role === "voice-agent" ? "bg-terminal" : "bg-border",
                ].join(" ")}
              />
              <div className="min-w-0 bg-background/55 px-2 py-1 uppercase shadow-long">
                <span
                  className={[
                    "mr-1 px-1 py-px text-[10px] font-black",
                    message.role === "operator"
                      ? "bg-fuel-background text-fuel"
                      : message.role === "voice-agent"
                        ? "bg-terminal-background text-terminal"
                        : "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {message.role}
                </span>
                <span className="text-[11px] font-semibold text-foreground">{message.text}</span>
              </div>
            </article>
          ))}
        </div>
      </ScrollArea>

      <form className="flex items-center gap-ui-xxs" onSubmit={handleSubmit}>
        <Button
          aria-label="Voice placeholder"
          className="h-9 min-w-9 px-0 @md/main:min-w-30 @md/main:px-3"
          disabled
          type="button"
          variant="micRemoteMuted"
        >
          <MicrophoneIcon weight="bold" />
          <span className="hidden @md/main:inline">Mock voice</span>
        </Button>
        <div className="relative min-w-0 flex-1">
          <Input
            ref={inputRef}
            aria-label="Enter command"
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Enter command"
            value={draft}
            className="pr-11"
          />
          <Button
            aria-label="Send command"
            className="absolute right-0 top-0 border-l-0"
            disabled={busy || !draft.trim()}
            isLoading={busy}
            loader="stripes"
            size="icon"
            type="submit"
            variant={draft.trim() ? "default" : "ghost"}
          >
            <PaperPlaneRightIcon weight="bold" />
          </Button>
        </div>
      </form>
      <Divider variant="dashed" className="h-1.5 text-foreground/30 hidden @md/main:block" />
    </section>
  );
}
